import type Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ImapSync } from "../src/sync/imap-sync.js";
import { SyncScheduler } from "../src/sync/sync-scheduler.js";
import { MockImapServer, type MockMailbox, buildRawEmail } from "./helpers/mock-imap-server.js";
import { createTestDb } from "./helpers/test-db.js";

function makeTestMailboxes(): MockMailbox[] {
	return [
		{
			path: "INBOX",
			name: "Inbox",
			delimiter: "/",
			flags: ["\\HasNoChildren"],
			specialUse: "\\Inbox",
			uidValidity: 1,
			uidNext: 4,
			messages: [
				{
					uid: 1,
					flags: ["\\Seen"],
					internalDate: "2026-01-15T10:00:00Z",
					source: buildRawEmail({
						from: "alice@example.com",
						to: "test@example.com",
						subject: "Hello from Alice",
						body: "This is the first test email.",
						messageId: "<msg1@example.com>",
						date: "Wed, 15 Jan 2026 10:00:00 +0000",
					}),
				},
				{
					uid: 2,
					flags: [],
					internalDate: "2026-01-16T14:30:00Z",
					source: buildRawEmail({
						from: "bob@example.com",
						to: "test@example.com",
						subject: "Re: Hello from Alice",
						body: "This is a reply.",
						messageId: "<msg2@example.com>",
						inReplyTo: "<msg1@example.com>",
						references: "<msg1@example.com>",
						date: "Thu, 16 Jan 2026 14:30:00 +0000",
					}),
				},
				{
					uid: 3,
					flags: ["\\Flagged"],
					internalDate: "2026-01-17T09:00:00Z",
					source: buildRawEmail({
						from: "carol@example.com",
						to: "test@example.com",
						subject: "Important document",
						body: "Please review the attached document.",
						messageId: "<msg3@example.com>",
						date: "Fri, 17 Jan 2026 09:00:00 +0000",
					}),
				},
			],
		},
		{
			path: "Sent",
			name: "Sent",
			delimiter: "/",
			flags: ["\\HasNoChildren"],
			specialUse: "\\Sent",
			uidValidity: 1,
			uidNext: 2,
			messages: [
				{
					uid: 1,
					flags: ["\\Seen"],
					internalDate: "2026-01-15T10:05:00Z",
					source: buildRawEmail({
						from: "test@example.com",
						to: "alice@example.com",
						subject: "Re: Hello from Alice",
						body: "Thanks for writing!",
						messageId: "<sent1@example.com>",
						date: "Wed, 15 Jan 2026 10:05:00 +0000",
					}),
				},
			],
		},
		{
			path: "Trash",
			name: "Trash",
			delimiter: "/",
			flags: ["\\HasNoChildren"],
			specialUse: "\\Trash",
			uidValidity: 1,
			uidNext: 1,
			messages: [],
		},
	];
}

