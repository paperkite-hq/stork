import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Inbox API", () => {
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

	describe("GET /api/inbox/unified", () => {
		test("returns empty array when no accounts exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unified");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("returns inbox messages across multiple accounts", async () => {
			// Account 1 with inbox
			const acct1 = createTestAccount(db, { name: "Work", email: "work@example.com" });
			const folder1 = createTestFolder(db, acct1, "INBOX");
			const inboxLabel1 = createTestLabel(db, acct1, "Inbox", { source: "imap" });
			const msg1 = createTestMessage(db, acct1, folder1, 1, {
				subject: "Work message",
				date: "2026-03-25T10:00:00Z",
			});
			addMessageLabel(db, msg1, inboxLabel1);

			// Account 2 with inbox
			const acct2 = createTestAccount(db, { name: "Personal", email: "personal@example.com" });
			const folder2 = createTestFolder(db, acct2, "INBOX");
			const inboxLabel2 = createTestLabel(db, acct2, "Inbox", { source: "imap" });
			const msg2 = createTestMessage(db, acct2, folder2, 1, {
				subject: "Personal message",
				date: "2026-03-25T12:00:00Z",
			});
			addMessageLabel(db, msg2, inboxLabel2);

			const { status, body } = await jsonRequest("/api/inbox/unified");
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			// Sorted by date DESC — personal message (newer) should be first
			expect(body[0].subject).toBe("Personal message");
			expect(body[1].subject).toBe("Work message");
			// Both should include account_id
			expect(body[0].account_id).toBe(acct2);
			expect(body[1].account_id).toBe(acct1);
		});

		test("excludes messages not in inbox label", async () => {
			const acct = createTestAccount(db);
			const folder = createTestFolder(db, acct, "INBOX");
			const inboxLabel = createTestLabel(db, acct, "Inbox", { source: "imap" });
			const sentLabel = createTestLabel(db, acct, "Sent", { source: "imap" });

			const inboxMsg = createTestMessage(db, acct, folder, 1, { subject: "Inbox msg" });
			addMessageLabel(db, inboxMsg, inboxLabel);

			const sentMsg = createTestMessage(db, acct, folder, 2, { subject: "Sent msg" });
			addMessageLabel(db, sentMsg, sentLabel);

			const { status, body } = await jsonRequest("/api/inbox/unified");
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Inbox msg");
		});

		test("supports pagination via limit and offset", async () => {
			const acct = createTestAccount(db);
			const folder = createTestFolder(db, acct, "INBOX");
			const inboxLabel = createTestLabel(db, acct, "Inbox", { source: "imap" });

			for (let i = 1; i <= 5; i++) {
				const msg = createTestMessage(db, acct, folder, i, {
					subject: `Message ${i}`,
					date: `2026-03-${String(i).padStart(2, "0")}T10:00:00Z`,
				});
				addMessageLabel(db, msg, inboxLabel);
			}

			const { body: page1 } = await jsonRequest("/api/inbox/unified?limit=2");
			expect(page1).toHaveLength(2);

			const { body: page2 } = await jsonRequest("/api/inbox/unified?limit=2&offset=2");
			expect(page2).toHaveLength(2);
			expect(page1[0].subject).not.toBe(page2[0].subject);
		});
	});

	describe("GET /api/inbox/unified/count", () => {
		test("returns zeros when no accounts exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unified/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 0, unread: 0 });
		});

		test("counts total and unread across all accounts", async () => {
			const acct1 = createTestAccount(db);
			const folder1 = createTestFolder(db, acct1, "INBOX");
			const inboxLabel1 = createTestLabel(db, acct1, "Inbox", { source: "imap" });

			// Unread message (no \Seen flag)
			const unreadMsg = createTestMessage(db, acct1, folder1, 1, {
				subject: "Unread",
				flags: null,
			});
			addMessageLabel(db, unreadMsg, inboxLabel1);

			// Read message
			const readMsg = createTestMessage(db, acct1, folder1, 2, {
				subject: "Read",
				flags: "\\Seen",
			});
			addMessageLabel(db, readMsg, inboxLabel1);

			const acct2 = createTestAccount(db, { email: "b@example.com" });
			const folder2 = createTestFolder(db, acct2, "INBOX");
			const inboxLabel2 = createTestLabel(db, acct2, "Inbox", { source: "imap" });

			const unreadMsg2 = createTestMessage(db, acct2, folder2, 1, {
				subject: "Also unread",
				flags: null,
			});
			addMessageLabel(db, unreadMsg2, inboxLabel2);

			const { status, body } = await jsonRequest("/api/inbox/unified/count");
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.unread).toBe(2);
		});
	});
});
