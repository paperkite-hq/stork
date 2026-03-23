import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Messages API", () => {
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

	async function request(path: string, init?: RequestInit) {
		return app.request(path, init);
	}

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Message list and detail ─────────────────────────────
	describe("Message list and detail", () => {
		let accountId: number;
		let folderId: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
			folderId = createTestFolder(db, accountId, "INBOX");
		});

		test("GET messages list returns messages", async () => {
			createTestMessage(db, accountId, folderId, 1, { subject: "Hello" });
			createTestMessage(db, accountId, folderId, 2, { subject: "World" });

			const { status, body } = await jsonRequest(
				`/api/accounts/${accountId}/folders/${folderId}/messages`,
			);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("GET messages list supports pagination", async () => {
			for (let i = 1; i <= 5; i++) {
				createTestMessage(db, accountId, folderId, i);
			}

			const { body: page1 } = await jsonRequest(
				`/api/accounts/${accountId}/folders/${folderId}/messages?limit=2&offset=0`,
			);
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest(
				`/api/accounts/${accountId}/folders/${folderId}/messages?limit=2&offset=2`,
			);
			expect(page2).toHaveLength(2);
			expect(page2[0].id).not.toBe(page1[0].id);
		});

		test("GET /api/messages/:id returns full message", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1, {
				subject: "Detailed",
				textBody: "Full body text",
				htmlBody: "<p>Full body</p>",
			});

			const { status, body } = await jsonRequest(`/api/messages/${msgId}`);
			expect(status).toBe(200);
			expect(body.subject).toBe("Detailed");
			expect(body.text_body).toBe("Full body text");
			expect(body.html_body).toBe("<p>Full body</p>");
			expect(body.folder_path).toBe("INBOX");
		});

		test("GET /api/messages/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/messages/999");
			expect(status).toBe(404);
		});

		test("DELETE /api/messages/:id deletes message", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);

			const { status } = await jsonRequest(`/api/messages/${msgId}`, { method: "DELETE" });
			expect(status).toBe(200);

			const { status: getStatus } = await jsonRequest(`/api/messages/${msgId}`);
			expect(getStatus).toBe(404);
		});

		test("DELETE /api/messages/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/messages/999", { method: "DELETE" });
			expect(status).toBe(404);
		});
	});

	// ─── Pagination edge cases ───────────────────────────────
	describe("Pagination edge cases", () => {
		test("default limit is 50", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
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

	// ─── Flags ───────────────────────────────────────────────
	describe("Flags", () => {
		let accountId: number;
		let folderId: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
			folderId = createTestFolder(db, accountId, "INBOX");
		});

		test("PATCH /api/messages/:id/flags updates flags", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1, { flags: "" });

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen", "\\Flagged"] }),
			});
			expect(status).toBe(200);
			expect(body.flags).toContain("\\Seen");
			expect(body.flags).toContain("\\Flagged");
		});

		test("PATCH /api/messages/:id/flags can remove flags", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen", "\\Flagged"] }),
			});

			const { body } = await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ remove: ["\\Flagged"] }),
			});
			expect(body.flags).toContain("\\Seen");
			expect(body.flags).not.toContain("\\Flagged");
		});

		test("PATCH /api/messages/:id/flags returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/messages/999/flags", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen"] }),
			});
			expect(status).toBe(404);
		});

		test("adding duplicate flags does not create duplicates", async () => {
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

			const flagCount = body.flags.split("\\Seen").length - 1;
			expect(flagCount).toBe(1);
		});

		test("removing non-existent flag is a no-op", async () => {
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
			const msgId = createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen", "\\Flagged"] }),
			});

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

	// ─── Thread reconstruction ───────────────────────────────
	describe("Thread reconstruction", () => {
		test("GET /api/messages/:id/thread returns thread", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msg1Id = createTestMessage(db, accountId, folderId, 1, {
				messageId: "<thread-1@test.local>",
				subject: "Original",
			});
			createTestMessage(db, accountId, folderId, 2, {
				messageId: "<thread-2@test.local>",
				inReplyTo: "<thread-1@test.local>",
				references: "<thread-1@test.local>",
				subject: "Re: Original",
			});

			const { status, body } = await jsonRequest(`/api/messages/${msg1Id}/thread`);
			expect(status).toBe(200);
			expect(body.length).toBeGreaterThanOrEqual(1);
		});

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

		test("message with NULL message_id returns itself via fallback path", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
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

		test("thread with JSON array references (IMAP sync format) returns all related messages", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");

			createTestMessage(db, accountId, folderId, 1, {
				messageId: "<json-root@test.local>",
				subject: "JSON thread start",
			});
			createTestMessage(db, accountId, folderId, 2, {
				messageId: "<json-reply@test.local>",
				inReplyTo: "<json-root@test.local>",
				references: '["<json-root@test.local>"]',
				subject: "Re: JSON thread start",
			});
			const msg3Id = createTestMessage(db, accountId, folderId, 3, {
				messageId: "<json-reply2@test.local>",
				inReplyTo: "<json-reply@test.local>",
				references: '["<json-root@test.local>","<json-reply@test.local>"]',
				subject: "Re: Re: JSON thread start",
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
			for (const msg of body) {
				expect(msg.id).toBe(msgA);
			}
		});

		test("thread returns 404 for non-existent message", async () => {
			const { status } = await jsonRequest("/api/messages/99999/thread");
			expect(status).toBe(404);
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

	// ─── Bulk operations ────────────────────────────────────
	describe("Bulk operations", () => {
		let accountId: number;
		let folderId: number;
		let msg1: number;
		let msg2: number;
		let msg3: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
			folderId = createTestFolder(db, accountId, "INBOX");
			msg1 = createTestMessage(db, accountId, folderId, 1);
			msg2 = createTestMessage(db, accountId, folderId, 2);
			msg3 = createTestMessage(db, accountId, folderId, 3);
		});

		function bulkPost(payload: unknown) {
			return jsonRequest("/api/messages/bulk", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		}

		describe("input validation", () => {
			test("missing ids returns 400", async () => {
				const { status, body } = await bulkPost({ action: "delete" });
				expect(status).toBe(400);
				expect(body.error).toMatch(/ids/i);
			});

			test("empty ids returns 400", async () => {
				const { status, body } = await bulkPost({ ids: [], action: "delete" });
				expect(status).toBe(400);
				expect(body.error).toMatch(/ids/i);
			});

			test("unknown action returns 400", async () => {
				const { status, body } = await bulkPost({ ids: [msg1], action: "archive" });
				expect(status).toBe(400);
				expect(body.error).toMatch(/action/i);
			});
		});

		describe("action: delete", () => {
			test("deletes multiple messages", async () => {
				const { status, body } = await bulkPost({ ids: [msg1, msg2], action: "delete" });
				expect(status).toBe(200);
				expect(body.ok).toBe(true);
				expect(body.count).toBe(2);

				const remaining = db
					.prepare("SELECT id FROM messages WHERE id IN (?, ?, ?)")
					.all(msg1, msg2, msg3) as { id: number }[];
				expect(remaining.map((r) => r.id)).toEqual([msg3]);
			});

			test("deleting non-existent ids returns count 0", async () => {
				const { status, body } = await bulkPost({ ids: [99999], action: "delete" });
				expect(status).toBe(200);
				expect(body.count).toBe(0);
			});
		});

		describe("action: flag", () => {
			test("marks multiple messages as read", async () => {
				const { status, body } = await bulkPost({
					ids: [msg1, msg2, msg3],
					action: "flag",
					add: ["\\Seen"],
				});
				expect(status).toBe(200);
				expect(body.ok).toBe(true);
				expect(body.count).toBe(3);

				const rows = db
					.prepare("SELECT flags FROM messages WHERE id IN (?, ?, ?)")
					.all(msg1, msg2, msg3) as { flags: string }[];
				for (const row of rows) {
					expect(row.flags).toContain("\\Seen");
				}
			});

			test("marks multiple messages as unread", async () => {
				await bulkPost({ ids: [msg1, msg2], action: "flag", add: ["\\Seen"] });
				const { status, body } = await bulkPost({
					ids: [msg1, msg2],
					action: "flag",
					remove: ["\\Seen"],
				});
				expect(status).toBe(200);
				expect(body.count).toBe(2);

				const rows = db
					.prepare("SELECT flags FROM messages WHERE id IN (?, ?)")
					.all(msg1, msg2) as { flags: string }[];
				for (const row of rows) {
					expect(row.flags ?? "").not.toContain("\\Seen");
				}
			});

			test("missing add and remove returns 400", async () => {
				const { status, body } = await bulkPost({ ids: [msg1], action: "flag" });
				expect(status).toBe(400);
				expect(body.error).toBeDefined();
			});
		});

		describe("action: remove_label", () => {
			test("removes label from multiple messages", async () => {
				// Create a label and link it to messages
				db.prepare("INSERT INTO labels (account_id, name, source) VALUES (?, 'Inbox', 'imap')").run(
					accountId,
				);
				const labelId = (
					db
						.prepare("SELECT id FROM labels WHERE account_id = ? AND name = 'Inbox'")
						.get(accountId) as { id: number }
				).id;
				db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)").run(
					msg1,
					labelId,
				);
				db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)").run(
					msg2,
					labelId,
				);

				const { status, body } = await bulkPost({
					ids: [msg1, msg2],
					action: "remove_label",
					label_id: labelId,
				});
				expect(status).toBe(200);
				expect(body.ok).toBe(true);
				expect(body.count).toBe(2);

				const remaining = db
					.prepare("SELECT message_id FROM message_labels WHERE label_id = ?")
					.all(labelId);
				expect(remaining).toHaveLength(0);
			});

			test("missing label_id returns 400", async () => {
				const { status, body } = await bulkPost({
					ids: [msg1],
					action: "remove_label",
				});
				expect(status).toBe(400);
				expect(body.error).toMatch(/label_id/i);
			});
		});

		describe("action: move", () => {
			test("moves messages to another folder", async () => {
				const targetFolder = createTestFolder(db, accountId, "Archive");

				const { status, body } = await bulkPost({
					ids: [msg1, msg2],
					action: "move",
					folder_id: targetFolder,
				});
				expect(status).toBe(200);
				expect(body.ok).toBe(true);
				expect(body.count).toBe(2);

				const rows = db
					.prepare("SELECT folder_id FROM messages WHERE id IN (?, ?)")
					.all(msg1, msg2) as { folder_id: number }[];
				for (const row of rows) {
					expect(row.folder_id).toBe(targetFolder);
				}
			});

			test("missing folder_id returns 400", async () => {
				const { status, body } = await bulkPost({ ids: [msg1], action: "move" });
				expect(status).toBe(400);
				expect(body.error).toMatch(/folder_id/i);
			});

			test("non-existent folder_id returns 404", async () => {
				const { status, body } = await bulkPost({
					ids: [msg1],
					action: "move",
					folder_id: 99999,
				});
				expect(status).toBe(404);
				expect(body.error).toMatch(/folder/i);
			});
		});
	});
});
