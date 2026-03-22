import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import { MockSmtpServer } from "../helpers/mock-smtp-server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "../helpers/test-db.js";

describe("Send API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../src/sync/sync-scheduler.js").SyncScheduler;
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

	function createSmtpAccount(): number {
		return createTestAccount(db, {
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
			const accountId = createSmtpAccount();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
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
			const accountId = createSmtpAccount();
			const { body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
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
			const accountId = createSmtpAccount();
			await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					to: ["test@example.com"],
					subject: "Folder test",
					text_body: "Test",
				}),
			});

			const folder = db
				.prepare("SELECT * FROM folders WHERE account_id = ? AND path = 'Sent'")
				.get(accountId) as Record<string, unknown>;

			expect(folder).toBeTruthy();
			expect(folder.special_use).toBe("\\Sent");
		});

		test("sends reply with threading headers", async () => {
			const accountId = createSmtpAccount();
			const { body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
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
			expect(stored.references).toBe("<original@example.com>");
		});

		test("rejects missing account_id", async () => {
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					to: ["test@example.com"],
					subject: "No account",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("account_id");
		});

		test("rejects empty to array", async () => {
			const accountId = createSmtpAccount();
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					to: [],
					subject: "No recipients",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("to");
		});

		test("rejects account without SMTP config", async () => {
			const accountId = createTestAccount(db); // No SMTP config
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
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
					account_id: 99999,
					to: ["test@example.com"],
					subject: "Bad account",
					text_body: "Test",
				}),
			});
			expect(status).toBe(404);
		});

		test("sends with attachments", async () => {
			const accountId = createSmtpAccount();
			const content = Buffer.from("Hello, attachment!").toString("base64");
			const { status, body } = await jsonRequest("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
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
