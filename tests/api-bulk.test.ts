import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "./helpers/test-db.js";

describe("POST /api/messages/bulk", () => {
	let db: Database;
	let app: Hono;
	let scheduler: import("../src/sync/sync-scheduler.js").SyncScheduler;
	let accountId: number;
	let folderId: number;
	let msg1: number;
	let msg2: number;
	let msg3: number;

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
		accountId = createTestAccount(db);
		folderId = createTestFolder(db, accountId, "INBOX");
		msg1 = createTestMessage(db, accountId, folderId, 1);
		msg2 = createTestMessage(db, accountId, folderId, 2);
		msg3 = createTestMessage(db, accountId, folderId, 3);
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

	function bulkPost(payload: unknown) {
		return jsonRequest("/api/messages/bulk", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	}

	// ─── Input validation ─────────────────────────────────────
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

	// ─── Bulk delete ──────────────────────────────────────────
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

	// ─── Bulk flag ────────────────────────────────────────────
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
			// First mark as read
			await bulkPost({ ids: [msg1, msg2], action: "flag", add: ["\\Seen"] });
			// Now unread
			const { status, body } = await bulkPost({
				ids: [msg1, msg2],
				action: "flag",
				remove: ["\\Seen"],
			});
			expect(status).toBe(200);
			expect(body.count).toBe(2);

			const rows = db.prepare("SELECT flags FROM messages WHERE id IN (?, ?)").all(msg1, msg2) as {
				flags: string;
			}[];
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

	// ─── Bulk move ────────────────────────────────────────────
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