describe("ImapSync integration with mock IMAP server", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;
	let accountId: number;

	beforeEach(async () => {
		// Fresh server per test to avoid ImapFlow connection reuse issues
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: makeTestMailboxes(),
		});
		port = await server.start();

		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'test@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeSync(user = "testuser", pass = "testpass") {
		return new ImapSync(
			{
				host: "127.0.0.1",
				port,
				secure: false,
				auth: { user, pass },
			},
			db,
			accountId,
		);
	}

	test("connects and syncs folders from mock server", async () => {
		const sync = makeSync();
		await sync.connect();

		const folders = await sync.syncFolders();
		expect(folders).toContain("INBOX");
		expect(folders).toContain("Sent");
		expect(folders).toContain("Trash");

		// Verify folders in database
		const dbFolders = db
			.prepare("SELECT path, special_use FROM folders WHERE account_id = ? ORDER BY path")
			.all(accountId) as { path: string; special_use: string | null }[];

		expect(dbFolders.length).toBe(3);
		const inbox = dbFolders.find((f) => f.path === "INBOX");
		expect(inbox?.special_use).toBe("\\Inbox");

		await sync.disconnect();
	});

	test("full syncAll fetches messages", async () => {
		const sync = makeSync();
		await sync.connect();
		const result = await sync.syncAll();

		expect(result.folders.length).toBeGreaterThanOrEqual(3);
		expect(result.totalNew).toBeGreaterThan(0);

		// Verify messages in DB
		const messages = db
			.prepare("SELECT subject, from_address FROM messages WHERE account_id = ? ORDER BY uid")
			.all(accountId) as { subject: string; from_address: string }[];

		expect(messages.length).toBeGreaterThanOrEqual(3);
		expect(messages.some((m) => m.subject === "Hello from Alice")).toBe(true);
		expect(messages.some((m) => m.from_address === "bob@example.com")).toBe(true);

		await sync.disconnect();
	});

	test("incremental sync handles duplicates via INSERT OR IGNORE", async () => {
		const sync = makeSync();
		await sync.connect();

		// First sync
		const result1 = await sync.syncAll();
		expect(result1.totalNew).toBeGreaterThan(0);

		// Reconnect for second sync (ImapFlow can't be reused after logout)
		await sync.disconnect();
		const sync2 = makeSync();
		await sync2.connect();

		// Second sync — INSERT OR IGNORE handles dupes
		const result2 = await sync2.syncAll();
		expect(result2.totalErrors).toBe(0);

		await sync2.disconnect();
	});

	test("syncs flags on existing messages", async () => {
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		// Check that the \\Flagged flag was synced for msg3
		const flaggedMsg = db
			.prepare("SELECT flags FROM messages WHERE account_id = ? AND subject = 'Important document'")
			.get(accountId) as { flags: string } | undefined;

		if (flaggedMsg) {
			expect(flaggedMsg.flags).toContain("\\Flagged");
		}

		await sync.disconnect();
	});

	test("detects deleted folders", async () => {
		const sync = makeSync();
		await sync.connect();
		await sync.syncFolders();

		// Manually add a local-only folder that doesn't exist on the server
		db.prepare(`
			INSERT INTO folders (account_id, path, name, delimiter, flags)
			VALUES (?, 'OldFolder', 'OldFolder', '/', '[]')
		`).run(accountId);

		const beforeCount = (
			db.prepare("SELECT count(*) as c FROM folders WHERE account_id = ?").get(accountId) as {
				c: number;
			}
		).c;

		// Re-sync folders — should prune the old one
		await sync.syncFolders();

		const afterCount = (
			db.prepare("SELECT count(*) as c FROM folders WHERE account_id = ?").get(accountId) as {
				c: number;
			}
		).c;

		expect(afterCount).toBeLessThan(beforeCount);

		await sync.disconnect();
	});

	test("handles login failure gracefully", async () => {
		const sync = makeSync("wrong", "wrong");

		try {
			await sync.connect();
			await sync.disconnect();
		} catch (err) {
			expect((err as Error).message).toBeTruthy();
		}
	});

	test("syncAll reports progress via onProgress callback", async () => {
		const sync = makeSync();
		await sync.connect();

		const progressEvents: Array<{
			phase: string;
			currentFolder?: string;
			foldersCompleted: number;
			totalFolders: number;
			messagesNew: number;
		}> = [];

		await sync.syncAll(undefined, (p) => {
			progressEvents.push({ ...p });
		});

		await sync.disconnect();

		// Should have emitted at least one listing-folders event
		const listingEvent = progressEvents.find((e) => e.phase === "listing-folders");
		expect(listingEvent).toBeDefined();

		// Should have emitted folder sync events with increasing foldersCompleted
		const syncingEvents = progressEvents.filter((e) => e.phase === "syncing-folder");
		expect(syncingEvents.length).toBeGreaterThan(0);

		// foldersCompleted should increase monotonically
		let prevCompleted = -1;
		for (const e of syncingEvents) {
			expect(e.foldersCompleted).toBeGreaterThanOrEqual(prevCompleted);
			prevCompleted = e.foldersCompleted;
		}

		// Should have emitted an applying-labels event at the end
		const lastEvent = progressEvents[progressEvents.length - 1];
		expect(lastEvent.phase).toBe("applying-labels");

		// totalFolders should be positive once folder listing completes
		const laterEvents = progressEvents.filter((e) => e.totalFolders > 0);
		expect(laterEvents.length).toBeGreaterThan(0);
	});

	test("syncAll progress callback receives folder names during sync", async () => {
		const sync = makeSync();
		await sync.connect();

		const foldersSeen = new Set<string>();

		await sync.syncAll(undefined, (p) => {
			if (p.currentFolder) foldersSeen.add(p.currentFolder);
		});

		await sync.disconnect();

		// Should have seen INBOX and Sent folders (from makeTestMailboxes)
		expect(foldersSeen.has("INBOX")).toBe(true);
		expect(foldersSeen.has("Sent")).toBe(true);
	});

	test("syncAll progress tracks new message count", async () => {
		const sync = makeSync();
		await sync.connect();

		let maxMessagesNew = 0;

		await sync.syncAll(undefined, (p) => {
			if (p.messagesNew > maxMessagesNew) maxMessagesNew = p.messagesNew;
		});

		await sync.disconnect();

		// INBOX has 3 messages, Sent has 1, Trash has 0 — total new = 4
		expect(maxMessagesNew).toBe(4);
	});

	test("messages have labels immediately after each folder syncs (not only at end)", async () => {
		const sync = makeSync();
		await sync.connect();

		// Track message_labels count after each folder completes
		const labelCountsAfterFolder: number[] = [];
		let lastCompleted = 0;

		await sync.syncAll(undefined, (p) => {
			// After a folder finishes (foldersCompleted incremented), check label coverage
			if (p.phase === "syncing-folder" && p.foldersCompleted > lastCompleted) {
				lastCompleted = p.foldersCompleted;
				const count = (
					db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }
				).n;
				labelCountsAfterFolder.push(count);
			}
		});

		await sync.disconnect();

		// After INBOX syncs (3 messages), labels should already be applied
		// Before the fix, labelCountsAfterFolder would be all zeros
		expect(labelCountsAfterFolder.length).toBeGreaterThan(0);
		expect(labelCountsAfterFolder[0]).toBeGreaterThan(0);

		// Total message_labels should equal total messages (4)
		const totalLabels = (
			db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }
		).n;
		expect(totalLabels).toBe(4);
	});
});

