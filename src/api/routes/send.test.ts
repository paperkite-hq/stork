import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { MockSmtpServer } from "../../test-helpers/mock-smtp-server.js";
import {
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Send API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../sync/sync-scheduler.js").SyncScheduler;
	let smtpServer: MockSmtpServer;
	let smtpPort: number;

	beforeAll(async () => {
		smtpServer = new MockSmtpServer({
			user: "sender",
			pass: "secret",
			requireAuth: true,
		});
		smtpPort = await smtpServer.start();
	});

	afterAll(async () => {
		await smtpServer.stop();
	});

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
		smtpServer.reset();
	});

	afterEach(async () => {
		await scheduler.stop();
		db.close();
	});

	function createSmtpIdentity(): number {
		return createTestIdentity(db, {
			smtpHost: "127.0.0.1",
			smtpPort: smtpPort,
			smtpUser: "sender",
			smtpPass: "secret",
		});
	}

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await app.request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Send endpoint ─────────────────────────────────────────
	describe("POST /api/send", () => {
		test("sends a basic email", async () => {
			const identityId = createSmtpIdentity();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["recipient@example.com"],
					subject: "Test subject",
					text_body: "Hello from the test!",
				}),
			});

			expect(status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.message_id).toBeTruthy();
			expect(body.accepted).toContain("recipient@example.com");
			expect(body.stored_message_id).toBeGreaterThan(0);

			// Verify SMTP server received the message
			expect(smtpServer.messages).toHaveLength(1);
			expect(smtpServer.messages[0].to).toContain("recipient@example.com");
		});

		test("saves sent message to database", async () => {
			const identityId = createSmtpIdentity();
			const { body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["alice@example.com"],
					cc: ["bob@example.com"],
					subject: "Saved message test",
					text_body: "Body text",
				}),
			});

			// Verify message is stored in DB
			const stored = db
				.prepare("SELECT * FROM messages WHERE id = ?")
				.get(body.stored_message_id) as Record<string, unknown>;

			expect(stored).toBeTruthy();
			expect(stored.subject).toBe("Saved message test");
			expect(stored.to_addresses).toBe('["alice@example.com"]');
			expect(stored.cc_addresses).toBe('["bob@example.com"]');
			expect(stored.text_body).toBe("Body text");
			expect(stored.flags).toContain("\\Seen");
		});

		test("creates Sent folder if none exists", async () => {
			const identityId = createSmtpIdentity();
			await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "Folder test",
					text_body: "Test",
				}),
			});

			const folder = db
				.prepare("SELECT * FROM folders WHERE identity_id = ? AND path = 'Sent'")
				.get(identityId) as Record<string, unknown>;

			expect(folder).toBeTruthy();
			expect(folder.special_use).toBe("\\Sent");
		});

		test("sends reply with threading headers", async () => {
			const identityId = createSmtpIdentity();
			const { body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["reply-to@example.com"],
					subject: "Re: Original topic",
					text_body: "This is my reply.",
					in_reply_to: "<original@example.com>",
					references: ["<original@example.com>"],
				}),
			});

			expect(body.ok).toBe(true);

			// Check SMTP message has threading headers
			const smtpMsg = smtpServer.messages[0];
			expect(smtpMsg.data).toContain("In-Reply-To: <original@example.com>");
			expect(smtpMsg.data).toContain("References: <original@example.com>");

			// Verify stored message has threading data
			const stored = db
				.prepare("SELECT * FROM messages WHERE id = ?")
				.get(body.stored_message_id) as Record<string, unknown>;
			expect(stored.in_reply_to).toBe("<original@example.com>");
			expect(stored.references).toBe('["<original@example.com>"]');
		});

		test("rejects missing identity_id", async () => {
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					to: ["test@example.com"],
					subject: "No account",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("identity_id");
		});

		test("rejects empty to array", async () => {
			const identityId = createSmtpIdentity();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: [],
					subject: "No recipients",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("to");
		});

		test("rejects account without SMTP config", async () => {
			const identityId = createTestIdentity(db); // No SMTP config
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "No SMTP",
					text_body: "Test",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("SMTP");
		});

		test("returns 404 for non-existent account", async () => {
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: 99999,
					to: ["test@example.com"],
					subject: "Bad account",
					text_body: "Test",
				}),
			});
			expect(status).toBe(404);
		});

		test("rejects request with no content (no subject, text, or html)", async () => {
			const identityId = createSmtpIdentity();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("subject");
		});

		test("sends with BCC recipients", async () => {
			const identityId = createSmtpIdentity();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["alice@example.com"],
					bcc: ["secret@example.com"],
					subject: "BCC test",
					text_body: "Hidden recipient test",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			// Verify BCC stored in DB
			const stored = db
				.prepare("SELECT * FROM messages WHERE id = ?")
				.get(body.stored_message_id) as Record<string, unknown>;
			expect(stored.bcc_addresses).toBe('["secret@example.com"]');
		});

		test("uses existing Sent folder with special_use flag", async () => {
			const identityId = createSmtpIdentity();
			// Pre-create a Sent folder with special_use
			db.prepare(`
				INSERT INTO folders (identity_id, path, name, delimiter, flags, special_use, message_count, unread_count)
				VALUES (?, '[Gmail]/Sent Mail', 'Sent Mail', '/', '[]', '\\\\Sent', 0, 0)
			`).run(identityId);

			const existingFolderId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "Reuse folder test",
					text_body: "Body",
				}),
			});

			// Verify message was saved to the existing folder, not a new one
			const stored = db
				.prepare("SELECT folder_id FROM messages WHERE id = ?")
				.get(body.stored_message_id) as { folder_id: number };
			expect(stored.folder_id).toBe(existingFolderId);
		});

		test("sends with html_body only (no text_body)", async () => {
			const identityId = createSmtpIdentity();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "HTML only",
					html_body: "<p>Rich content</p>",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("sends with attachments", async () => {
			const identityId = createSmtpIdentity();
			const content = Buffer.from("Hello, attachment!").toString("base64");
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "Attachment test",
					text_body: "See attached",
					attachments: [
						{
							filename: "test.txt",
							content_type: "text/plain",
							content_base64: content,
						},
					],
				}),
			});

			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			// Verify attachment is stored
			const attachments = db
				.prepare("SELECT * FROM attachments WHERE message_id = ?")
				.all(body.stored_message_id) as Record<string, unknown>[];
			expect(attachments).toHaveLength(1);
			expect(attachments[0].filename).toBe("test.txt");
			expect(attachments[0].content_type).toBe("text/plain");
		});
	});

	// ─── SES send path ────────────────────────────────────────
	describe("SES send path", () => {
		function createSesIdentity(
			name: string,
			email: string,
			opts: { ses_region?: string; ses_access_key_id?: string; ses_secret_access_key?: string },
		): number {
			// Create outbound connector (SES type, intentionally missing ses_region to test error)
			db.prepare(`
				INSERT INTO outbound_connectors (name, type, ses_region, ses_access_key_id, ses_secret_access_key)
				VALUES (?, 'ses', ?, ?, ?)
			`).run(
				`${name} (Outbound)`,
				opts.ses_region ?? null,
				opts.ses_access_key_id ?? null,
				opts.ses_secret_access_key ?? null,
			);
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			// Create inbound connector (IMAP, minimal config)
			db.prepare(`
				INSERT INTO inbound_connectors (name, type, imap_host, imap_user, imap_pass)
				VALUES (?, 'imap', 'imap.example.com', 'user', 'pass')
			`).run(`${name} (Inbound)`);
			const inboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			db.prepare(`
				INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
				VALUES (?, ?, ?, ?)
			`).run(name, email, inboundId, outboundId);
			return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
		}

		test("rejects SES account without ses_region configured", async () => {
			const identityId = createSesIdentity("SES Account", "ses@example.com", {});

			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "SES test",
					text_body: "Test",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("SES is not configured");
		});

		test("sends via SES when ses_region is configured", async () => {
			// Create account with SES config — the actual send will fail (no real AWS)
			// but it exercises the SES connector creation branch
			const identityId = createSesIdentity("SES Account", "ses@example.com", {
				ses_region: "us-east-1",
				ses_access_key_id: "AKIATEST",
				ses_secret_access_key: "secret123",
			});

			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "SES test",
					text_body: "Test",
				}),
			});
			// SES send will fail since we have no real AWS credentials, but we'll
			// get a 500 (connector creation succeeds, send fails) — not a 400
			expect(status).toBe(500);
			expect(body.error).toContain("Failed to send");
		});

		test("sends via SES with default credential chain (no explicit keys)", async () => {
			const identityId = createSesIdentity("SES Default Creds", "ses2@example.com", {
				ses_region: "eu-west-1",
			});

			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					identity_id: identityId,
					to: ["test@example.com"],
					subject: "SES default creds test",
					text_body: "Test",
				}),
			});
			// Will fail at AWS level but exercises the branch where credentials are undefined
			expect(status).toBe(500);
		});
	});

	// ─── SMTP test endpoint ───────────────────────────────────
	describe("POST /api/send/test-smtp", () => {
		test("verifies valid SMTP credentials", async () => {
			const { status, body } = await jsonRequest("/api/send/test-smtp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					smtp_host: "127.0.0.1",
					smtp_port: smtpPort,
					smtp_tls: 0,
					smtp_user: "sender",
					smtp_pass: "secret",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("rejects missing fields", async () => {
			const { status, body } = await jsonRequest("/api/send/test-smtp", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ smtp_host: "127.0.0.1" }),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("required");
		});
	});
});
