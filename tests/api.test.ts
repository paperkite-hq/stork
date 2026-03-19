import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "./helpers/test-db.js";

describe("API routes", () => {
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

	// Helper to make requests against the Hono app
	async function request(path: string, init?: RequestInit) {
		return app.request(path, init);
	}

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await request(path, init);
		const body = await res.json();
		return { status: res.status, body };
	}

	// ─── Health ─────────────────────────────────────────────
	describe("GET /api/health", () => {
		test("returns status ok", async () => {
			const { status, body } = await jsonRequest("/api/health");
			expect(status).toBe(200);
			expect(body).toEqual({ status: "ok", version: "0.1.0" });
		});
	});

	// ─── Accounts ───────────────────────────────────────────
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

			// Verify it appears in the list
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
			// Should not include passwords
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

			// Insert a sync_state row
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

	// ─── Messages ───────────────────────────────────────────
	describe("Messages", () => {
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

		test("GET /api/messages/:id/thread returns thread", async () => {
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

		test("PATCH /api/messages/:id/flags updates flags", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1, {
				flags: "[]",
			});

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

			// First add
			await jsonRequest(`/api/messages/${msgId}/flags`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ add: ["\\Seen", "\\Flagged"] }),
			});

			// Then remove one
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

		test("DELETE /api/messages/:id deletes message", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);

			const { status } = await jsonRequest(`/api/messages/${msgId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { status: getStatus } = await jsonRequest(`/api/messages/${msgId}`);
			expect(getStatus).toBe(404);
		});

		test("DELETE /api/messages/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/messages/999", {
				method: "DELETE",
			});
			expect(status).toBe(404);
		});
	});

	// ─── Attachments ────────────────────────────────────────
	describe("Attachments", () => {
		test("GET /api/messages/:id/attachments returns attachments", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1, {
				hasAttachments: 1,
			});

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'test.pdf', 'application/pdf', 1024, X'48656C6C6F')
			`).run(msgId);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/attachments`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].filename).toBe("test.pdf");
			expect(body[0].content_type).toBe("application/pdf");
		});

		test("GET /api/attachments/:id downloads binary", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'test.txt', 'text/plain', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("text/plain");
			expect(res.headers.get("Content-Disposition")).toContain("test.txt");
			const data = await res.arrayBuffer();
			expect(Buffer.from(data).toString()).toBe("Hello");
		});

		test("GET /api/attachments/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/attachments/999");
			expect(status).toBe(404);
		});
	});

	// ─── Search ─────────────────────────────────────────────
	describe("Search", () => {
		test("GET /api/search returns results", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1, {
				subject: "Quarterly report",
				textBody: "Here is the Q4 quarterly report with budget data.",
			});
			createTestMessage(db, accountId, folderId, 2, {
				subject: "Lunch plans",
				textBody: "Let's get pizza tomorrow.",
			});

			const { status, body } = await jsonRequest("/api/search?q=quarterly");
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Quarterly report");
		});

		test("GET /api/search requires q parameter", async () => {
			const { status } = await jsonRequest("/api/search");
			expect(status).toBe(400);
		});

		test("GET /api/search respects limit", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			for (let i = 1; i <= 5; i++) {
				createTestMessage(db, accountId, folderId, i, {
					subject: `Test message ${i}`,
					textBody: "common keyword in all messages",
				});
			}

			const { body } = await jsonRequest("/api/search?q=common&limit=2");
			expect(body).toHaveLength(2);
		});
	});

	// ─── Labels ────────────────────────────────────────────
	describe("Labels", () => {
		let accountId: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
		});

		test("GET /api/accounts/:id/labels returns empty array initially", async () => {
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/accounts/:id/labels creates a label", async () => {
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Important", color: "#ff0000" }),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: labels } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(labels).toHaveLength(1);
			expect(labels[0].name).toBe("Important");
			expect(labels[0].color).toBe("#ff0000");
			expect(labels[0].source).toBe("user");
		});

		test("POST /api/accounts/:id/labels rejects missing name", async () => {
			const { status } = await jsonRequest(`/api/accounts/${accountId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("POST /api/accounts/:id/labels rejects duplicate name", async () => {
			createTestLabel(db, accountId, "Work");
			const { status } = await jsonRequest(`/api/accounts/${accountId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});
			expect(status).toBe(409);
		});

		test("PUT /api/labels/:id updates label", async () => {
			const labelId = createTestLabel(db, accountId, "Old Name");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "New Name", color: "#00ff00" }),
			});
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(labels[0].name).toBe("New Name");
			expect(labels[0].color).toBe("#00ff00");
		});

		test("PUT /api/labels/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/labels/999", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test" }),
			});
			expect(status).toBe(404);
		});

		test("PUT /api/labels/:id rejects empty update", async () => {
			const labelId = createTestLabel(db, accountId, "Test");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("DELETE /api/labels/:id deletes label", async () => {
			const labelId = createTestLabel(db, accountId, "Temp");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, { method: "DELETE" });
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(labels).toHaveLength(0);
		});

		test("DELETE /api/labels/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/labels/999", { method: "DELETE" });
			expect(status).toBe(404);
		});

		test("GET /api/labels/:id/messages returns labeled messages", async () => {
			const folderId = createTestFolder(db, accountId, "INBOX");
			const labelId = createTestLabel(db, accountId, "Inbox", { source: "imap" });
			const msg1 = createTestMessage(db, accountId, folderId, 1, { subject: "Labeled" });
			createTestMessage(db, accountId, folderId, 2, { subject: "Unlabeled" });
			addMessageLabel(db, msg1, labelId);

			const { status, body } = await jsonRequest(`/api/labels/${labelId}/messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Labeled");
		});

		test("GET /api/labels/:id/messages supports pagination", async () => {
			const folderId = createTestFolder(db, accountId, "INBOX");
			const labelId = createTestLabel(db, accountId, "Inbox");
			for (let i = 1; i <= 5; i++) {
				const msgId = createTestMessage(db, accountId, folderId, i);
				addMessageLabel(db, msgId, labelId);
			}

			const { body: page1 } = await jsonRequest(`/api/labels/${labelId}/messages?limit=2&offset=0`);
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest(`/api/labels/${labelId}/messages?limit=2&offset=2`);
			expect(page2).toHaveLength(2);
			expect(page2[0].id).not.toBe(page1[0].id);
		});

		test("labels include message_count and unread_count", async () => {
			const folderId = createTestFolder(db, accountId, "INBOX");
			const labelId = createTestLabel(db, accountId, "Inbox");
			const msg1 = createTestMessage(db, accountId, folderId, 1, {
				flags: '["\\\\Seen"]',
			});
			const msg2 = createTestMessage(db, accountId, folderId, 2, { flags: "[]" });
			addMessageLabel(db, msg1, labelId);
			addMessageLabel(db, msg2, labelId);

			const { body: labels } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(labels).toHaveLength(1);
			expect(labels[0].message_count).toBe(2);
			expect(labels[0].unread_count).toBe(1);
		});
	});

	// ─── Message Labels ─────────────────────────────────────
	describe("Message Labels", () => {
		let accountId: number;
		let folderId: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
			folderId = createTestFolder(db, accountId, "INBOX");
		});

		test("POST /api/messages/:id/labels adds labels", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);
			const label1 = createTestLabel(db, accountId, "Work");
			const label2 = createTestLabel(db, accountId, "Important");

			const { status } = await jsonRequest(`/api/messages/${msgId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ label_ids: [label1, label2] }),
			});
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest(`/api/messages/${msgId}/labels`);
			expect(labels).toHaveLength(2);
			expect(labels.map((l: { name: string }) => l.name).sort()).toEqual(["Important", "Work"]);
		});

		test("POST /api/messages/:id/labels rejects missing label_ids", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);
			const { status } = await jsonRequest(`/api/messages/${msgId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("POST /api/messages/:id/labels returns 404 for missing message", async () => {
			const { status } = await jsonRequest("/api/messages/999/labels", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ label_ids: [1] }),
			});
			expect(status).toBe(404);
		});

		test("POST /api/messages/:id/labels is idempotent", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);
			const labelId = createTestLabel(db, accountId, "Work");

			// Add twice
			await jsonRequest(`/api/messages/${msgId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ label_ids: [labelId] }),
			});
			await jsonRequest(`/api/messages/${msgId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ label_ids: [labelId] }),
			});

			const { body: labels } = await jsonRequest(`/api/messages/${msgId}/labels`);
			expect(labels).toHaveLength(1);
		});

		test("DELETE /api/messages/:id/labels/:labelId removes label", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);
			const labelId = createTestLabel(db, accountId, "Work");
			addMessageLabel(db, msgId, labelId);

			const { status } = await jsonRequest(`/api/messages/${msgId}/labels/${labelId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest(`/api/messages/${msgId}/labels`);
			expect(labels).toHaveLength(0);
		});

		test("GET /api/messages/:id/labels returns labels for a message", async () => {
			const msgId = createTestMessage(db, accountId, folderId, 1);
			const label1 = createTestLabel(db, accountId, "Inbox", { source: "imap" });
			const label2 = createTestLabel(db, accountId, "Personal");
			addMessageLabel(db, msgId, label1);
			addMessageLabel(db, msgId, label2);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/labels`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0]).toHaveProperty("name");
			expect(body[0]).toHaveProperty("color");
			expect(body[0]).toHaveProperty("source");
		});
	});

	// ─── Sync status ────────────────────────────────────────
	describe("Sync status", () => {
		test("GET /api/sync/status returns sync info", async () => {
			const { status, body } = await jsonRequest("/api/sync/status");
			expect(status).toBe(200);
			expect(typeof body).toBe("object");
		});
	});
});
