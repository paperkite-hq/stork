import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Accounts API", () => {
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

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await app.request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Accounts CRUD ──────────────────────────────────────
	describe("Accounts CRUD", () => {
		test("GET /api/accounts returns empty array initially", async () => {
			const { status, body } = await jsonRequest("/api/accounts");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/accounts creates an account", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: accounts } = await jsonRequest("/api/accounts");
			expect(accounts).toHaveLength(1);
			expect(accounts[0].name).toBe("Test");
			expect(accounts[0].email).toBe("test@example.com");
		});

		test("GET /api/accounts/:id returns account details", async () => {
			const accountId = createTestAccount(db);
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(status).toBe(200);
			expect(body.id).toBe(accountId);
			expect(body.name).toBe("Test Account");
			expect(body.imap_pass).toBeUndefined();
		});

		test("GET /api/accounts/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/accounts/999");
			expect(status).toBe(404);
		});

		test("PUT /api/accounts/:id updates fields", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.name).toBe("Updated Name");
		});

		test("PUT /api/accounts/:id rejects empty update", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("GET /api/accounts returns default_view on each account", async () => {
			createTestAccount(db);
			const { body } = await jsonRequest("/api/accounts");
			expect(body).toHaveLength(1);
			expect(body[0].default_view).toBe("inbox");
		});

		test("GET /api/accounts/:id returns default_view in detail", async () => {
			const accountId = createTestAccount(db);
			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.default_view).toBe("inbox");
		});

		test("PUT /api/accounts/:id updates default_view", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ default_view: "unread" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.default_view).toBe("unread");
		});

		test("DELETE /api/accounts/:id deletes account", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: accounts } = await jsonRequest("/api/accounts");
			expect(accounts).toHaveLength(0);
		});

		test("DELETE /api/accounts/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/accounts/999", {
				method: "DELETE",
			});
			expect(status).toBe(404);
		});
	});

	// ─── Folders ────────────────────────────────────────────
	describe("Folders", () => {
		test("GET /api/accounts/:id/folders returns folders", async () => {
			const accountId = createTestAccount(db);
			createTestFolder(db, accountId, "INBOX", { specialUse: "\\Inbox" });
			createTestFolder(db, accountId, "Sent", { specialUse: "\\Sent" });

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/folders`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0].path).toBe("INBOX");
		});

		test("GET /api/accounts/:id/sync-status returns folder sync info", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");

			db.prepare("INSERT INTO sync_state (account_id, folder_id, last_uid) VALUES (?, ?, 42)").run(
				accountId,
				folderId,
			);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/sync-status`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].last_uid).toBe(42);
		});
	});

	// ─── Validation edge cases ───────────────────────────────
	describe("Validation", () => {
		test("POST /api/accounts with missing required fields fails gracefully", async () => {
			const { status } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBeGreaterThanOrEqual(400);
		});

		test("PUT /api/accounts/:id ignores unknown fields", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Valid", unknown_field: "ignored" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.name).toBe("Valid");
		});

		test("PUT /api/accounts/:id with only unknown fields returns 400", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ unknown_field: "value" }),
			});
			expect(status).toBe(400);
		});

		test("GET /api/accounts/:id does not expose passwords", async () => {
			const accountId = createTestAccount(db);
			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.imap_pass).toBeUndefined();
			expect(body.smtp_pass).toBeUndefined();
		});

		test("POST /api/accounts rejects invalid email format", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "not-an-email",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid email");
		});

		test("POST /api/accounts rejects IMAP port out of range", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					imap_host: "imap.example.com",
					imap_port: 99999,
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("IMAP port");
		});

		test("POST /api/accounts rejects SMTP port out of range", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
					smtp_port: 0,
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("SMTP port");
		});

		test("POST /api/accounts accepts valid port numbers", async () => {
			const { status } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					imap_host: "imap.example.com",
					imap_port: 993,
					imap_user: "user",
					imap_pass: "pass",
					smtp_port: 465,
				}),
			});
			expect(status).toBe(201);
		});
	});

	// ─── Sync trigger ───────────────────────────────────────
	describe("Sync trigger", () => {
		test("POST /api/accounts/:id/sync returns 500 when sync fails", async () => {
			// Account with unreachable IMAP server — syncNow throws, route returns 500
			const accountId = createTestAccount(db, {
				imapHost: "127.0.0.1",
				imapPort: 19999, // no server listening here
			});
			scheduler.addAccount({
				accountId,
				imapConfig: {
					host: "127.0.0.1",
					port: 19999,
					secure: false,
					auth: { user: "test", pass: "test" },
				},
			});
			const { status } = await jsonRequest(`/api/accounts/${accountId}/sync`, {
				method: "POST",
			});
			expect(status).toBe(500);
		});
	});

	// ─── Delete cascades ────────────────────────────────────
	describe("Delete cascades", () => {
		test("deleting account removes its folders and messages", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/accounts/${accountId}`, { method: "DELETE" });

			const folders = db
				.prepare("SELECT COUNT(*) as count FROM folders WHERE account_id = ?")
				.get(accountId) as { count: number };
			expect(folders.count).toBe(0);

			const messages = db
				.prepare("SELECT COUNT(*) as count FROM messages WHERE account_id = ?")
				.get(accountId) as { count: number };
			expect(messages.count).toBe(0);
		});
	});

	describe("POST /accounts/test-connection", () => {
		test("returns 400 when required fields are missing", async () => {
			const res = await app.request("/api/accounts/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imap_host: "imap.example.com" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toContain("Missing required fields");
		});

		test("returns ok:false with error for unreachable server", async () => {
			const res = await app.request("/api/accounts/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imap_host: "localhost",
					imap_port: 19999,
					imap_tls: 0,
					imap_user: "test",
					imap_pass: "test",
				}),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; error?: string };
			expect(body.ok).toBe(false);
			expect(body.error).toBeTruthy();
		});
	});

	// ─── All Messages ──────────────────────────────────────
	describe("All Messages", () => {
		test("GET /api/accounts/:id/all-messages returns all messages regardless of labels", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const labelId = createTestLabel(db, accountId, "Inbox");

			const msg1 = createTestMessage(db, accountId, folderId, 1, { subject: "Labeled" });
			createTestMessage(db, accountId, folderId, 2, { subject: "Unlabeled" });
			addMessageLabel(db, msg1, labelId);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/all-messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("GET /api/accounts/:id/all-messages respects limit and offset", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			for (let i = 1; i <= 5; i++) {
				createTestMessage(db, accountId, folderId, i, {
					date: new Date(2026, 0, i).toISOString(),
				});
			}

			const { body: page1 } = await jsonRequest(
				`/api/accounts/${accountId}/all-messages?limit=2&offset=0`,
			);
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest(
				`/api/accounts/${accountId}/all-messages?limit=2&offset=2`,
			);
			expect(page2).toHaveLength(2);

			// No overlap between pages
			const ids1 = page1.map((m: { id: number }) => m.id);
			const ids2 = page2.map((m: { id: number }) => m.id);
			expect(ids1.filter((id: number) => ids2.includes(id))).toHaveLength(0);
		});

		test("GET /api/accounts/:id/all-messages returns empty for no messages", async () => {
			const accountId = createTestAccount(db);
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/all-messages`);
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("GET /api/accounts/:id/all-messages/count returns total and unread", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, accountId, folderId, 2, { flags: "" });
			createTestMessage(db, accountId, folderId, 3, { flags: "" });

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/all-messages/count`);
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.unread).toBe(2);
		});

		test("GET /api/accounts/:id/all-messages/count returns zeros when empty", async () => {
			const accountId = createTestAccount(db);
			const { body } = await jsonRequest(`/api/accounts/${accountId}/all-messages/count`);
			expect(body.total).toBe(0);
			expect(body.unread).toBe(0);
		});

		test("GET /api/accounts/:id/all-messages/count counts NULL flags as unread", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			// Insert a message with NULL flags (could happen with older schema or edge cases)
			db.prepare(`
				INSERT INTO messages (account_id, folder_id, uid, message_id, subject,
					from_address, date, flags, size, has_attachments)
				VALUES (?, ?, 99, '<null-flags@test>', 'Null flags msg',
					'sender@test', datetime('now'), NULL, 1000, 0)
			`).run(accountId, folderId);
			createTestMessage(db, accountId, folderId, 1, { flags: "\\Seen" });

			const { body } = await jsonRequest(`/api/accounts/${accountId}/all-messages/count`);
			expect(body.total).toBe(2);
			expect(body.unread).toBe(1); // NULL flags message should count as unread
		});

		test("GET /api/accounts/:id/all-messages/count uses cached values when set", async () => {
			const accountId = createTestAccount(db);
			// Set cached counts directly (simulating refreshAccountCounts)
			db.prepare(
				"UPDATE accounts SET cached_message_count = 42, cached_unread_count = 7 WHERE id = ?",
			).run(accountId);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/all-messages/count`);
			expect(status).toBe(200);
			// Returns cached values, not live count (which would be 0)
			expect(body.total).toBe(42);
			expect(body.unread).toBe(7);
		});

		test("GET /api/accounts/:id/all-messages/count returns 404 for unknown account", async () => {
			const { status, body } = await jsonRequest("/api/accounts/9999/all-messages/count");
			expect(status).toBe(404);
			expect(body.error).toMatch(/not found/i);
		});
	});

	// ─── Connector type validation ─────────────────────────
	describe("Connector type validation", () => {
		test("POST /api/accounts rejects invalid ingest_connector_type", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					ingest_connector_type: "invalid",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid ingest_connector_type");
		});

		test("POST /api/accounts rejects invalid send_connector_type", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					send_connector_type: "invalid",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid send_connector_type");
		});

		test("POST /api/accounts rejects cloudflare-email without webhook secret", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "CF Account",
					email: "cf@example.com",
					ingest_connector_type: "cloudflare-email",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("cf_email_webhook_secret");
		});

		test("POST /api/accounts rejects SES without ses_region", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "SES Account",
					email: "ses@example.com",
					send_connector_type: "ses",
					ingest_connector_type: "cloudflare-email",
					cf_email_webhook_secret: "secret123",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("ses_region");
		});

		test("POST /api/accounts creates cloudflare-email + SES account", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "CF+SES Account",
					email: "cfses@example.com",
					ingest_connector_type: "cloudflare-email",
					send_connector_type: "ses",
					cf_email_webhook_secret: "webhook-secret",
					ses_region: "us-east-1",
					// imap_host is NOT NULL in schema, pass a placeholder for non-IMAP accounts
					imap_host: "",
					imap_user: "",
					imap_pass: "",
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			// Verify the account was stored with correct connector types
			const { body: account } = await jsonRequest(`/api/accounts/${body.id}`);
			expect(account.ingest_connector_type).toBe("cloudflare-email");
			expect(account.send_connector_type).toBe("ses");
		});

		test("POST /api/accounts defaults to imap/smtp when types omitted", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Default",
					email: "default@example.com",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(201);

			const { body: account } = await jsonRequest(`/api/accounts/${body.id}`);
			expect(account.ingest_connector_type).toBe("imap");
			expect(account.send_connector_type).toBe("smtp");
		});
	});

	// ─── Connector health ──────────────────────────────────
	describe("Connector health", () => {
		test("GET /api/accounts/:id/connector-health returns 404 for missing account", async () => {
			const { status, body } = await jsonRequest("/api/accounts/999/connector-health");
			expect(status).toBe(404);
			expect(body.error).toContain("Account not found");
		});

		test("GET /api/accounts/:id/connector-health reports unconfigured IMAP", async () => {
			// Create account with cloudflare-email type but query its health
			// The default createTestAccount has imap fields, so insert directly with no IMAP config
			db.prepare(`
				INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass,
					ingest_connector_type, send_connector_type)
				VALUES ('No Config', 'noconfig@example.com', '', '', '',
					'imap', 'smtp')
			`).run();
			const accountId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("imap");
			expect(body.ingest.ok).toBe(false);
			expect(body.ingest.error).toContain("not configured");
			expect(body.send.type).toBe("smtp");
			expect(body.send.ok).toBe(false);
			expect(body.send.error).toContain("not configured");
		});

		test("GET /api/accounts/:id/connector-health checks cloudflare-email with secret", async () => {
			db.prepare(`
				INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass,
					ingest_connector_type, send_connector_type,
					cf_email_webhook_secret)
				VALUES ('CF Account', 'cf@example.com', '', '', '',
					'cloudflare-email', 'smtp',
					'my-webhook-secret')
			`).run();
			const accountId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("cloudflare-email");
			expect(body.ingest.ok).toBe(true);
			expect(body.ingest.details).toEqual({ mode: "push-based webhook" });
		});

		test("GET /api/accounts/:id/connector-health reports cloudflare-email without secret", async () => {
			db.prepare(`
				INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass,
					ingest_connector_type, send_connector_type)
				VALUES ('CF No Secret', 'cf-nosecret@example.com', '', '', '',
					'cloudflare-email', 'smtp')
			`).run();
			const accountId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("cloudflare-email");
			expect(body.ingest.ok).toBe(false);
			expect(body.ingest.error).toContain("Webhook secret not configured");
		});

		test("GET /api/accounts/:id/connector-health includes sync status when available", async () => {
			const accountId = createTestAccount(db, {
				imapHost: "127.0.0.1",
				imapPort: 19999,
			});
			scheduler.addAccount({
				accountId,
				imapConfig: {
					host: "127.0.0.1",
					port: 19999,
					secure: false,
					auth: { user: "test", pass: "test" },
				},
			});

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/connector-health`);
			expect(status).toBe(200);
			expect(body.sync).toBeTruthy();
			expect(body.sync).toHaveProperty("running");
		});

		test("GET /api/accounts/:id/connector-health returns null sync when not registered", async () => {
			const accountId = createTestAccount(db);
			const { body } = await jsonRequest(`/api/accounts/${accountId}/connector-health`);
			expect(body.sync).toBeNull();
		});
	});

	// ─── Route parameter validation ──────────────────────────
	describe("Route parameter validation", () => {
		test("GET /api/accounts/abc returns 400 for non-numeric accountId", async () => {
			const { status, body } = await jsonRequest("/api/accounts/abc");
			expect(status).toBe(400);
			expect(body.error).toMatch(/accountId/);
		});

		test("GET /api/accounts/abc/labels returns 400", async () => {
			const { status, body } = await jsonRequest("/api/accounts/abc/labels");
			expect(status).toBe(400);
			expect(body.error).toMatch(/accountId/);
		});

		test("GET /api/accounts/:id/labels returns cached message_count and unread_count", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");

			// Create a label with messages — set counts directly (simulating refreshLabelCounts)
			const labelId = createTestLabel(db, accountId, "INBOX");
			const msgId1 = createTestMessage(db, accountId, folderId, 1, { flags: "" });
			const msgId2 = createTestMessage(db, accountId, folderId, 2, { flags: "\\Seen" });
			addMessageLabel(db, msgId1, labelId);
			addMessageLabel(db, msgId2, labelId);
			// Update the cached counts directly (as refreshLabelCounts would)
			db.prepare("UPDATE labels SET message_count = 2, unread_count = 1 WHERE id = ?").run(labelId);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].name).toBe("INBOX");
			expect(body[0].message_count).toBe(2);
			expect(body[0].unread_count).toBe(1);
		});

		test("GET /api/accounts/1/folders/abc/messages returns 400 for non-numeric folderId", async () => {
			const { status, body } = await jsonRequest("/api/accounts/1/folders/abc/messages");
			expect(status).toBe(400);
			expect(body.error).toMatch(/folderId/);
		});

		test("GET /api/accounts/1/all-messages?limit=-1 returns 400", async () => {
			const { status, body } = await jsonRequest("/api/accounts/1/all-messages?limit=-1");
			expect(status).toBe(400);
			expect(body.error).toMatch(/limit/);
		});

		test("GET /api/accounts/1/all-messages?offset=abc returns 400", async () => {
			const { status, body } = await jsonRequest("/api/accounts/1/all-messages?offset=abc");
			expect(status).toBe(400);
			expect(body.error).toMatch(/offset/);
		});

		test("GET /api/accounts/1/all-messages?limit=500 clamps to 200", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}/all-messages?limit=500`);
			expect(status).toBe(200);
			// Just verify it doesn't crash — limit is silently clamped
		});
	});

	// ─── Unread messages ───────────────────────────────────
	describe("Unread Messages", () => {
		test("GET /api/accounts/:id/unread-messages returns only unread", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, accountId, folderId, 2, { flags: "" });
			createTestMessage(db, accountId, folderId, 3, { flags: "" });

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/unread-messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("GET /api/accounts/:id/unread-messages/count returns count", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, accountId, folderId, 2, { flags: "" });

			const { status, body } = await jsonRequest(
				`/api/accounts/${accountId}/unread-messages/count`,
			);
			expect(status).toBe(200);
			expect(body.total).toBe(1);
		});

		test("GET /api/accounts/:id/unread-messages/count uses cached value when set", async () => {
			const accountId = createTestAccount(db);
			// Set cached count directly (simulating refreshAccountCounts)
			db.prepare("UPDATE accounts SET cached_unread_count = 15 WHERE id = ?").run(accountId);

			const { status, body } = await jsonRequest(
				`/api/accounts/${accountId}/unread-messages/count`,
			);
			expect(status).toBe(200);
			// Returns cached value, not live count (which would be 0)
			expect(body.total).toBe(15);
		});

		test("GET /api/accounts/:id/unread-messages/count returns 404 for unknown account", async () => {
			const { status, body } = await jsonRequest("/api/accounts/9999/unread-messages/count");
			expect(status).toBe(404);
			expect(body.error).toMatch(/not found/i);
		});
	});
});