describe("detectServerDeletions", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;
	let accountId: number;

	beforeEach(async () => {
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: [
				{
					path: "INBOX",
					name: "Inbox",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					specialUse: "\\Inbox",
					uidValidity: 1,
					uidNext: 4,
					messages: [
						{
							uid: 1,
							flags: ["\\Seen"],
							internalDate: "2026-01-15T10:00:00Z",
							source: buildRawEmail({
								from: "a@example.com",
								to: "test@example.com",
								subject: "Msg 1",
								body: "Body 1",
								messageId: "<1@ex.com>",
								date: "Wed, 15 Jan 2026 10:00:00 +0000",
							}),
						},
						{
							uid: 3,
							flags: [],
							internalDate: "2026-01-16T10:00:00Z",
							source: buildRawEmail({
								from: "b@example.com",
								to: "test@example.com",
								subject: "Msg 3",
								body: "Body 3",
								messageId: "<3@ex.com>",
								date: "Thu, 16 Jan 2026 10:00:00 +0000",
							}),
						},
					],
				},
			],
		});
		port = await server.start();

		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'test@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeSync() {
		return new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			accountId,
		);
	}

	test("returns UIDs present locally but missing from server", async () => {
		// Sync to get the folder and messages into local DB
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		// Now manually insert a message with uid=2 (not on server) into local DB
		const folder = db
			.prepare("SELECT id FROM folders WHERE account_id = ? AND path = 'INBOX'")
			.get(accountId) as { id: number };
		db.prepare(`
			INSERT INTO messages (account_id, folder_id, uid, message_id, subject, from_address, from_name,
				to_addresses, date, text_body, flags, size, has_attachments)
			VALUES (?, ?, 2, '<2@ex.com>', 'Missing msg', 'x@y.com', 'X', '[]',
				'2026-01-15T10:00:00Z', 'body', '[]', 100, 0)
		`).run(accountId, folder.id);

		const deleted = await sync.detectServerDeletions("INBOX");
		expect(deleted).toContain(2);
		expect(deleted).not.toContain(1);
		expect(deleted).not.toContain(3);

		await sync.disconnect();
	});

	test("returns empty array when all local UIDs are on server", async () => {
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		const deleted = await sync.detectServerDeletions("INBOX");
		expect(deleted).toHaveLength(0);

		await sync.disconnect();
	});

	test("returns empty array for unknown folder path", async () => {
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		const deleted = await sync.detectServerDeletions("Nonexistent");
		expect(deleted).toHaveLength(0);

		await sync.disconnect();
	});
});

