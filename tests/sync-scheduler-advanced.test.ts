import type Database from "@signalapp/better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SyncScheduler } from "../src/sync/sync-scheduler.js";
import { MockImapServer } from "./helpers/mock-imap-server.js";
import { createTestAccount, createTestDb } from "./helpers/test-db.js";

let db: Database.Database;
let scheduler: SyncScheduler;
let mockServer: MockImapServer;

const EMPTY_INBOX = [
	{
		path: "INBOX",
		name: "INBOX",
		delimiter: "/",
		flags: [],
		specialUse: "\\Inbox",
		uidValidity: 1,
		uidNext: 1,
		messages: [],
	},
];

const MESSAGE_INBOX = [
	{
		path: "INBOX",
		name: "INBOX",
		delimiter: "/",
		flags: [],
		specialUse: "\\Inbox",
		uidValidity: 1,
		uidNext: 2,
		messages: [
			{
				uid: 1,
				flags: ["\\Seen"],
				internalDate: "2026-01-01T00:00:00Z",
				source: [
					"From: sender@test.local",
					"To: user@test.local",
					"Subject: Test",
					"Message-ID: <1@test>",
					"Date: Wed, 01 Jan 2026 00:00:00 +0000",
					"",
					"Hello",
				].join("\r\n"),
			},
		],
	},
];

function makeImapConfig(port: number, user = "testuser", pass = "testpass") {
	return {
		host: "127.0.0.1",
		port,
		secure: false,
		auth: { user, pass },
	};
}

beforeEach(() => {
	db = createTestDb();
});

afterEach(async () => {
	if (scheduler) await scheduler.stop();
	if (mockServer) await mockServer.stop();
	db.close();
});

describe("SyncScheduler runSync paths", () => {
	test("syncNow runs a successful sync against mock IMAP", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: MESSAGE_INBOX,
		});
		const port = await mockServer.start();
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });

		let completeCalled = false;
		scheduler = new SyncScheduler(db, {
			defaultIntervalMs: 999999,
			onSyncComplete: (id) => {
				completeCalled = true;
				expect(id).toBe(accountId);
			},
		});

		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });
		const result = await scheduler.syncNow(accountId);
		expect(result).toBeDefined();
		expect(completeCalled).toBe(true);
		expect(scheduler.getStatus().get(accountId)?.lastSync).toBeTruthy();
	});

	test("syncNow reports error via onSyncError on auth failure", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		let errorCalled = false;
		scheduler = new SyncScheduler(db, {
			defaultIntervalMs: 999999,
			onSyncError: (id) => {
				errorCalled = true;
				expect(id).toBe(1);
			},
		});

		// Wrong password triggers auth failure
		scheduler.addAccount({
			accountId: 1,
			imapConfig: makeImapConfig(port, "testuser", "wrongpass"),
		});

		await expect(scheduler.syncNow(1)).rejects.toThrow();
		expect(errorCalled).toBe(true);

		const status = scheduler.getStatus().get(1);
		expect(status?.consecutiveErrors).toBe(1);
		expect(status?.lastError).toBeTruthy();
	});

	test("syncNow throws when account is already syncing", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 999999 });
		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });

		const firstSync = scheduler.syncNow(accountId);
		await expect(scheduler.syncNow(accountId)).rejects.toThrow("already syncing");
		await firstSync.catch(() => {});
	});

	test("start triggers immediate sync for registered accounts", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });

		let completeCalled = false;
		scheduler = new SyncScheduler(db, {
			defaultIntervalMs: 999999,
			onSyncComplete: () => {
				completeCalled = true;
			},
		});

		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });
		scheduler.start();

		// Wait for the initial sync to complete
		await new Promise((r) => setTimeout(r, 3000));
		expect(completeCalled).toBe(true);
	});

	test("stop aborts running syncs and clears timers", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 200 });
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });
		scheduler.addAccount({
			accountId,
			imapConfig: makeImapConfig(port),
		});

		scheduler.start();
		await new Promise((r) => setTimeout(r, 500));

		const stopStart = Date.now();
		await scheduler.stop();
		const elapsed = Date.now() - stopStart;

		expect(elapsed).toBeLessThan(6000);
		expect(scheduler.getStatus().get(accountId)?.running).toBe(false);
	});

	test("addAccount after start triggers immediate sync", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		let completedAccountId: number | null = null;
		scheduler = new SyncScheduler(db, {
			defaultIntervalMs: 999999,
			onSyncComplete: (id) => {
				completedAccountId = id;
			},
		});

		scheduler.start();

		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });
		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });

		await new Promise((r) => setTimeout(r, 3000));
		expect(completedAccountId).toBe(accountId);
	});

	test("removeAccount with active timer clears the timer", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 100 });
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });
		scheduler.addAccount({
			accountId,
			imapConfig: makeImapConfig(port),
		});
		scheduler.start();

		await new Promise((r) => setTimeout(r, 300));
		scheduler.removeAccount(accountId);
		expect(scheduler.getStatus().has(accountId)).toBe(false);
	});

	test("removeAccount for non-existent account is no-op", () => {
		scheduler = new SyncScheduler(db);
		scheduler.removeAccount(999);
	});

	test("consecutive errors accumulate on repeated failures", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		scheduler = new SyncScheduler(db, {
			defaultIntervalMs: 999999,
		});

		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });
		scheduler.addAccount({
			accountId,
			imapConfig: makeImapConfig(port, "testuser", "wrongpass"),
		});

		for (let i = 0; i < 3; i++) {
			await scheduler.syncNow(accountId).catch(() => {});
		}

		const status = scheduler.getStatus().get(accountId);
		expect(status?.consecutiveErrors).toBe(3);
		expect(status?.lastError).toBeTruthy();
	});

	test("successful sync resets consecutive errors", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 999999 });

		// First: fail with wrong password
		scheduler.addAccount({
			accountId,
			imapConfig: makeImapConfig(port, "testuser", "wrongpass"),
		});
		await scheduler.syncNow(accountId).catch(() => {});
		expect(scheduler.getStatus().get(accountId)?.consecutiveErrors).toBe(1);

		// Fix config: remove and re-add with correct password
		scheduler.removeAccount(accountId);
		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });
		await scheduler.syncNow(accountId);
		expect(scheduler.getStatus().get(accountId)?.consecutiveErrors).toBe(0);
		expect(scheduler.getStatus().get(accountId)?.lastSync).toBeTruthy();
	});

	test("progress is null after sync completes", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();
		const accountId = createTestAccount(db, { imapPort: port, imapHost: "127.0.0.1" });

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 999999 });
		scheduler.addAccount({ accountId, imapConfig: makeImapConfig(port) });

		await scheduler.syncNow(accountId);
		expect(scheduler.getStatus().get(accountId)?.progress).toBeNull();
		expect(scheduler.getStatus().get(accountId)?.running).toBe(false);
	});

	test("loadAccountsFromDb creates correct IMAP configs", async () => {
		mockServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: EMPTY_INBOX,
		});
		const port = await mockServer.start();

		createTestAccount(db, { name: "Acc1", imapPort: port, imapHost: "127.0.0.1" });
		createTestAccount(db, { name: "Acc2", imapPort: port, imapHost: "127.0.0.1" });

		scheduler = new SyncScheduler(db, { defaultIntervalMs: 999999 });
		scheduler.loadAccountsFromDb();

		expect(scheduler.getStatus().size).toBe(2);
	});
});
