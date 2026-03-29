import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	addMessageLabel,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestLabel,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Labels API", () => {
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

	// ─── Label CRUD ─────────────────────────────────────────
	describe("Label CRUD", () => {
		let identityId: number;

		beforeEach(() => {
			identityId = createTestIdentity(db);
		});

		test("GET /api/identities/:id/labels returns empty array initially", async () => {
			const { status, body } = await jsonRequest(`/api/identities/${identityId}/labels`);
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("GET /api/labels returns empty array initially", async () => {
			const { status, body } = await jsonRequest("/api/labels");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/identities/:id/labels creates a global label", async () => {
			const { status, body } = await jsonRequest(`/api/identities/${identityId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Important", color: "#ff0000" }),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: labels } = await jsonRequest(`/api/identities/${identityId}/labels`);
			expect(labels).toHaveLength(1);
			expect(labels[0].name).toBe("Important");
			expect(labels[0].color).toBe("#ff0000");
			expect(labels[0].source).toBe("user");

			// Also visible from the standalone endpoint
			const { body: allLabels } = await jsonRequest("/api/labels");
			expect(allLabels).toHaveLength(1);
		});

		test("POST /api/labels creates a global label", async () => {
			const { status, body } = await jsonRequest("/api/labels", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("GET /api/identities/:id/labels returns same labels regardless of account", async () => {
			const identityId2 = createTestIdentity(db, { email: "second@example.com" });
			createTestLabel(db, "Shared");

			const { body: labels1 } = await jsonRequest(`/api/identities/${identityId}/labels`);
			const { body: labels2 } = await jsonRequest(`/api/identities/${identityId2}/labels`);
			expect(labels1).toHaveLength(1);
			expect(labels2).toHaveLength(1);
			expect(labels1[0].name).toBe("Shared");
			expect(labels2[0].name).toBe("Shared");
		});

		test("POST /api/identities/:id/labels rejects missing name", async () => {
			const { status } = await jsonRequest(`/api/identities/${identityId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("POST /api/identities/:id/labels rejects duplicate name", async () => {
			createTestLabel(db, "Work");
			const { status } = await jsonRequest(`/api/identities/${identityId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});
			expect(status).toBe(409);
		});

		test("POST /api/identities/:id/labels returns 409 for duplicate name", async () => {
			createTestLabel(db, "Work");
			const { status, body } = await jsonRequest(`/api/identities/${identityId}/labels`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Work" }),
			});
			expect(status).toBe(409);
			expect(body.error).toMatch(/already exists/i);
		});

		test("PUT /api/labels/:id updates label", async () => {
			const labelId = createTestLabel(db, "Old Name");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "New Name", color: "#00ff00" }),
			});
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest("/api/labels");
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
			const labelId = createTestLabel(db, "Test");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("DELETE /api/labels/:id deletes label", async () => {
			const labelId = createTestLabel(db, "Temp");
			const { status } = await jsonRequest(`/api/labels/${labelId}`, { method: "DELETE" });
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest("/api/labels");
			expect(labels).toHaveLength(0);
		});

		test("DELETE /api/labels/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/labels/999", { method: "DELETE" });
			expect(status).toBe(404);
		});

		test("GET /api/labels/:id/messages returns labeled messages", async () => {
			const folderId = createTestFolder(db, identityId, "INBOX");
			const labelId = createTestLabel(db, "Inbox", { source: "imap" });
			const msg1 = createTestMessage(db, identityId, folderId, 1, { subject: "Labeled" });
			createTestMessage(db, identityId, folderId, 2, { subject: "Unlabeled" });
			addMessageLabel(db, msg1, labelId);

			const { status, body } = await jsonRequest(`/api/labels/${labelId}/messages`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Labeled");
		});

		test("GET /api/labels/:id/messages supports pagination", async () => {
			const folderId = createTestFolder(db, identityId, "INBOX");
			const labelId = createTestLabel(db, "Inbox");
			for (let i = 1; i <= 5; i++) {
				const msgId = createTestMessage(db, identityId, folderId, i);
				addMessageLabel(db, msgId, labelId);
			}

			const { body: page1 } = await jsonRequest(`/api/labels/${labelId}/messages?limit=2&offset=0`);
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest(`/api/labels/${labelId}/messages?limit=2&offset=2`);
			expect(page2).toHaveLength(2);
			expect(page2[0].id).not.toBe(page1[0].id);
		});

		test("labels include message_count and unread_count", async () => {
			const folderId = createTestFolder(db, identityId, "INBOX");
			const labelId = createTestLabel(db, "Inbox");
			const msg1 = createTestMessage(db, identityId, folderId, 1, {
				flags: "\\Seen",
			});
			const msg2 = createTestMessage(db, identityId, folderId, 2, { flags: "" });
			addMessageLabel(db, msg1, labelId);
			addMessageLabel(db, msg2, labelId);
			// Counts are cached columns — populate them as refreshLabelCounts() would
			db.prepare("UPDATE labels SET message_count = 2, unread_count = 1 WHERE id = ?").run(labelId);

			const { body: labels } = await jsonRequest("/api/labels");
			expect(labels).toHaveLength(1);
			expect(labels[0].message_count).toBe(2);
			expect(labels[0].unread_count).toBe(1);
		});
	});

	// ─── Route parameter validation ────────────────────────
	describe("Route parameter validation", () => {
		test("PUT /api/labels/abc returns 400 for non-numeric labelId", async () => {
			const { status, body } = await jsonRequest("/api/labels/abc", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Test" }),
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/labelId/);
		});

		test("DELETE /api/labels/abc returns 400 for non-numeric labelId", async () => {
			const { status, body } = await jsonRequest("/api/labels/abc", {
				method: "DELETE",
			});
			expect(status).toBe(400);
			expect(body.error).toMatch(/labelId/);
		});

		test("GET /api/labels/abc/messages returns 400 for non-numeric labelId", async () => {
			const { status, body } = await jsonRequest("/api/labels/abc/messages");
			expect(status).toBe(400);
			expect(body.error).toMatch(/labelId/);
		});

		test("GET /api/labels/1/messages?limit=-1 returns 400 for invalid pagination", async () => {
			const { status, body } = await jsonRequest("/api/labels/1/messages?limit=-1");
			expect(status).toBe(400);
			expect(body.error).toMatch(/limit/);
		});
	});

	// ─── Multi-label filter ──────────────────────────────────
	describe("Multi-label filter", () => {
		let identityId: number;
		let folderId: number;

		beforeEach(() => {
			identityId = createTestIdentity(db);
			folderId = createTestFolder(db, identityId, "INBOX");
		});

		test("GET /api/labels/filter returns messages matching all label IDs", async () => {
			const l1 = createTestLabel(db, "Work");
			const l2 = createTestLabel(db, "Important");
			const msg1 = createTestMessage(db, identityId, folderId, 1, { subject: "Both" });
			const msg2 = createTestMessage(db, identityId, folderId, 2, { subject: "OnlyWork" });
			addMessageLabel(db, msg1, l1);
			addMessageLabel(db, msg1, l2);
			addMessageLabel(db, msg2, l1);

			const { status, body } = await jsonRequest(`/api/labels/filter?ids=${l1},${l2}`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Both");
		});

		test("GET /api/labels/filter returns 400 when ids missing", async () => {
			const { status, body } = await jsonRequest("/api/labels/filter");
			expect(status).toBe(400);
			expect(body.error).toMatch(/ids/);
		});

		test("GET /api/labels/filter returns 400 for all-invalid ids", async () => {
			const { status, body } = await jsonRequest("/api/labels/filter?ids=abc,0,-1");
			expect(status).toBe(400);
			expect(body.error).toMatch(/valid label ID/i);
		});

		test("GET /api/labels/filter supports pagination", async () => {
			const l1 = createTestLabel(db, "Tag");
			for (let i = 1; i <= 4; i++) {
				const msgId = createTestMessage(db, identityId, folderId, i);
				addMessageLabel(db, msgId, l1);
			}
			const { body: page1 } = await jsonRequest(`/api/labels/filter?ids=${l1}&limit=2&offset=0`);
			const { body: page2 } = await jsonRequest(`/api/labels/filter?ids=${l1}&limit=2&offset=2`);
			expect(page1).toHaveLength(2);
			expect(page2).toHaveLength(2);
			expect(page1[0].id).not.toBe(page2[0].id);
		});

		test("GET /api/labels/filter returns 400 for invalid pagination", async () => {
			const l1 = createTestLabel(db, "Tag");
			const { status } = await jsonRequest(`/api/labels/filter?ids=${l1}&limit=-1`);
			expect(status).toBe(400);
		});

		test("GET /api/labels/filter/count returns total and unread", async () => {
			const l1 = createTestLabel(db, "Work");
			const l2 = createTestLabel(db, "Urgent");
			const msg1 = createTestMessage(db, identityId, folderId, 1, { flags: "" });
			const msg2 = createTestMessage(db, identityId, folderId, 2, { flags: "\\Seen" });
			addMessageLabel(db, msg1, l1);
			addMessageLabel(db, msg1, l2);
			addMessageLabel(db, msg2, l1);
			addMessageLabel(db, msg2, l2);

			const { status, body } = await jsonRequest(`/api/labels/filter/count?ids=${l1},${l2}`);
			expect(status).toBe(200);
			expect(body.total).toBe(2);
			expect(body.unread).toBe(1);
		});

		test("GET /api/labels/filter/count returns 400 when ids missing", async () => {
			const { status } = await jsonRequest("/api/labels/filter/count");
			expect(status).toBe(400);
		});

		test("GET /api/labels/filter/count returns 400 for all-invalid ids", async () => {
			const { status } = await jsonRequest("/api/labels/filter/count?ids=0,abc");
			expect(status).toBe(400);
		});

		test("GET /api/labels/filter/count returns zeros when no messages match", async () => {
			const l1 = createTestLabel(db, "Empty");
			const { status, body } = await jsonRequest(`/api/labels/filter/count?ids=${l1}`);
			expect(status).toBe(200);
			expect(body.total).toBe(0);
			expect(body.unread).toBe(0);
		});
	});

	// ─── Related labels ───────────────────────────────────────
	describe("Related labels", () => {
		let identityId: number;
		let folderId: number;

		beforeEach(() => {
			identityId = createTestIdentity(db);
			folderId = createTestFolder(db, identityId, "INBOX");
		});

		test("GET /api/labels/:id/related returns co-occurring labels", async () => {
			const l1 = createTestLabel(db, "Inbox");
			const l2 = createTestLabel(db, "Work");
			const l3 = createTestLabel(db, "Personal");
			const msg1 = createTestMessage(db, identityId, folderId, 1);
			const msg2 = createTestMessage(db, identityId, folderId, 2);
			addMessageLabel(db, msg1, l1);
			addMessageLabel(db, msg1, l2);
			addMessageLabel(db, msg2, l1);
			addMessageLabel(db, msg2, l3);

			const { status, body } = await jsonRequest(`/api/labels/${l1}/related`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0]).toHaveProperty("name");
			expect(body[0]).toHaveProperty("co_count");
		});

		test("GET /api/labels/:id/related returns empty array when no co-occurrences", async () => {
			const l1 = createTestLabel(db, "Solo");
			const { status, body } = await jsonRequest(`/api/labels/${l1}/related`);
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("GET /api/labels/:id/related respects limit parameter", async () => {
			const l1 = createTestLabel(db, "Base");
			for (let i = 0; i < 5; i++) {
				const li = createTestLabel(db, `Tag${i}`);
				const msgId = createTestMessage(db, identityId, folderId, i + 1);
				addMessageLabel(db, msgId, l1);
				addMessageLabel(db, msgId, li);
			}
			const { body } = await jsonRequest(`/api/labels/${l1}/related?limit=2`);
			expect(body).toHaveLength(2);
		});

		test("GET /api/labels/abc/related returns 400 for non-numeric id", async () => {
			const { status, body } = await jsonRequest("/api/labels/abc/related");
			expect(status).toBe(400);
			expect(body.error).toMatch(/labelId/);
		});

		test("GET /api/labels/:id/related defaults to limit 5", async () => {
			const l1 = createTestLabel(db, "Base2");
			for (let i = 0; i < 8; i++) {
				const li = createTestLabel(db, `CoTag${i}`);
				const msgId = createTestMessage(db, identityId, folderId, i + 1);
				addMessageLabel(db, msgId, l1);
				addMessageLabel(db, msgId, li);
			}
			const { body } = await jsonRequest(`/api/labels/${l1}/related`);
			expect(body).toHaveLength(5);
		});
	});

	// ─── Message Labels ──────────────────────────────────────
	describe("Message labels", () => {
		let identityId: number;
		let folderId: number;

		beforeEach(() => {
			identityId = createTestIdentity(db);
			folderId = createTestFolder(db, identityId, "INBOX");
		});

		test("POST /api/messages/:id/labels adds labels", async () => {
			const msgId = createTestMessage(db, identityId, folderId, 1);
			const label1 = createTestLabel(db, "Work");
			const label2 = createTestLabel(db, "Important");

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
			const msgId = createTestMessage(db, identityId, folderId, 1);
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
			const msgId = createTestMessage(db, identityId, folderId, 1);
			const labelId = createTestLabel(db, "Work");

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
			const msgId = createTestMessage(db, identityId, folderId, 1);
			const labelId = createTestLabel(db, "Work");
			addMessageLabel(db, msgId, labelId);

			const { status } = await jsonRequest(`/api/messages/${msgId}/labels/${labelId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: labels } = await jsonRequest(`/api/messages/${msgId}/labels`);
			expect(labels).toHaveLength(0);
		});

		test("GET /api/messages/:id/labels returns labels for a message", async () => {
			const msgId = createTestMessage(db, identityId, folderId, 1);
			const label1 = createTestLabel(db, "Inbox", { source: "imap" });
			const label2 = createTestLabel(db, "Personal");
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

	// ─── Related Labels ──────────────────────────────────────
	describe("Related labels", () => {
		let identityId: number;
		let folderId: number;

		beforeEach(() => {
			identityId = createTestIdentity(db);
			folderId = createTestFolder(db, identityId, "INBOX");
		});

		test("GET /api/labels/:id/related returns co-occurring labels sorted by frequency", async () => {
			const inbox = createTestLabel(db, "Inbox");
			const work = createTestLabel(db, "Work");
			const personal = createTestLabel(db, "Personal");

			// 3 messages with Inbox+Work, 1 message with Inbox+Personal
			for (let i = 0; i < 3; i++) {
				const msgId = createTestMessage(db, identityId, folderId, i + 1);
				addMessageLabel(db, msgId, inbox);
				addMessageLabel(db, msgId, work);
			}
			const msg4 = createTestMessage(db, identityId, folderId, 4);
			addMessageLabel(db, msg4, inbox);
			addMessageLabel(db, msg4, personal);

			const { status, body } = await jsonRequest(`/api/labels/${inbox}/related`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			// Work appears 3 times, Personal 1 time — Work should come first
			expect(body[0].name).toBe("Work");
			expect(body[1].name).toBe("Personal");
		});

		test("GET /api/labels/:id/related does not include the label itself", async () => {
			const inbox = createTestLabel(db, "Inbox");
			const work = createTestLabel(db, "Work");
			const msg = createTestMessage(db, identityId, folderId, 1);
			addMessageLabel(db, msg, inbox);
			addMessageLabel(db, msg, work);

			const { status, body } = await jsonRequest(`/api/labels/${inbox}/related`);
			expect(status).toBe(200);
			const ids = (body as { id: number }[]).map((l) => l.id);
			expect(ids).not.toContain(inbox);
		});

		test("GET /api/labels/:id/related returns empty array when no co-occurring labels", async () => {
			const inbox = createTestLabel(db, "Inbox");
			const msg = createTestMessage(db, identityId, folderId, 1);
			addMessageLabel(db, msg, inbox);

			const { status, body } = await jsonRequest(`/api/labels/${inbox}/related`);
			expect(status).toBe(200);
			expect(body).toHaveLength(0);
		});

		test("GET /api/labels/:id/related respects limit parameter", async () => {
			const inbox = createTestLabel(db, "Inbox");
			const labels = [];
			for (let i = 0; i < 6; i++) {
				labels.push(createTestLabel(db, `Label${i}`));
			}
			const msg = createTestMessage(db, identityId, folderId, 1);
			addMessageLabel(db, msg, inbox);
			for (const lId of labels) addMessageLabel(db, msg, lId);

			const { status, body } = await jsonRequest(`/api/labels/${inbox}/related?limit=3`);
			expect(status).toBe(200);
			expect(body).toHaveLength(3);
		});

		test("GET /api/labels/abc/related returns 400 for non-numeric labelId", async () => {
			const { status, body } = await jsonRequest("/api/labels/abc/related");
			expect(status).toBe(400);
			expect(body.error).toMatch(/labelId/);
		});
	});
});
