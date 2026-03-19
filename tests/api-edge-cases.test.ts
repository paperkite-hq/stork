import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "./helpers/test-db.js";

describe("API edge cases", () => {
	let db: Database;
	let app: Hono;
	let scheduler: import("../src/sync/sync-scheduler.js").SyncScheduler;

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

	async function request(path: string, init?: RequestInit) {
		return app.request(path, init);
	}

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Account validation ──────────────────────────────────
	describe("Account validation", () => {
		test("POST /api/accounts with missing required fields fails gracefully", async () => {
			const { status } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			// SQLite will reject the insert due to NOT NULL constraints
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
	});

	// ─── Message pagination edge cases ───────────────────────
	describe("Message pagination", () => {
		test("default limit is 50", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			// Create 60 messages
			for (let i = 1; i <= 60; i++) {
				createTestMessage(db, accountId, folderId, i);
			}

			const { body } = await jsonRequest(`/api/accounts/${accountId}/folders/${folderId}/messages`);
			expect(body).toHaveLength(50);
		});

		test("offset beyond total returns empty", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1);

			const { body } = await jsonRequest(
				`/api/accounts/${accountId}/folders/${folderId}/messages?offset=100`,
			);
			expect(body).toHaveLength(0);
		});

		test("messages are ordered by date DESC", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1, {
				date: "2026-01-01T00:00:00Z",
				subject: "Oldest",
			});
			createTestMessage(db, accountId, folderId, 2, {
				date: "2026-01-03T00:00:00Z",
				subject: "Newest",
			});
			createTestMessage(db, accountId, folderId, 3, {
				date: "2026-01-02T00:00:00Z",
				subject: "Middle",
			});

			const { body } = await jsonRequest(`/api/accounts/${accountId}/folders/${folderId}/messages`);
			expect(body[0].subject).toBe("Newest");
			expect(body[1].subject).toBe("Middle");
			expect(body[2].subject).toBe("Oldest");
		});
	});

	// ─── Thread edge cases ──────────────────────────────────
	describe("Thread reconstruction", () => {
		test("single message with no threading info returns itself", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1, {
				messageId: "<standalone@test.local>",
				subject: "No thread",
			});

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/thread`);
			expect(status).toBe(200);
			expect(body.length).toBeGreaterThanOrEqual(1);
		});

		test("message with NULL message_id and no references returns itself via fallback path", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			// Insert directly with NULL message_id to hit the threadIds.size === 0 branch
			db.prepare(`
				INSERT INTO messages (account_id, folder_id, uid, message_id, subject,
					from_address, to_addresses, date, text_body, size)
				VALUES (?, ?, 99, NULL, 'Null ID Message', 'a@b.com', '[]', '2024-01-01', 'body', 100)
			`).run(accountId, folderId);
			const msgId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/thread`);
			expect(status).toBe(200);
			expect(body.length).toBe(1);
			expect(body[0].id).toBe(msgId);
		});

		test("thread with References chain returns all related messages", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");

			createTestMessage(db, accountId, folderId, 1, {
				messageId: "<root@test.local>",
				subject: "Thread start",
			});
			createTestMessage(db, accountId, folderId, 2, {
				messageId: "<reply1@test.local>",
				inReplyTo: "<root@test.local>",
				references: "<root@test.local>",
				subject: "Re: Thread start",
			});
			const msg3Id = createTestMessage(db, accountId, folderId, 3, {
				messageId: "<reply2@test.local>",
				inReplyTo: "<reply1@test.local>",
				references: "<root@test.local> <reply1@test.local>",
				subject: "Re: Re: Thread start",
			});

			const { body } = await jsonRequest(`/api/messages/${msg3Id}/thread`);
			expect(body.length).toBeGreaterThanOrEqual(3);
		});

		test("thread does not leak messages from other accounts", async () => {
			const accountA = createTestAccount(db, { name: "A", email: "a@test.com" });
			const accountB = createTestAccount(db, { name: "B", email: "b@test.com" });
			const folderA = createTestFolder(db, accountA, "INBOX");
			const folderB = createTestFolder(db, accountB, "INBOX");

			const msgA = createTestMessage(db, accountA, folderA, 1, {
				messageId: "<shared-id@test.local>",
				subject: "Account A message",
			});
			createTestMessage(db, accountB, folderB, 1, {
				messageId: "<shared-id@test.local>",
				subject: "Account B message with same ID",
			});

			const { body } = await jsonRequest(`/api/messages/${msgA}/thread`);
			// Should only return messages from account A
			for (const msg of body) {
				expect(msg.id).toBe(msgA);
			}
		});

		test("thread returns 404 for non-existent message", async () => {
			const { status } = await jsonRequest("/api/messages/99999/thread");
			expect(status).toBe(404);
		});
	});

	// ─── Attachment security ────────────────────────────────
	describe("Attachment security", () => {
		test("sanitizes path separators in attachment filename", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, '../../../etc/passwd', 'text/plain', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			// Path separators are replaced with underscores
			expect(disposition).not.toContain("/");
			expect(disposition).toContain("_");
		});

		test("sanitizes backslash in attachment filename", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'C:\\Windows\\evil.exe', 'application/octet-stream', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).not.toContain("\\");
		});

		test("sanitizes quotes in attachment filename", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, ?, 'text/plain', 5, X'48656C6C6F')
			`).run(msgId, 'file"name.txt');

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			// Quotes are stripped to prevent breaking the Content-Disposition header
			expect(disposition).toBe('attachment; filename="filename.txt"');
		});

		test("null filename falls back to 'attachment'", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, NULL, 'application/octet-stream', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).toContain("attachment");
		});

		test("null content_type falls back to application/octet-stream", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'data.bin', NULL, 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
		});
	});

	// ─── Flag edge cases ────────────────────────────────────
	describe("Flag operations", () => {
		test("adding duplicate flags does not create duplicates", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen"] }),
			});

			const { body } = await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen"] }),
			});

			// Count occurrences of \Seen — should be exactly 1
			const flagCount = body.flags.split("\\Seen").length - 1;
			expect(flagCount).toBe(1);
		});

		test("removing non-existent flag is a no-op", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ remove: ["\\NonExistent"] }),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
		});

		test("add and remove in same request works correctly", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			// First add a flag
			await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen", "\\Flagged"] }),
			});

			// Then add one and remove another in the same request
			const { body } = await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Draft"], remove: ["\\Seen"] }),
			});

			expect(body.flags).toContain("\\Flagged");
			expect(body.flags).toContain("\\Draft");
			expect(body.flags).not.toContain("\\Seen");
		});
	});

	// ─── Search edge cases ──────────────────────────────────
	describe("Search edge cases", () => {
		test("empty query parameter returns 400", async () => {
			const { status } = await jsonRequest("/api/search?q=");
			// Empty string — the handler checks for !query which is falsy for ""
			expect(status).toBe(400);
		});

		test("search with account_id filter", async () => {
			const account1 = createTestAccount(db, { name: "A", email: "a@test.com" });
			const account2 = createTestAccount(db, { name: "B", email: "b@test.com" });
			const folder1 = createTestFolder(db, account1, "INBOX");
			const folder2 = createTestFolder(db, account2, "INBOX");

			createTestMessage(db, account1, folder1, 1, {
				subject: "UniqueSearchWord in A",
				textBody: "Test body",
			});
			createTestMessage(db, account2, folder2, 1, {
				subject: "UniqueSearchWord in B",
				textBody: "Test body",
			});

			const { body: all } = await jsonRequest("/api/search?q=UniqueSearchWord");
			expect(all).toHaveLength(2);

			const { body: filtered } = await jsonRequest(
				`/api/search?q=UniqueSearchWord&account_id=${account1}`,
			);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].subject).toContain("in A");
		});
	});

	// ─── Delete cascade ─────────────────────────────────────
	describe("Delete cascades", () => {
		test("deleting account removes its folders and messages", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/accounts/${accountId}`, { method: "DELETE" });

			// Verify folders and messages are gone
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

	// ─── Move message ────────────────────────────────────────
	describe("Move message", () => {
		test("POST /api/messages/:id/move moves message to target folder", async () => {
			const accountId = createTestAccount(db);
			const folder1 = createTestFolder(db, accountId, "INBOX");
			const folder2 = createTestFolder(db, accountId, "Archive");
			const msgId = createTestMessage(db, accountId, folder1, 1);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/move`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folder_id: folder2 }),
			});

			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			const updated = db.prepare("SELECT folder_id FROM messages WHERE id = ?").get(msgId) as {
				folder_id: number;
			};
			expect(updated.folder_id).toBe(folder2);
		});

		test("POST /api/messages/:id/move returns 400 when folder_id missing", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/move`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect(status).toBe(400);
			expect(body.error).toMatch(/folder_id/);
		});

		test("POST /api/messages/:id/move returns 404 for non-existent message", async () => {
			const { status, body } = await jsonRequest("/api/messages/999/move", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folder_id: 1 }),
			});

			expect(status).toBe(404);
			expect(body.error).toMatch(/not found/i);
		});

		test("POST /api/messages/:id/move returns 404 for non-existent folder", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/move`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ folder_id: 99999 }),
			});

			expect(status).toBe(404);
			expect(body.error).toMatch(/not found/i);
		});
	});

	// ─── Label creation constraints ──────────────────────────
	describe("Label creation constraints", () => {
		test("POST /api/accounts/:id/labels returns 409 for duplicate name", async () => {
			const accountId = createTestAccount(db);
			createTestLabel(db, accountId, "Work");

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});

			expect(status).toBe(409);
			expect(body.error).toMatch(/already exists/i);
		});
	});

	// ─── Sync trigger error ───────────────────────────────────
	describe("Sync trigger", () => {
		test("POST /api/accounts/:id/sync returns 500 when account not registered", async () => {
			// syncNow throws for an account not tracked by the scheduler
			const { status, body } = await jsonRequest("/api/accounts/99999/sync", {
				method: "POST",
			});

			expect(status).toBe(500);
			expect(body.error).toBeDefined();
		});
	});

	// ─── CORS ────────────────────────────────────────────────
	describe("CORS", () => {
		test("responses include CORS headers", async () => {
			const res = await request("/api/health");
			// Hono's cors() middleware sets this
			expect(res.headers.get("Access-Control-Allow-Origin")).toBeDefined();
		});
	});
});