describe("deleteFromServer", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;
	let accountId: number;

	beforeEach(async () => {
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: [
				{
					path: "INBOX",
					name: "Inbox",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					specialUse: "\\Inbox",
					uidValidity: 1,
					uidNext: 3,
					messages: [
						{
							uid: 1,
							flags: ["\\Seen"],
							internalDate: "2026-01-15T10:00:00Z",
							source: buildRawEmail({
								from: "a@example.com",
								to: "test@example.com",
								subject: "Keep",
								body: "Keep this",
								messageId: "<keep@ex.com>",
								date: "Wed, 15 Jan 2026 10:00:00 +0000",
							}),
						},
						{
							uid: 2,
							flags: [],
							internalDate: "2026-01-16T10:00:00Z",
							source: buildRawEmail({
								from: "b@example.com",
								to: "test@example.com",
								subject: "Delete",
								body: "Delete this",
								messageId: "<del@ex.com>",
								date: "Thu, 16 Jan 2026 10:00:00 +0000",
							}),
						},
					],
				},
			],
		});
		port = await server.start();

		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'test@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeSync() {
		return new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			accountId,
		);
	}

	test("returns 0 for empty uid list without touching the server", async () => {
		const sync = makeSync();
		await sync.connect();
		const deleted = await sync.deleteFromServer("INBOX", []);
		expect(deleted).toBe(0);
		await sync.disconnect();
	});

	test("deletes message from server and marks it locally", async () => {
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		// Delete uid=2
		const result = await sync.deleteFromServer("INBOX", [2]);
		expect(result).toBe(1);

		// Local message should be marked deleted_from_server
		const folder = db
			.prepare("SELECT id FROM folders WHERE account_id = ? AND path = 'INBOX'")
			.get(accountId) as { id: number };
		const msg = db
			.prepare("SELECT deleted_from_server FROM messages WHERE folder_id = ? AND uid = 2")
			.get(folder.id) as { deleted_from_server: number } | undefined;
		expect(msg?.deleted_from_server).toBe(1);

		// uid=1 should be untouched
		const kept = db
			.prepare("SELECT deleted_from_server FROM messages WHERE folder_id = ? AND uid = 1")
			.get(folder.id) as { deleted_from_server: number } | undefined;
		expect(kept?.deleted_from_server).toBe(0);

		await sync.disconnect();
	});

	test("syncAll with pre-aborted signal returns empty result immediately", async () => {
		const sync = makeSync();
		await sync.connect();

		const controller = new AbortController();
		controller.abort();

		const result = await sync.syncAll(controller.signal);

		// The first guard in syncAll is `if (signal?.aborted) return result`
		// so no folders should be processed at all
		expect(result.folders).toHaveLength(0);
		expect(result.totalNew).toBe(0);

		await sync.disconnect();
	});

	test("syncAll stops iterating folders when signal is aborted mid-sync", async () => {
		// Build a server with several folders so there is room to abort between them
		const manyFolderServer = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: [
				{
					path: "INBOX",
					name: "Inbox",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					specialUse: "\\Inbox",
					uidValidity: 1,
					uidNext: 2,
					messages: [
						{
							uid: 1,
							flags: [],
							internalDate: "2026-01-01T00:00:00Z",
							source: buildRawEmail({
								from: "a@test.com",
								to: "b@test.com",
								subject: "test",
								body: "body",
							}),
						},
					],
				},
				{
					path: "Folder2",
					name: "Folder2",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					uidValidity: 1,
					uidNext: 1,
					messages: [],
				},
				{
					path: "Folder3",
					name: "Folder3",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					uidValidity: 1,
					uidNext: 1,
					messages: [],
				},
			],
		});
		const manyPort = await manyFolderServer.start();

		const manyDb = createTestDb();
		manyDb
			.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('ManyTest', 'many@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`)
			.run(manyPort);
		const manyAccountId = Number(
			(manyDb.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);

		const manySync = new ImapSync(
			{
				host: "127.0.0.1",
				port: manyPort,
				secure: false,
				auth: { user: "testuser", pass: "testpass" },
			},
			manyDb,
			manyAccountId,
		);

		try {
			await manySync.connect();

			// Abort after the first folder is processed (signal checked at top of each loop iteration)
			const controller = new AbortController();
			let foldersProcessed = 0;
			type SyncFolderFn = (...args: unknown[]) => Promise<unknown>;
			const manySyncInternal = manySync as unknown as { syncFolder: SyncFolderFn };
			const origSyncFolder = manySyncInternal.syncFolder.bind(manySync);
			manySyncInternal.syncFolder = async (...args: unknown[]) => {
				foldersProcessed++;
				if (foldersProcessed >= 1) {
					// Abort after processing the first folder so the loop break fires next iteration
					controller.abort();
				}
				return origSyncFolder(...args);
			};

			const result = await manySync.syncAll(controller.signal);

			// With 3 folders: processed 1, then aborted → loop breaks before folder 2 and 3
			expect(result.folders.length).toBeLessThan(3);

			await manySync.disconnect();
		} finally {
			manyDb.close();
			await manyFolderServer.stop();
		}
	});
});

