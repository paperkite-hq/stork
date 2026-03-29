import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../api/server.js";
import { createTestContext, createTestDb } from "../../test-helpers/test-db.js";

describe("Connectors API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../sync/sync-scheduler.js").SyncScheduler;

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
	});

	afterEach(async () => {
		await scheduler.stop();
		db.close();
	});

	async function jsonReq(path: string, init?: RequestInit) {
		const res = await app.request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	function post(path: string, body: unknown) {
		return jsonReq(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function put(path: string, body: unknown) {
		return jsonReq(path, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	function del(path: string) {
		return jsonReq(path, { method: "DELETE" });
	}

	// ── Inbound Connectors ─────────────────────────────────────────────────────

	describe("Inbound connectors CRUD", () => {
		test("GET /api/connectors/inbound returns empty array initially", async () => {
			const { status, body } = await jsonReq("/api/connectors/inbound");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/connectors/inbound creates an IMAP connector", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "My IMAP",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: list } = await jsonReq("/api/connectors/inbound");
			expect(list).toHaveLength(1);
			expect(list[0].name).toBe("My IMAP");
			expect(list[0].type).toBe("imap");
		});

		test("POST /api/connectors/inbound creates a cloudflare-email connector", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "CF Email",
				type: "cloudflare-email",
				cf_email_webhook_secret: "secret123",
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("POST /api/connectors/inbound defaults to imap type", async () => {
			const { status } = await post("/api/connectors/inbound", {
				name: "Default",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			expect(status).toBe(201);
		});

		test("POST /api/connectors/inbound returns 400 for invalid type", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "Bad",
				type: "invalid-type",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/Invalid type/);
		});

		test("POST /api/connectors/inbound returns 400 when name missing", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/name is required/);
		});

		test("POST /api/connectors/inbound returns 400 when IMAP fields missing", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "Missing fields",
				type: "imap",
				imap_host: "imap.example.com",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/Missing required IMAP fields/);
		});

		test("POST /api/connectors/inbound returns 400 for invalid imap_port", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "Bad port",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
				imap_port: 99999,
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/imap_port/);
		});

		test("POST /api/connectors/inbound returns 400 when cf_email_webhook_secret missing", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "CF no secret",
				type: "cloudflare-email",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/cf_email_webhook_secret/);
		});

		test("POST /api/connectors/inbound creates a cloudflare-r2 connector", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "My R2",
				type: "cloudflare-r2",
				cf_r2_account_id: "acc123",
				cf_r2_bucket_name: "emails",
				cf_r2_access_key_id: "AKID",
				cf_r2_secret_access_key: "SECRET",
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("POST /api/connectors/inbound returns 400 when R2 required fields missing", async () => {
			const { status, body } = await post("/api/connectors/inbound", {
				name: "R2 Incomplete",
				type: "cloudflare-r2",
				cf_r2_account_id: "acc123",
				// missing bucket_name, access_key_id, secret_access_key
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/Missing required R2 fields/);
		});

		test("PUT /api/connectors/inbound/:id updates R2 credentials and reloads poller", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "R2 Update",
				type: "cloudflare-r2",
				cf_r2_account_id: "acc123",
				cf_r2_bucket_name: "emails",
				cf_r2_access_key_id: "AKID",
				cf_r2_secret_access_key: "SECRET",
			});

			const { status, body } = await put(`/api/connectors/inbound/${created.id}`, {
				cf_r2_access_key_id: "NEW_AKID",
				cf_r2_secret_access_key: "NEW_SECRET",
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("GET /api/connectors/inbound/:id returns connector", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Fetch me",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status, body } = await jsonReq(`/api/connectors/inbound/${created.id}`);
			expect(status).toBe(200);
			expect(body.id).toBe(created.id);
			expect(body.name).toBe("Fetch me");
		});

		test("GET /api/connectors/inbound/:id returns 404 for missing", async () => {
			const { status } = await jsonReq("/api/connectors/inbound/999");
			expect(status).toBe(404);
		});

		test("PUT /api/connectors/inbound/:id updates connector", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Update me",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status, body } = await put(`/api/connectors/inbound/${created.id}`, {
				name: "Updated",
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			const { body: fetched } = await jsonReq(`/api/connectors/inbound/${created.id}`);
			expect(fetched.name).toBe("Updated");
		});

		test("PUT /api/connectors/inbound/:id reloads scheduler when IMAP creds change", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Creds change",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			// Should succeed without error (scheduler reload is best-effort)
			const { status } = await put(`/api/connectors/inbound/${created.id}`, {
				imap_host: "imap2.example.com",
			});
			expect(status).toBe(200);
		});

		test("PUT /api/connectors/inbound/:id returns 404 for missing", async () => {
			const { status } = await put("/api/connectors/inbound/999", { name: "X" });
			expect(status).toBe(404);
		});

		test("PUT /api/connectors/inbound/:id returns 400 for invalid type", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Type check",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status } = await put(`/api/connectors/inbound/${created.id}`, {
				type: "bad-type",
			});
			expect(status).toBe(400);
		});

		test("PUT /api/connectors/inbound/:id returns 400 for invalid imap_port", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Port check",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status } = await put(`/api/connectors/inbound/${created.id}`, {
				imap_port: 0,
			});
			expect(status).toBe(400);
		});

		test("PUT /api/connectors/inbound/:id returns 400 when no fields to update", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "No fields",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status, body } = await put(`/api/connectors/inbound/${created.id}`, {});
			expect(status).toBe(400);
			expect(body.error).toMatch(/No fields/);
		});

		test("DELETE /api/connectors/inbound/:id deletes connector", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Delete me",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { status, body } = await del(`/api/connectors/inbound/${created.id}`);
			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			const { status: getStatus } = await jsonReq(`/api/connectors/inbound/${created.id}`);
			expect(getStatus).toBe(404);
		});

		test("DELETE /api/connectors/inbound/:id returns 404 for missing", async () => {
			const { status } = await del("/api/connectors/inbound/999");
			expect(status).toBe(404);
		});

		test("DELETE /api/connectors/inbound/:id deletes connector (no identity constraint)", async () => {
			const { body: conn } = await post("/api/connectors/inbound", {
				name: "To delete",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});

			const { status, body } = await del(`/api/connectors/inbound/${conn.id}`);
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});
	});

	// ── Inbound Test Endpoint ──────────────────────────────────────────────────

	describe("Inbound connector test endpoint", () => {
		test("POST /api/connectors/inbound/:id/test returns 404 for missing connector", async () => {
			const { status } = await post("/api/connectors/inbound/999/test", {});
			expect(status).toBe(404);
		});

		test("POST /api/connectors/inbound/:id/test returns error for unconfigured IMAP", async () => {
			// Insert directly to get an IMAP connector without required fields
			db.prepare(
				`INSERT INTO inbound_connectors (name, type, imap_port, imap_tls)
				VALUES ('Bare', 'imap', 993, 1)`,
			).run();
			const id = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await post(`/api/connectors/inbound/${id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toMatch(/not fully configured/);
		});

		test("POST /api/connectors/inbound/:id/test IMAP connection failure returns ok:false", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "Test IMAP",
				type: "imap",
				imap_host: "127.0.0.1",
				imap_user: "user",
				imap_pass: "pass",
				imap_port: 19934,
			});
			const { status, body } = await post(`/api/connectors/inbound/${created.id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toBeTruthy();
		});

		test("POST /api/connectors/inbound/:id/test cloudflare-email with secret returns ok:true", async () => {
			const { body: created } = await post("/api/connectors/inbound", {
				name: "CF",
				type: "cloudflare-email",
				cf_email_webhook_secret: "secret123",
			});
			const { status, body } = await post(`/api/connectors/inbound/${created.id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.details).toEqual({ mode: "push-based webhook" });
		});

		test("POST /api/connectors/inbound/:id/test cloudflare-email without secret returns ok:false", async () => {
			// Insert a cloudflare-email row without a secret (bypassing POST validation)
			db.prepare(
				`INSERT INTO inbound_connectors (name, type, imap_port, imap_tls)
				VALUES ('CF No Secret', 'cloudflare-email', 0, 0)`,
			).run();
			const id = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await post(`/api/connectors/inbound/${id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
		});

		test("POST /api/connectors/inbound/:id/test cloudflare-r2 not fully configured returns ok:false", async () => {
			db.prepare(
				"INSERT INTO inbound_connectors (name, type) VALUES ('R2 Bare', 'cloudflare-r2')",
			).run();
			const id = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await post(`/api/connectors/inbound/${id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toMatch(/not fully configured/);
		});

		test("POST /api/connectors/inbound/:id/test cloudflare-r2 with credentials returns result", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					text: () =>
						Promise.resolve(
							"<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
						),
				}),
			);

			const { body: created } = await post("/api/connectors/inbound", {
				name: "R2 Full",
				type: "cloudflare-r2",
				cf_r2_account_id: "acc123",
				cf_r2_bucket_name: "my-bucket",
				cf_r2_access_key_id: "AKID",
				cf_r2_secret_access_key: "SECRET",
			});

			const { status, body } = await post(`/api/connectors/inbound/${created.id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.details?.mode).toBe("queue/poll");

			vi.unstubAllGlobals();
		});

		test("POST /api/connectors/inbound/:id/test cloudflare-r2 fetch error returns ok:false", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
					status: 403,
					text: () => Promise.resolve("Access Denied"),
				}),
			);

			const { body: created } = await post("/api/connectors/inbound", {
				name: "R2 BadCreds",
				type: "cloudflare-r2",
				cf_r2_account_id: "acc123",
				cf_r2_bucket_name: "my-bucket",
				cf_r2_access_key_id: "BADKEY",
				cf_r2_secret_access_key: "BADSECRET",
			});

			const { status, body } = await post(`/api/connectors/inbound/${created.id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toMatch(/403/);

			vi.unstubAllGlobals();
		});
	});

	// ── Outbound Connectors ────────────────────────────────────────────────────

	describe("Outbound connectors CRUD", () => {
		test("GET /api/connectors/outbound returns empty array initially", async () => {
			const { status, body } = await jsonReq("/api/connectors/outbound");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/connectors/outbound creates an SMTP connector", async () => {
			const { status, body } = await post("/api/connectors/outbound", {
				name: "My SMTP",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("POST /api/connectors/outbound creates an SES connector", async () => {
			const { status, body } = await post("/api/connectors/outbound", {
				name: "My SES",
				type: "ses",
				ses_region: "us-east-1",
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("POST /api/connectors/outbound defaults to smtp type", async () => {
			const { status } = await post("/api/connectors/outbound", {
				name: "Default",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			expect(status).toBe(201);
		});

		test("POST /api/connectors/outbound returns 400 for invalid type", async () => {
			const { status, body } = await post("/api/connectors/outbound", {
				name: "Bad",
				type: "invalid-type",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/Invalid type/);
		});

		test("POST /api/connectors/outbound returns 400 when name missing", async () => {
			const { status } = await post("/api/connectors/outbound", {
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			expect(status).toBe(400);
		});

		test("POST /api/connectors/outbound returns 400 when SMTP fields missing", async () => {
			const { status, body } = await post("/api/connectors/outbound", {
				name: "Missing SMTP",
				type: "smtp",
				smtp_host: "smtp.example.com",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/Missing required SMTP fields/);
		});

		test("POST /api/connectors/outbound returns 400 for invalid smtp_port", async () => {
			const { status } = await post("/api/connectors/outbound", {
				name: "Bad port",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
				smtp_port: 99999,
			});
			expect(status).toBe(400);
		});

		test("POST /api/connectors/outbound returns 400 when ses_region missing", async () => {
			const { status, body } = await post("/api/connectors/outbound", {
				name: "SES no region",
				type: "ses",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/ses_region/);
		});

		test("GET /api/connectors/outbound/:id returns connector", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Fetch me",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status, body } = await jsonReq(`/api/connectors/outbound/${created.id}`);
			expect(status).toBe(200);
			expect(body.id).toBe(created.id);
		});

		test("GET /api/connectors/outbound/:id returns 404 for missing", async () => {
			const { status } = await jsonReq("/api/connectors/outbound/999");
			expect(status).toBe(404);
		});

		test("PUT /api/connectors/outbound/:id updates connector", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Update me",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status, body } = await put(`/api/connectors/outbound/${created.id}`, {
				name: "Updated",
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("PUT /api/connectors/outbound/:id returns 404 for missing", async () => {
			const { status } = await put("/api/connectors/outbound/999", { name: "X" });
			expect(status).toBe(404);
		});

		test("PUT /api/connectors/outbound/:id returns 400 for invalid type", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Type check",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status } = await put(`/api/connectors/outbound/${created.id}`, {
				type: "bad",
			});
			expect(status).toBe(400);
		});

		test("PUT /api/connectors/outbound/:id returns 400 for invalid smtp_port", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Port check",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status } = await put(`/api/connectors/outbound/${created.id}`, {
				smtp_port: 0,
			});
			expect(status).toBe(400);
		});

		test("PUT /api/connectors/outbound/:id returns 400 when no fields to update", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "No fields",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status, body } = await put(`/api/connectors/outbound/${created.id}`, {});
			expect(status).toBe(400);
			expect(body.error).toMatch(/No fields/);
		});

		test("DELETE /api/connectors/outbound/:id deletes connector", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Delete me",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			const { status, body } = await del(`/api/connectors/outbound/${created.id}`);
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("DELETE /api/connectors/outbound/:id returns 404 for missing", async () => {
			const { status } = await del("/api/connectors/outbound/999");
			expect(status).toBe(404);
		});

		test("DELETE /api/connectors/outbound/:id returns 409 when in use by identity", async () => {
			const { body: inConn } = await post("/api/connectors/inbound", {
				name: "In",
				type: "imap",
				imap_host: "imap.example.com",
				imap_user: "user",
				imap_pass: "pass",
			});
			const { body: outConn } = await post("/api/connectors/outbound", {
				name: "In use",
				type: "smtp",
				smtp_host: "smtp.example.com",
				smtp_user: "user",
				smtp_pass: "pass",
			});
			db.prepare(
				`INSERT INTO identities (name, email, outbound_connector_id)
				VALUES ('Acct', 'a@b.com', ?)`,
			).run(outConn.id);

			const { status, body } = await del(`/api/connectors/outbound/${outConn.id}`);
			expect(status).toBe(409);
			expect(body.error).toMatch(/Cannot delete/);
		});
	});

	// ── Outbound Test Endpoint ─────────────────────────────────────────────────

	describe("Outbound connector test endpoint", () => {
		test("POST /api/connectors/outbound/:id/test returns 404 for missing connector", async () => {
			const { status } = await post("/api/connectors/outbound/999/test", {});
			expect(status).toBe(404);
		});

		test("POST /api/connectors/outbound/:id/test returns error for unconfigured SMTP", async () => {
			db.prepare(
				`INSERT INTO outbound_connectors (name, type, smtp_port, smtp_tls)
				VALUES ('Bare', 'smtp', 587, 1)`,
			).run();
			const id = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await post(`/api/connectors/outbound/${id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toMatch(/not fully configured/);
		});

		test("POST /api/connectors/outbound/:id/test SMTP connection failure returns ok:false", async () => {
			const { body: created } = await post("/api/connectors/outbound", {
				name: "Test SMTP",
				type: "smtp",
				smtp_host: "127.0.0.1",
				smtp_user: "user",
				smtp_pass: "pass",
				smtp_port: 19935,
			});
			const { status, body } = await post(`/api/connectors/outbound/${created.id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toBeTruthy();
		});

		test("POST /api/connectors/outbound/:id/test SES without region returns error", async () => {
			db.prepare(
				`INSERT INTO outbound_connectors (name, type, smtp_port, smtp_tls)
				VALUES ('Bare SES', 'ses', 0, 0)`,
			).run();
			const id = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await post(`/api/connectors/outbound/${id}/test`, {});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toMatch(/not fully configured/);
		});
	});
});
