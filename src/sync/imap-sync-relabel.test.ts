/**
 * Tests for ImapSync.relabelFromServer().
 *
 * relabelFromServer() reconciles locally-stored folder labels against the
 * current IMAP server state. It detects cross-folder moves via RFC 5322
 * Message-ID and updates labels accordingly.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	buildRawEmail,
	MockImapServer,
	type MockMailbox,
} from "../test-helpers/mock-imap-server.js";
import {
	addMessageLabel,
	createTestDb,
	createTestFolder,
	createTestInboundConnector,
	createTestLabel,
	createTestMessage,
} from "../test-helpers/test-db.js";
import { ImapSync } from "./imap-sync.js";

const MSG_SOURCE = buildRawEmail({
	from: "sender@example.com",
	to: "user@example.com",
	subject: "Test",
	body: "Hello",
	messageId: "<move-test@example.com>",
	date: "Mon, 01 Jan 2024 12:00:00 +0000",
});

function makeSync(
	db: ReturnType<typeof createTestDb>,
	connectorId: number,
	port: number,
): ImapSync {
	return new ImapSync(
		{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
		db,
		connectorId,
	);
}

// ─── cross-folder move detection ─────────────────────────────────────────────

describe("relabelFromServer — cross-folder move detection", () => {
	let db: ReturnType<typeof createTestDb>;
	let connectorId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		db = createTestDb();
		connectorId = createTestInboundConnector(db);

		// Server state: INBOX is empty (message was moved away), Archive has it
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "INBOX",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 2,
				messages: [], // UID 1 is gone — moved to Archive
			},
			{
				path: "Archive",
				name: "Archive",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Archive",
				uidValidity: 1,
				uidNext: 2,
				messages: [
					{
						uid: 1,
						flags: [],
						internalDate: "2024-01-01T12:00:00Z",
						source: MSG_SOURCE,
					},
				],
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();

		// Local DB: reflects state before the move was discovered
		const inboxFolderId = createTestFolder(db, connectorId, "INBOX");
		const archiveFolderId = createTestFolder(db, connectorId, "Archive");

		// Labels
		const inboxLabelId = createTestLabel(db, "INBOX", { source: "imap" });
		const archiveLabelId = createTestLabel(db, "Archive", { source: "imap" });

		// Original INBOX message (stale — UID 1 no longer on server in INBOX)
		const inboxMsgId = createTestMessage(db, connectorId, inboxFolderId, 1, {
			messageId: "<move-test@example.com>",
		});
		addMessageLabel(db, inboxMsgId, inboxLabelId);

		// Destination Archive message (already synced by incremental sync)
		const archiveMsgId = createTestMessage(db, connectorId, archiveFolderId, 1, {
			messageId: "<move-test@example.com>",
		});
		addMessageLabel(db, archiveMsgId, archiveLabelId);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("removes stale INBOX label from original row after cross-folder move", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const _result = await sync.relabelFromServer();
		await sync.disconnect();

		// INBOX label must be removed from the original message row
		const inboxMsg = db
			.prepare(
				`SELECT m.id FROM messages m JOIN folders f ON m.folder_id = f.id WHERE f.name = 'INBOX'`,
			)
			.get() as { id: number } | undefined;
		expect(inboxMsg).toBeDefined();

		const inboxLabel = db.prepare("SELECT id FROM labels WHERE name = 'INBOX'").get() as
			| { id: number }
			| undefined;
		expect(inboxLabel).toBeDefined();

		const staleLink = db
			.prepare("SELECT 1 FROM message_labels WHERE message_id = ? AND label_id = ?")
			.get(inboxMsg?.id, inboxLabel?.id);
		expect(staleLink).toBeUndefined();
	});

	test("ensures Archive label is present on destination row", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		await sync.relabelFromServer();
		await sync.disconnect();

		const archiveMsg = db
			.prepare(
				`SELECT m.id FROM messages m JOIN folders f ON m.folder_id = f.id WHERE f.name = 'Archive'`,
			)
			.get() as { id: number } | undefined;
		expect(archiveMsg).toBeDefined();

		const archiveLabel = db.prepare("SELECT id FROM labels WHERE name = 'Archive'").get() as
			| { id: number }
			| undefined;
		expect(archiveLabel).toBeDefined();

		const link = db
			.prepare("SELECT 1 FROM message_labels WHERE message_id = ? AND label_id = ?")
			.get(archiveMsg?.id, archiveLabel?.id);
		expect(link).toBeDefined();
	});

	test("returns correct result counts", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const result = await sync.relabelFromServer();
		await sync.disconnect();

		expect(result.foldersScanned).toBe(2);
		expect(result.crossFolderMovesDetected).toBe(1);
		expect(result.labelsUpdated).toBe(1);
	});
});

// ─── no cross-folder match (message deleted) ─────────────────────────────────

describe("relabelFromServer — UID missing with no local counterpart", () => {
	let db: ReturnType<typeof createTestDb>;
	let connectorId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		db = createTestDb();
		connectorId = createTestInboundConnector(db);

		// Server has INBOX with a different UID (UID 1 is gone, UID 2 is new)
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "INBOX",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 3,
				messages: [
					{
						uid: 2,
						flags: [],
						internalDate: "2024-01-02T12:00:00Z",
						source: buildRawEmail({
							from: "sender@example.com",
							to: "user@example.com",
							subject: "New message",
							body: "Different message",
							messageId: "<new@example.com>",
							date: "Tue, 02 Jan 2024 12:00:00 +0000",
						}),
					},
				],
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();

		const inboxFolderId = createTestFolder(db, connectorId, "INBOX");
		const inboxLabelId = createTestLabel(db, "INBOX", { source: "imap" });

		// Local message with UID 1 — not in server INBOX, not in any other folder
		const msgId = createTestMessage(db, connectorId, inboxFolderId, 1, {
			messageId: "<deleted@example.com>",
		});
		addMessageLabel(db, msgId, inboxLabelId);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("leaves label unchanged when no cross-folder match found", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const result = await sync.relabelFromServer();
		await sync.disconnect();

		// Label should still be intact (no cross-folder counterpart)
		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(1);
		expect(result.crossFolderMovesDetected).toBe(0);
		expect(result.labelsUpdated).toBe(0);
	});
});

// ─── message still on server (no change needed) ──────────────────────────────

describe("relabelFromServer — message still present on server", () => {
	let db: ReturnType<typeof createTestDb>;
	let connectorId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		db = createTestDb();
		connectorId = createTestInboundConnector(db);

		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "INBOX",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 2,
				messages: [
					{
						uid: 1,
						flags: [],
						internalDate: "2024-01-01T12:00:00Z",
						source: MSG_SOURCE,
					},
				],
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();

		const inboxFolderId = createTestFolder(db, connectorId, "INBOX");
		const inboxLabelId = createTestLabel(db, "INBOX", { source: "imap" });
		const msgId = createTestMessage(db, connectorId, inboxFolderId, 1, {
			messageId: "<move-test@example.com>",
		});
		addMessageLabel(db, msgId, inboxLabelId);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("does not modify labels for messages still on server", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const result = await sync.relabelFromServer();
		await sync.disconnect();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(1);
		expect(result.labelsUpdated).toBe(0);
		expect(result.crossFolderMovesDetected).toBe(0);
	});
});

// ─── empty local DB ───────────────────────────────────────────────────────────

describe("relabelFromServer — no local folders", () => {
	let db: ReturnType<typeof createTestDb>;
	let connectorId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		db = createTestDb();
		connectorId = createTestInboundConnector(db);

		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: [],
		});
		port = await server.start();
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("returns zero counts with no folders", async () => {
		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const result = await sync.relabelFromServer();
		await sync.disconnect();

		expect(result.foldersScanned).toBe(0);
		expect(result.labelsUpdated).toBe(0);
		expect(result.crossFolderMovesDetected).toBe(0);
	});
});

// ─── abort signal ────────────────────────────────────────────────────────────

describe("relabelFromServer — abort signal", () => {
	let db: ReturnType<typeof createTestDb>;
	let connectorId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		db = createTestDb();
		connectorId = createTestInboundConnector(db);

		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "INBOX",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 2,
				messages: [{ uid: 1, flags: [], internalDate: "2024-01-01T12:00:00Z", source: MSG_SOURCE }],
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();
		createTestFolder(db, connectorId, "INBOX");
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("returns early with zero foldersScanned when aborted before start", async () => {
		const ac = new AbortController();
		ac.abort();

		const sync = makeSync(db, connectorId, port);
		await sync.connect();
		const result = await sync.relabelFromServer(ac.signal);
		await sync.disconnect();

		expect(result.foldersScanned).toBe(0);
	});
});
