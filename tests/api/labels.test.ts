import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "../helpers/test-db.js";

describe("Labels API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../src/sync/sync-scheduler.js").SyncScheduler;

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

	// ─── Label CRUD ─────────────────────────────────────────
	describe("Label CRUD", () => {
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

		test("POST /api/accounts/:id/labels returns 409 for duplicate name", async () => {
			createTestLabel(db, accountId, "Work");
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});
			expect(status).toBe(409);
			expect(body.error).toMatch(/already exists/i);
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
				flags: "\\Seen",
			});
			const msg2 = createTestMessage(db, accountId, folderId, 2, { flags: "" });
			addMessageLabel(db, msg1, labelId);
			addMessageLabel(db, msg2, labelId);

			const { body: labels } = await jsonRequest(`/api/accounts/${accountId}/labels`);
			expect(labels).toHaveLength(1);
			expect(labels[0].message_count).toBe(2);
			expect(labels[0].unread_count).toBe(1);
		});
	});

	// ─── Message Labels ──────────────────────────────────────
	describe("Message labels", () => {
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
});