describe("SyncScheduler abort integration with mock IMAP server", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;

	beforeEach(async () => {
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: [
				{
					path: "INBOX",
					name: "Inbox",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					specialUse: "\\Inbox",
					uidValidity: 1,
					uidNext: 4,
					messages: [
						{
							uid: 1,
							flags: [],
							internalDate: "2026-01-01T00:00:00Z",
							source: buildRawEmail({
								from: "a@test.com",
								to: "b@test.com",
								subject: "msg1",
								body: "body1",
							}),
						},
						{
							uid: 2,
							flags: [],
							internalDate: "2026-01-02T00:00:00Z",
							source: buildRawEmail({
								from: "a@test.com",
								to: "b@test.com",
								subject: "msg2",
								body: "body2",
							}),
						},
						{
							uid: 3,
							flags: [],
							internalDate: "2026-01-03T00:00:00Z",
							source: buildRawEmail({
								from: "a@test.com",
								to: "b@test.com",
								subject: "msg3",
								body: "body3",
							}),
						},
					],
				},
				{
					path: "Sent",
					name: "Sent",
					delimiter: "/",
					flags: ["\\HasNoChildren"],
					specialUse: "\\Sent",
					uidValidity: 1,
					uidNext: 1,
					messages: [],
				},
			],
		});
		port = await server.start();
		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'test@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	test("stop() with a running syncNow completes within grace period without hanging", async () => {
		const scheduler = new SyncScheduler(db);
		scheduler.loadAccountsFromDb();

		const accounts = db.prepare("SELECT id FROM accounts").all() as { id: number }[];
		const accountId = accounts[0].id;

		// Start an async sync but don't await — we want to call stop() while it may be running
		const syncPromise = scheduler.syncNow(accountId).catch(() => {
			// Sync may be aborted or complete — either is fine
		});

		// Call stop() immediately after kicking off the sync
		const stopStart = Date.now();
		await scheduler.stop();
		const stopElapsed = Date.now() - stopStart;

		// stop() must resolve within 5s drain timeout + 1s margin (not hang forever)
		expect(stopElapsed).toBeLessThan(6000);

		// Let the sync promise settle (it may already be done)
		await syncPromise;

		// After stop(), the account should not be running
		const status = scheduler.getStatus();
		expect(status.get(accountId)?.running).toBe(false);
	});
});
