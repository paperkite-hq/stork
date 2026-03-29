import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { MockImapServer, buildRawEmail } from "../../test-helpers/mock-imap-server.js";
import {
	addMessageLabel,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestLabel,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Identities API", () => {
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

	/** Helper: create inbound + outbound connectors and return their IDs */
	function createConnectors(overrides?: {
		imapHost?: string;
		imapUser?: string;
		imapPass?: string;
		smtpHost?: string;
		smtpUser?: string;
		smtpPass?: string;
	}): { inboundId: number; outboundId: number } {
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', ?, 993, 1, ?, ?)
		`).run(
			overrides?.imapHost ?? "imap.example.com",
			overrides?.imapUser ?? "user",
			overrides?.imapPass ?? "pass",
		);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);

		db.prepare(`
			INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
			VALUES ('Test Outbound', 'smtp', ?, 587, 0, ?, ?)
		`).run(overrides?.smtpHost ?? null, overrides?.smtpUser ?? null, overrides?.smtpPass ?? null);
		const outboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		return { inboundId, outboundId };
	}

	// ─── Identities CRUD ──────────────────────────────────────
	describe("Identities CRUD", () => {
		test("GET /api/identities returns empty array initially", async () => {
			const { status, body } = await jsonRequest("/api/identities");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/identities creates an identity", async () => {
			const { inboundId, outboundId } = createConnectors();
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					inbound_connector_id: inboundId,
					outbound_connector_id: outboundId,
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: identities } = await jsonRequest("/api/identities");
			expect(identities).toHaveLength(1);
			expect(identities[0].name).toBe("Test");
			expect(identities[0].email).toBe("test@example.com");
		});

		test("GET /api/identities/:id returns identity details", async () => {
			const identityId = createTestIdentity(db);
			const { status, body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(status).toBe(200);
			expect(body.id).toBe(identityId);
			expect(body.name).toBe("Test Identity");
			expect(body.imap_pass).toBeUndefined();
		});

		test("GET /api/identities/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/identities/999");
			expect(status).toBe(404);
		});

		test("PUT /api/identities/:id updates fields", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.name).toBe("Updated Name");
		});

		test("PUT /api/identities/:id rejects empty update", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("GET /api/identities returns default_view on each identity", async () => {
			createTestIdentity(db);
			const { body } = await jsonRequest("/api/identities");
			expect(body).toHaveLength(1);
			expect(body[0].default_view).toBe("inbox");
		});

		test("GET /api/identities/:id returns default_view in detail", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.default_view).toBe("inbox");
		});

		test("PUT /api/identities/:id updates default_view", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ default_view: "unread" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.default_view).toBe("unread");
		});

		test("DELETE /api/identities/:id deletes identity", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: accounts } = await jsonRequest("/api/identities");
			expect(accounts).toHaveLength(0);
		});

		test("DELETE /api/identities/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/identities/999", {
				method: "DELETE",
			});
			expect(status).toBe(404);
		});
	});

	// ─── Folders ────────────────────────────────────────────
	describe("Folders", () => {
		test("GET /api/identities/:id/folders returns folders", async () => {
			const identityId = createTestIdentity(db);
			createTestFolder(db, identityId, "INBOX", { specialUse: "\\Inbox" });
			createTestFolder(db, identityId, "Sent", { specialUse: "\\Sent" });

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/folders`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0].path).toBe("INBOX");
		});

		test("GET /api/identities/:id/sync-status returns folder sync info", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");

			db.prepare("INSERT INTO sync_state (identity_id, folder_id, last_uid) VALUES (?, ?, 42)").run(
				identityId,
				folderId,
			);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/sync-status`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].last_uid).toBe(42);
		});
	});

	// ─── Validation edge cases ───────────────────────────────
	describe("Validation", () => {
		test("POST /api/identities with missing required fields fails gracefully", async () => {
			const { status } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBeGreaterThanOrEqual(400);
		});

		test("POST /api/identities requires inbound_connector_id", async () => {
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("inbound_connector_id");
		});

		test("POST /api/identities rejects non-existent connector IDs", async () => {
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					inbound_connector_id: 9999,
					outbound_connector_id: 9999,
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("not found");
		});

		test("PUT /api/identities/:id ignores unknown fields", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Valid", unknown_field: "ignored" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.name).toBe("Valid");
		});

		test("PUT /api/identities/:id with only unknown fields returns 400", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ unknown_field: "value" }),
			});
			expect(status).toBe(400);
		});

		test("GET /api/identities/:id does not expose passwords", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.imap_pass).toBeUndefined();
			expect(body.smtp_pass).toBeUndefined();
		});

		test("POST /api/identities rejects invalid email format", async () => {
			const { inboundId, outboundId } = createConnectors();
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "not-an-email",
					inbound_connector_id: inboundId,
					outbound_connector_id: outboundId,
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid email");
		});
	});

	// ─── Sync trigger ───────────────────────────────────────
	describe("Sync trigger", () => {
		test("POST /api/identities/:id/sync returns 500 when sync fails", async () => {
			// Account with unreachable IMAP server — syncNow throws, route returns 500
			const identityId = createTestIdentity(db, {
				imapHost: "127.0.0.1",
				imapPort: 19999, // no server listening here
			});
			scheduler.addIdentity({
				identityId,
				imapConfig: {
					host: "127.0.0.1",
					port: 19999,
					secure: false,
					auth: { user: "test", pass: "test" },
				},
			});
			const { status } = await jsonRequest(`/api/identities/${identityId}/sync`, {
				method: "POST",
			});
			expect(status).toBe(500);
		});
	});

	// ─── Delete cascades ────────────────────────────────────
	describe("Delete cascades", () => {
		test("deleting identity removes its folders and messages", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			createTestMessage(db, identityId, folderId, 1);

			await jsonRequest(`/api/identities/${identityId}`, { method: "DELETE" });

			const folders = db
				.prepare("SELECT COUNT(*) as count FROM folders WHERE identity_id = ?")
				.get(identityId) as { count: number };
			expect(folders.count).toBe(0);

			const messages = db
				.prepare("SELECT COUNT(*) as count FROM messages WHERE identity_id = ?")
				.get(identityId) as { count: number };
			expect(messages.count).toBe(0);
		});
	});

	describe("POST /identities/test-connection", () => {
		let mockServer: MockImapServer;
		let mockPort: number;

		beforeAll(async () => {
			mockServer = new MockImapServer({
				user: "conntest",
				pass: "connpass",
				mailboxes: [
					{
						path: "INBOX",
						name: "INBOX",
						delimiter: "/",
						flags: [],
						uidValidity: 1,
						uidNext: 1,
						messages: [
							{
								uid: 1,
								flags: [],
								internalDate: "2026-01-01T00:00:00Z",
								source: buildRawEmail({
									from: "a@b.com",
									to: "c@d.com",
									subject: "test",
									body: "body",
									messageId: "<t@t>",
									date: "Wed, 01 Jan 2026 00:00:00 +0000",
								}),
							},
						],
					},
				],
			});
			mockPort = await mockServer.start();
		});

		afterAll(async () => {
			await mockServer.stop();
		});

		test("returns 400 when required fields are missing", async () => {
			const res = await app.request("/api/identities/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imap_host: "imap.example.com" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toContain("Missing required fields");
		});

		test("returns ok:false with error for unreachable server", async () => {
			const res = await app.request("/api/identities/test-connection", {
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

		test("returns ok:true with mailbox count for valid credentials", async () => {
			const res = await app.request("/api/identities/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imap_host: "127.0.0.1",
					imap_port: mockPort,
					imap_tls: 0,
					imap_user: "conntest",
					imap_pass: "connpass",
				}),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; mailboxes?: number; error?: string };
			expect(body.ok).toBe(true);
			expect(body.mailboxes).toBeGreaterThanOrEqual(1);
		});
	});

	// ─── All Messages ──────────────────────────────────────
	describe("All Messages", () => {
		test("GET /api/identities/:id/all-messages returns all messages regardless of labels", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const labelId = createTestLabel(db, "Inbox");

			const msg1 = createTestMessage(db, identityId, folderId, 1, { subject: "Labeled" });
			createTestMessage(db, identityId, folderId, 2, { subject: "Unlabeled" });
			addMessageLabel(db, msg1, labelId);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/all-messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("GET /api/identities/:id/all-messages respects limit and offset", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			for (let i = 1; i <= 5; i++) {
				createTestMessage(db, identityId, folderId, i, {
					date: new Date(2026, 0, i).toISOString(),
				});
			}

			const { body: page1 } = await jsonRequest(
				`/api/identities/${identityId}/all-messages?limit=2&offset=0`,
			);
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest(
				`/api/identities/${identityId}/all-messages?limit=2&offset=2`,
			);
			expect(page2).toHaveLength(2);

			// No overlap between pages
			const ids1 = page1.map((m: { id: number }) => m.id);
			const ids2 = page2.map((m: { id: number }) => m.id);
			expect(ids1.filter((id: number) => ids2.includes(id))).toHaveLength(0);
		});

		test("GET /api/identities/:id/all-messages returns empty for no messages", async () => {
			const identityId = createTestIdentity(db);
			const { status, body } = await jsonRequest(`/api/identities/${identityId}/all-messages`);
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("GET /api/identities/:id/all-messages/count returns total and unread", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			createTestMessage(db, identityId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, identityId, folderId, 2, { flags: "" });
			createTestMessage(db, identityId, folderId, 3, { flags: "" });

			const { status, body } = await jsonRequest(
				`/api/identities/${identityId}/all-messages/count`,
			);
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.unread).toBe(2);
		});

		test("GET /api/identities/:id/all-messages/count returns zeros when empty", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}/all-messages/count`);
			expect(body.total).toBe(0);
			expect(body.unread).toBe(0);
		});

		test("GET /api/identities/:id/all-messages/count counts NULL flags as unread", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			// Insert a message with NULL flags (could happen with older schema or edge cases)
			db.prepare(`
				INSERT INTO messages (identity_id, folder_id, uid, message_id, subject,
					from_address, date, flags, size, has_attachments)
				VALUES (?, ?, 99, '<null-flags@test>', 'Null flags msg',
					'sender@test', datetime('now'), NULL, 1000, 0)
			`).run(identityId, folderId);
			createTestMessage(db, identityId, folderId, 1, { flags: "\\Seen" });

			const { body } = await jsonRequest(`/api/identities/${identityId}/all-messages/count`);
			expect(body.total).toBe(2);
			expect(body.unread).toBe(1); // NULL flags message should count as unread
		});

		test("GET /api/identities/:id/all-messages/count returns zeros for unknown identity", async () => {
			const { status, body } = await jsonRequest("/api/identities/9999/all-messages/count");
			expect(status).toBe(200);
			expect(body.total).toBe(0);
			expect(body.unread).toBe(0);
		});
	});

	// ─── Connector type via connectors ─────────────────────
	describe("Connector types", () => {
		test("POST /api/identities with IMAP inbound shows imap connector type", async () => {
			const { inboundId, outboundId } = createConnectors();
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Default",
					email: "default@example.com",
					inbound_connector_id: inboundId,
					outbound_connector_id: outboundId,
				}),
			});
			expect(status).toBe(201);

			const { body: identity } = await jsonRequest(`/api/identities/${body.id}`);
			expect(identity.ingest_connector_type).toBe("imap");
			expect(identity.send_connector_type).toBe("smtp");
		});
	});

	// ─── Connector health ──────────────────────────────────
	describe("Connector health", () => {
		test("GET /api/identities/:id/connector-health returns 404 for missing account", async () => {
			const { status, body } = await jsonRequest("/api/identities/999/connector-health");
			expect(status).toBe(404);
			expect(body.error).toContain("Identity not found");
		});

		test("GET /api/identities/:id/connector-health reports unconfigured IMAP", async () => {
			// Create inbound connector with IMAP type but no credentials
			db.prepare(`
				INSERT INTO inbound_connectors (name, type)
				VALUES ('No Config (Inbound)', 'imap')
			`).run();
			const inboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			// Create outbound connector with SMTP type but no credentials
			db.prepare(`
				INSERT INTO outbound_connectors (name, type)
				VALUES ('No Config (Outbound)', 'smtp')
			`).run();
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			db.prepare(`
				INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
				VALUES ('No Config', 'noconfig@example.com', ?, ?)
			`).run(inboundId, outboundId);
			const identityId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("imap");
			expect(body.ingest.ok).toBe(false);
			expect(body.ingest.error).toContain("not configured");
			expect(body.send.type).toBe("smtp");
			expect(body.send.ok).toBe(false);
			expect(body.send.error).toContain("not configured");
		});

		test("GET /api/identities/:id/connector-health checks cloudflare-email with secret", async () => {
			// Create inbound connector with cloudflare-email type and secret
			db.prepare(`
				INSERT INTO inbound_connectors (name, type, cf_email_webhook_secret)
				VALUES ('CF Inbound', 'cloudflare-email', 'my-webhook-secret')
			`).run();
			const inboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			db.prepare(`
				INSERT INTO outbound_connectors (name, type, smtp_host, smtp_user, smtp_pass)
				VALUES ('CF Outbound', 'smtp', 'smtp.example.com', 'user', 'pass')
			`).run();
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			db.prepare(`
				INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
				VALUES ('CF Account', 'cf@example.com', ?, ?)
			`).run(inboundId, outboundId);
			const identityId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("cloudflare-email");
			expect(body.ingest.ok).toBe(true);
			expect(body.ingest.details).toEqual({ mode: "push-based webhook" });
		});

		test("GET /api/identities/:id/connector-health reports cloudflare-email without secret", async () => {
			// Create inbound connector with cloudflare-email type but no secret
			db.prepare(`
				INSERT INTO inbound_connectors (name, type)
				VALUES ('CF No Secret (Inbound)', 'cloudflare-email')
			`).run();
			const inboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			db.prepare(`
				INSERT INTO outbound_connectors (name, type, smtp_host, smtp_user, smtp_pass)
				VALUES ('CF No Secret (Outbound)', 'smtp', 'smtp.example.com', 'user', 'pass')
			`).run();
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			db.prepare(`
				INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
				VALUES ('CF No Secret', 'cf-nosecret@example.com', ?, ?)
			`).run(inboundId, outboundId);
			const identityId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/connector-health`);
			expect(status).toBe(200);
			expect(body.ingest.type).toBe("cloudflare-email");
			expect(body.ingest.ok).toBe(false);
			expect(body.ingest.error).toContain("Webhook secret not configured");
		});

		test("GET /api/identities/:id/connector-health includes sync status when available", async () => {
			const identityId = createTestIdentity(db, {
				imapHost: "127.0.0.1",
				imapPort: 19999,
			});
			scheduler.addIdentity({
				identityId,
				imapConfig: {
					host: "127.0.0.1",
					port: 19999,
					secure: false,
					auth: { user: "test", pass: "test" },
				},
			});

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/connector-health`);
			expect(status).toBe(200);
			expect(body.sync).toBeTruthy();
			expect(body.sync).toHaveProperty("running");
		});

		test("GET /api/identities/:id/connector-health returns null sync when not registered", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}/connector-health`);
			expect(body.sync).toBeNull();
		});
	});

	// ─── Route parameter validation ──────────────────────────
	describe("Route parameter validation", () => {
		test("GET /api/identities/abc returns 400 for non-numeric identityId", async () => {
			const { status, body } = await jsonRequest("/api/identities/abc");
			expect(status).toBe(400);
			expect(body.error).toMatch(/identityId/);
		});

		test("GET /api/identities/abc/labels returns 400", async () => {
			const { status, body } = await jsonRequest("/api/identities/abc/labels");
			expect(status).toBe(400);
			expect(body.error).toMatch(/identityId/);
		});

		test("GET /api/identities/:id/labels returns cached message_count and unread_count", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");

			// Create a label with messages — set counts directly (simulating refreshLabelCounts)
			const labelId = createTestLabel(db, "INBOX");
			const msgId1 = createTestMessage(db, identityId, folderId, 1, { flags: "" });
			const msgId2 = createTestMessage(db, identityId, folderId, 2, { flags: "\\Seen" });
			addMessageLabel(db, msgId1, labelId);
			addMessageLabel(db, msgId2, labelId);
			// Update the cached counts directly (as refreshLabelCounts would)
			db.prepare("UPDATE labels SET message_count = 2, unread_count = 1 WHERE id = ?").run(labelId);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/labels`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].name).toBe("INBOX");
			expect(body[0].message_count).toBe(2);
			expect(body[0].unread_count).toBe(1);
		});

		test("GET /api/identities/1/folders/abc/messages returns 400 for non-numeric folderId", async () => {
			const { status, body } = await jsonRequest("/api/identities/1/folders/abc/messages");
			expect(status).toBe(400);
			expect(body.error).toMatch(/folderId/);
		});

		test("GET /api/identities/1/all-messages?limit=-1 returns 400", async () => {
			const { status, body } = await jsonRequest("/api/identities/1/all-messages?limit=-1");
			expect(status).toBe(400);
			expect(body.error).toMatch(/limit/);
		});

		test("GET /api/identities/1/all-messages?offset=abc returns 400", async () => {
			const { status, body } = await jsonRequest("/api/identities/1/all-messages?offset=abc");
			expect(status).toBe(400);
			expect(body.error).toMatch(/offset/);
		});

		test("GET /api/identities/1/all-messages?limit=500 clamps to 200", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}/all-messages?limit=500`);
			expect(status).toBe(200);
			// Just verify it doesn't crash — limit is silently clamped
		});
	});

	// ─── Unread messages ───────────────────────────────────
	describe("Unread Messages", () => {
		test("GET /api/identities/:id/unread-messages returns only unread", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			createTestMessage(db, identityId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, identityId, folderId, 2, { flags: "" });
			createTestMessage(db, identityId, folderId, 3, { flags: "" });

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/unread-messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("GET /api/identities/:id/unread-messages/count returns count", async () => {
			const identityId = createTestIdentity(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			createTestMessage(db, identityId, folderId, 1, { flags: "\\Seen" });
			createTestMessage(db, identityId, folderId, 2, { flags: "" });

			const { status, body } = await jsonRequest(
				`/api/identities/${identityId}/unread-messages/count`,
			);
			expect(status).toBe(200);
			expect(body.total).toBe(1);
		});

		test("GET /api/identities/:id/unread-messages/count returns zero for unknown identity", async () => {
			const { status, body } = await jsonRequest("/api/identities/9999/unread-messages/count");
			expect(status).toBe(200);
			expect(body.total).toBe(0);
		});
	});
});
