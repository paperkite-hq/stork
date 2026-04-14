import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	addMessageLabel,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestInboundConnector,
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
		test("returns 400 for invalid pagination params", async () => {
			const { status } = await jsonRequest("/api/inbox/unified?limit=abc");
			expect(status).toBe(400);
		});

		test("returns empty array when no accounts exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unified");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("returns inbox messages across multiple inbound connectors", async () => {
			// Connector 1 with inbox
			const inbound1 = createTestInboundConnector(db, { name: "Work Inbound" });
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			const inboxLabel1 = createTestLabel(db, "Inbox", { source: "imap" });
			const msg1 = createTestMessage(db, inbound1, folder1, 1, {
				subject: "Work message",
				date: "2026-03-25T10:00:00Z",
			});
			addMessageLabel(db, msg1, inboxLabel1);

			// Connector 2 with inbox
			const inbound2 = createTestInboundConnector(db, { name: "Personal Inbound" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			const inboxLabel2 = createTestLabel(db, "Inbox", { source: "imap" });
			const msg2 = createTestMessage(db, inbound2, folder2, 1, {
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
			// Both should include inbound_connector_id
			expect(body[0].inbound_connector_id).toBe(inbound2);
			expect(body[1].inbound_connector_id).toBe(inbound1);
		});

		test("excludes messages not in inbox label", async () => {
			const inbound = createTestInboundConnector(db);
			const folder = createTestFolder(db, inbound, "INBOX");
			const inboxLabel = createTestLabel(db, "Inbox", { source: "imap" });
			const sentLabel = createTestLabel(db, "Sent", { source: "imap" });

			const inboxMsg = createTestMessage(db, inbound, folder, 1, { subject: "Inbox msg" });
			addMessageLabel(db, inboxMsg, inboxLabel);

			const sentMsg = createTestMessage(db, inbound, folder, 2, { subject: "Sent msg" });
			addMessageLabel(db, sentMsg, sentLabel);

			const { status, body } = await jsonRequest("/api/inbox/unified");
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].subject).toBe("Inbox msg");
		});

		test("supports pagination via limit and offset", async () => {
			const inbound = createTestInboundConnector(db);
			const folder = createTestFolder(db, inbound, "INBOX");
			const inboxLabel = createTestLabel(db, "Inbox", { source: "imap" });

			for (let i = 1; i <= 5; i++) {
				const msg = createTestMessage(db, inbound, folder, i, {
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

	describe("GET /api/inbox/all-messages", () => {
		test("returns 400 for invalid pagination params", async () => {
			const { status } = await jsonRequest("/api/inbox/all-messages?limit=abc");
			expect(status).toBe(400);
		});

		test("returns empty array when no messages exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/all-messages");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("returns all messages across multiple connectors sorted by date desc", async () => {
			const inbound1 = createTestInboundConnector(db, { name: "Work" });
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			createTestMessage(db, inbound1, folder1, 1, {
				subject: "Work message",
				date: "2026-03-25T10:00:00Z",
			});

			const inbound2 = createTestInboundConnector(db, { name: "Personal" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			createTestMessage(db, inbound2, folder2, 1, {
				subject: "Personal message",
				date: "2026-03-25T12:00:00Z",
			});

			const { status, body } = await jsonRequest("/api/inbox/all-messages");
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0].subject).toBe("Personal message");
			expect(body[1].subject).toBe("Work message");
			expect(body[0].inbound_connector_id).toBe(inbound2);
			expect(body[1].inbound_connector_id).toBe(inbound1);
		});

		test("supports pagination", async () => {
			const inbound = createTestInboundConnector(db);
			const folder = createTestFolder(db, inbound, "INBOX");
			for (let i = 1; i <= 5; i++) {
				createTestMessage(db, inbound, folder, i, {
					subject: `Message ${i}`,
					date: `2026-03-${String(i).padStart(2, "0")}T10:00:00Z`,
				});
			}
			const { body: page1 } = await jsonRequest("/api/inbox/all-messages?limit=2");
			expect(page1).toHaveLength(2);
			const { body: page2 } = await jsonRequest("/api/inbox/all-messages?limit=2&offset=2");
			expect(page2).toHaveLength(2);
			expect(page1[0].subject).not.toBe(page2[0].subject);
		});
	});

	describe("GET /api/inbox/all-messages/count", () => {
		test("returns zeros when no messages exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/all-messages/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 0, unread: 0 });
		});

		test("counts total and unread across all connectors", async () => {
			const inbound1 = createTestInboundConnector(db);
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			createTestMessage(db, inbound1, folder1, 1, { subject: "Unread", flags: null });
			createTestMessage(db, inbound1, folder1, 2, { subject: "Read", flags: "\\Seen" });

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			createTestMessage(db, inbound2, folder2, 1, { subject: "Also unread", flags: null });

			const { status, body } = await jsonRequest("/api/inbox/all-messages/count");
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.unread).toBe(2);
		});

		test("returns cached connector counts when available", async () => {
			const inbound1 = createTestInboundConnector(db);
			db.prepare(
				"UPDATE inbound_connectors SET cached_message_count = 100, cached_unread_count = 25 WHERE id = ?",
			).run(inbound1);

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			db.prepare(
				"UPDATE inbound_connectors SET cached_message_count = 50, cached_unread_count = 10 WHERE id = ?",
			).run(inbound2);

			const { status, body } = await jsonRequest("/api/inbox/all-messages/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 150, unread: 35 });
		});
	});

	describe("GET /api/inbox/unread-messages", () => {
		test("returns 400 for invalid pagination params", async () => {
			const { status } = await jsonRequest("/api/inbox/unread-messages?limit=abc");
			expect(status).toBe(400);
		});

		test("returns empty array when no unread messages exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unread-messages");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("returns only unread messages across all connectors", async () => {
			const inbound1 = createTestInboundConnector(db, { imapUser: "a@example.com" });
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			createTestMessage(db, inbound1, folder1, 1, {
				subject: "Unread",
				flags: null,
				date: "2026-03-25T10:00:00Z",
			});
			createTestMessage(db, inbound1, folder1, 2, { subject: "Read", flags: "\\Seen" });

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			createTestMessage(db, inbound2, folder2, 1, {
				subject: "Also unread",
				flags: null,
				date: "2026-03-25T12:00:00Z",
			});

			const { status, body } = await jsonRequest("/api/inbox/unread-messages");
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0].subject).toBe("Also unread");
			expect(body[1].subject).toBe("Unread");
			expect(body.find((m: { subject: string }) => m.subject === "Read")).toBeUndefined();
			expect(body[0].inbound_connector_id).toBe(inbound2);
			expect(body[1].inbound_connector_id).toBe(inbound1);
		});
	});

	describe("GET /api/inbox/unread-messages/count", () => {
		test("returns zero when no unread messages", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unread-messages/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 0 });
		});

		test("counts unread messages across all connectors", async () => {
			const inbound1 = createTestInboundConnector(db);
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			createTestMessage(db, inbound1, folder1, 1, { flags: null });
			createTestMessage(db, inbound1, folder1, 2, { flags: "\\Seen" });

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			createTestMessage(db, inbound2, folder2, 1, { flags: null });

			const { status, body } = await jsonRequest("/api/inbox/unread-messages/count");
			expect(status).toBe(200);
			expect(body.total).toBe(2);
		});

		test("returns cached unread count when available", async () => {
			const inbound1 = createTestInboundConnector(db);
			db.prepare("UPDATE inbound_connectors SET cached_unread_count = 15 WHERE id = ?").run(
				inbound1,
			);

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			db.prepare("UPDATE inbound_connectors SET cached_unread_count = 8 WHERE id = ?").run(
				inbound2,
			);

			const { status, body } = await jsonRequest("/api/inbox/unread-messages/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 23 });
		});
	});

	describe("GET /api/inbox/unified/count", () => {
		test("returns zeros when no accounts exist", async () => {
			const { status, body } = await jsonRequest("/api/inbox/unified/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 0, unread: 0 });
		});

		test("counts total and unread across all connectors", async () => {
			const inbound1 = createTestInboundConnector(db);
			const folder1 = createTestFolder(db, inbound1, "INBOX");
			const inboxLabel1 = createTestLabel(db, "Inbox", { source: "imap" });

			// Unread message (no \Seen flag)
			const unreadMsg = createTestMessage(db, inbound1, folder1, 1, {
				subject: "Unread",
				flags: null,
			});
			addMessageLabel(db, unreadMsg, inboxLabel1);

			// Read message
			const readMsg = createTestMessage(db, inbound1, folder1, 2, {
				subject: "Read",
				flags: "\\Seen",
			});
			addMessageLabel(db, readMsg, inboxLabel1);

			const inbound2 = createTestInboundConnector(db, { imapUser: "b@example.com" });
			const folder2 = createTestFolder(db, inbound2, "INBOX");
			const inboxLabel2 = createTestLabel(db, "Inbox", { source: "imap" });

			const unreadMsg2 = createTestMessage(db, inbound2, folder2, 1, {
				subject: "Also unread",
				flags: null,
			});
			addMessageLabel(db, unreadMsg2, inboxLabel2);

			const { status, body } = await jsonRequest("/api/inbox/unified/count");
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.unread).toBe(2);
		});

		test("returns cached counts when label cache is populated", async () => {
			const inboxLabel = createTestLabel(db, "Inbox", { source: "imap" });
			db.prepare("UPDATE labels SET message_count = 42, unread_count = 7 WHERE id = ?").run(
				inboxLabel,
			);

			const { status, body } = await jsonRequest("/api/inbox/unified/count");
			expect(status).toBe(200);
			expect(body).toEqual({ total: 42, unread: 7 });
		});
	});
});
