import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "../helpers/test-db.js";

describe("Search API", () => {
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

	describe("GET /api/search", () => {
		test("returns matching results", async () => {
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

		test("requires q parameter", async () => {
			const { status } = await jsonRequest("/api/search");
			expect(status).toBe(400);
		});

		test("empty q parameter returns 400", async () => {
			const { status } = await jsonRequest("/api/search?q=");
			expect(status).toBe(400);
		});

		test("respects limit parameter", async () => {
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

		test("supports account_id filter", async () => {
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
});
