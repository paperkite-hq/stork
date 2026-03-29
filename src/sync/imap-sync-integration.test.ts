import type Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	MockImapServer,
	type MockMailbox,
	buildRawEmail,
} from "../test-helpers/mock-imap-server.js";
import { createTestDb } from "../test-helpers/test-db.js";
import { ImapSync } from "./imap-sync.js";
import { SyncScheduler } from "./sync-scheduler.js";

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
	let identityId: number;

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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		identityId = inboundId;
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
			identityId,
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
			.prepare("SELECT path, special_use FROM folders WHERE inbound_connector_id = ? ORDER BY path")
			.all(identityId) as { path: string; special_use: string | null }[];

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
			.prepare(
				"SELECT subject, from_address FROM messages WHERE inbound_connector_id = ? ORDER BY uid",
			)
			.all(identityId) as { subject: string; from_address: string }[];

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
			.prepare(
				"SELECT flags FROM messages WHERE inbound_connector_id = ? AND subject = 'Important document'",
			)
			.get(identityId) as { flags: string } | undefined;

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
			INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags)
			VALUES (?, 'OldFolder', 'OldFolder', '/', '[]')
		`).run(identityId);

		const beforeCount = (
			db
				.prepare("SELECT count(*) as c FROM folders WHERE inbound_connector_id = ?")
				.get(identityId) as {
				c: number;
			}
		).c;

		// Re-sync folders — should prune the old one
		await sync.syncFolders();

		const afterCount = (
			db
				.prepare("SELECT count(*) as c FROM folders WHERE inbound_connector_id = ?")
				.get(identityId) as {
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

		// Total message_labels: 4 messages × (folder label + identity label) = 8
		const totalLabels = (
			db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }
		).n;
		expect(totalLabels).toBe(8);
	});
});

describe("detectServerDeletions", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;
	let identityId: number;

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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		identityId = inboundId;
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeSync() {
		return new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			identityId,
		);
	}

	test("returns UIDs present locally but missing from server", async () => {
		// Sync to get the folder and messages into local DB
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		// Now manually insert a message with uid=2 (not on server) into local DB
		const folder = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };
		db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, message_id, subject, from_address, from_name,
				to_addresses, date, text_body, flags, size, has_attachments)
			VALUES (?, ?, 2, '<2@ex.com>', 'Missing msg', 'x@y.com', 'X', '[]',
				'2026-01-15T10:00:00Z', 'body', '[]', 100, 0)
		`).run(identityId, folder.id);

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
	let identityId: number;

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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		identityId = inboundId;
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeSync() {
		return new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			identityId,
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
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };
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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Many Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`)
			.run(manyPort);
		const manyInboundId = Number(
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
			manyInboundId,
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
		// Create inbound connector and identity so loadIdentitiesFromDb finds it via JOIN
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test (Inbound)', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	test("stop() with a running syncNow completes within grace period without hanging", async () => {
		const scheduler = new SyncScheduler(db);
		scheduler.loadIdentitiesFromDb();

		const connectors = db.prepare("SELECT id FROM inbound_connectors").all() as { id: number }[];
		const connectorId = connectors[0].id;

		// Start an async sync but don't await — we want to call stop() while it may be running
		const syncPromise = scheduler.syncNow(connectorId).catch(() => {
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

		// After stop(), the connector should not be running
		const status = scheduler.getStatus();
		expect(status.get(connectorId)?.running).toBe(false);
	});
});

describe("archive mode (auto-delete from server after sync)", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database.Database;
	let identityId: number;

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
							internalDate: "2026-01-15T10:00:00Z",
							source: buildRawEmail({
								from: "a@example.com",
								to: "test@example.com",
								subject: "First",
								body: "First message",
								messageId: "<first@ex.com>",
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
								subject: "Second",
								body: "Second message",
								messageId: "<second@ex.com>",
								date: "Thu, 16 Jan 2026 10:00:00 +0000",
							}),
						},
						{
							uid: 3,
							flags: [],
							internalDate: "2026-01-17T10:00:00Z",
							source: buildRawEmail({
								from: "c@example.com",
								to: "test@example.com",
								subject: "Third",
								body: "Third message",
								messageId: "<third@ex.com>",
								date: "Fri, 17 Jan 2026 10:00:00 +0000",
							}),
						},
					],
				},
			],
		});
		port = await server.start();
		db = createTestDb();
	});

	afterEach(async () => {
		db.close();
		await server.stop();
	});

	function makeAccount(syncDeleteFromServer: 0 | 1): number {
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass, sync_delete_from_server)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass', ?)
		`).run(port, syncDeleteFromServer);
		return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	}

	function makeSync(accId: number): ImapSync {
		return new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			accId,
		);
	}

	test("syncAll with archive mode off leaves messages on server", async () => {
		identityId = makeAccount(0);
		const sync = makeSync(identityId);
		await sync.connect();
		const result = await sync.syncAll();
		await sync.disconnect();

		// All 3 messages stored locally
		const folder = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };
		const msgs = db
			.prepare("SELECT uid, deleted_from_server FROM messages WHERE folder_id = ?")
			.all(folder.id) as { uid: number; deleted_from_server: number }[];

		expect(msgs).toHaveLength(3);
		expect(msgs.every((m) => m.deleted_from_server === 0)).toBe(true);

		// Server still has all 3 messages
		let serverMsgCount = 0;
		server.updateMailbox("INBOX", (mb) => {
			serverMsgCount = mb.messages.length;
		});
		expect(serverMsgCount).toBe(3);

		// Result counts
		const inboxResult = result.folders.find((f) => f.folder === "INBOX");
		expect(inboxResult?.deletedFromServer).toBe(0);
	});

	test("syncAll with archive mode on deletes synced messages from server", async () => {
		identityId = makeAccount(1);
		const sync = makeSync(identityId);
		await sync.connect();
		const result = await sync.syncAll();
		await sync.disconnect();

		// All 3 messages stored locally
		const folder = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };
		const msgs = db
			.prepare("SELECT uid, deleted_from_server FROM messages WHERE folder_id = ?")
			.all(folder.id) as { uid: number; deleted_from_server: number }[];

		expect(msgs).toHaveLength(3);
		expect(msgs.every((m) => m.deleted_from_server === 1)).toBe(true);

		// Server should have no messages left
		let remainingOnServer = -1;
		server.updateMailbox("INBOX", (mb) => {
			remainingOnServer = mb.messages.length;
		});
		expect(remainingOnServer).toBe(0);

		// Result counts
		const inboxResult = result.folders.find((f) => f.folder === "INBOX");
		expect(inboxResult?.deletedFromServer).toBe(3);
		expect(inboxResult?.newMessages).toBe(3);
	});

	test("archive mode only deletes newly synced messages, not messages already in stork", async () => {
		identityId = makeAccount(1);

		// First sync: gets uid=1 and uid=2 (simulate server having only 2 messages initially)
		// We'll do this by syncing, then adding uid=3 to the server and syncing again.
		// The key is: on the second sync, uid=3 is new — only uid=3 should be deleted.
		// uid=1 and uid=2 were already deleted in the first sync.

		const sync = makeSync(identityId);
		await sync.connect();
		await sync.syncAll();
		await sync.disconnect();

		// Server should have 0 messages after first sync
		let afterFirstSync = -1;
		server.updateMailbox("INBOX", (mb) => {
			afterFirstSync = mb.messages.length;
		});
		expect(afterFirstSync).toBe(0);

		// Add a new message to the server (simulating a new incoming email)
		server.updateMailbox("INBOX", (mb) => {
			mb.messages.push({
				uid: 10,
				flags: [],
				internalDate: "2026-01-20T10:00:00Z",
				source: buildRawEmail({
					from: "new@example.com",
					to: "test@example.com",
					subject: "New arrival",
					body: "New email after first sync",
					messageId: "<new@ex.com>",
					date: "Mon, 20 Jan 2026 10:00:00 +0000",
				}),
			});
			mb.uidNext = 11;
		});
		let afterAdd = -1;
		server.updateMailbox("INBOX", (mb) => {
			afterAdd = mb.messages.length;
		});
		expect(afterAdd).toBe(1);

		// Verify DB state before second sync
		const folder1 = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number } | undefined;
		const syncState = db
			.prepare("SELECT last_uid FROM sync_state WHERE inbound_connector_id = ? AND folder_id = ?")
			.get(identityId, folder1?.id) as { last_uid: number } | undefined;
		// After first sync, last_uid should be 3 (max uid seen: 1,2,3)
		expect(syncState?.last_uid).toBe(3);

		// Second sync: should pick up uid=10 and delete it
		const sync2 = makeSync(identityId);
		await sync2.connect();
		const result2 = await sync2.syncAll();
		await sync2.disconnect();

		// Diagnostics first: check for errors and whether delete was attempted
		// (Uncomment if debugging: console.error("result2", JSON.stringify(result2, null, 2)));
		expect(result2.totalErrors).toBe(0);
		const inboxResult2 = result2.folders.find((f) => f.folder === "INBOX");
		if (inboxResult2?.newMessages !== 1) {
			console.error("DEBUG result2.folders:", JSON.stringify(result2.folders));
		}
		expect(inboxResult2?.newMessages).toBe(1);
		expect(inboxResult2?.deletedFromServer).toBe(1);

		// Server should be empty again
		let afterSecondSync = -1;
		server.updateMailbox("INBOX", (mb) => {
			afterSecondSync = mb.messages.length;
		});
		expect(afterSecondSync).toBe(0);

		const inboxResult = result2.folders.find((f) => f.folder === "INBOX");
		expect(inboxResult?.newMessages).toBe(1);
		expect(inboxResult?.deletedFromServer).toBe(1);

		// All 4 messages (3 original + 1 new) are in local storage
		const folder = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };
		const total = db
			.prepare("SELECT COUNT(*) as n FROM messages WHERE folder_id = ?")
			.get(folder.id) as { n: number };
		expect(total.n).toBe(4);
	});

	test("crash recovery: pending_archive messages from a previous interrupted sync are deleted on the next run", async () => {
		identityId = makeAccount(1);

		// Run syncFolders first to create the folder record, then manually insert
		// messages with pending_archive=1 (simulating Phase 1 completing before a crash).
		const syncInit = makeSync(identityId);
		await syncInit.connect();
		await syncInit.syncFolders();
		await syncInit.disconnect();

		const folderRow = db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = 'INBOX'")
			.get(identityId) as { id: number };

		// Insert messages with pending_archive=1 (simulating interrupted Phase 1)
		for (const uid of [1, 2, 3]) {
			db.prepare(`
				INSERT OR IGNORE INTO messages (inbound_connector_id, folder_id, uid, subject, flags, pending_archive)
				VALUES (?, ?, ?, ?, \'\', 1)
			`).run(identityId, folderRow.id, uid, `Message ${uid}`);
		}

		// Set last_uid so next sync thinks these were already fetched
		db.prepare(`
			INSERT INTO sync_state (inbound_connector_id, folder_id, last_uid, last_synced_at)
			VALUES (?, ?, 3, datetime(\'now\'))
			ON CONFLICT(inbound_connector_id, folder_id) DO UPDATE SET last_uid = 3
		`).run(identityId, folderRow.id);

		// Verify messages are pending archive but not yet deleted from server
		const pending = db
			.prepare("SELECT uid FROM messages WHERE folder_id = ? AND pending_archive = 1")
			.all(folderRow.id) as { uid: number }[];
		expect(pending).toHaveLength(3);

		// Server still has all 3 messages
		let beforeCount = -1;
		server.updateMailbox("INBOX", (mb) => {
			beforeCount = mb.messages.length;
		});
		expect(beforeCount).toBe(3);

		// Now run a fresh sync — Phase 3 should pick up the pending messages and delete them
		const sync2 = makeSync(identityId);
		await sync2.connect();
		await sync2.syncAll();
		await sync2.disconnect();

		// Server should have 0 messages (pending ones got deleted)
		let afterCount = -1;
		server.updateMailbox("INBOX", (mb) => {
			afterCount = mb.messages.length;
		});
		expect(afterCount).toBe(0);

		// Pending archive flag should be cleared
		const stillPending = db
			.prepare("SELECT uid FROM messages WHERE folder_id = ? AND pending_archive = 1")
			.all(folderRow.id) as { uid: number }[];
		expect(stillPending).toHaveLength(0);

		// deleted_from_server should be set
		const deletedRows = db
			.prepare("SELECT uid FROM messages WHERE folder_id = ? AND deleted_from_server = 1")
			.all(folderRow.id) as { uid: number }[];
		expect(deletedRows).toHaveLength(3);
	});
});
