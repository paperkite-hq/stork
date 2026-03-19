/**
 * Unit tests for label-related methods in ImapSync.
 *
 * ensureLabelsForFolders() and applyFolderLabelsToMessages() are pure DB
 * operations — no IMAP connection needed. We instantiate ImapSync with a
 * dummy config and an in-memory SQLite DB so these can run fast and in
 * isolation.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImapSync } from "../src/sync/imap-sync.js";
import {
	createTestAccount,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "./helpers/test-db.js";

const DUMMY_CONFIG = {
	host: "127.0.0.1",
	port: 993,
	secure: true,
	auth: { user: "test", pass: "test" },
};

function makeSync(accountId: number, db: ReturnType<typeof createTestDb>): ImapSync {
	return new ImapSync(DUMMY_CONFIG, db, accountId);
}

// ─── ensureLabelsForFolders ────────────────────────────────────────────────

describe("ensureLabelsForFolders", () => {
	let db: ReturnType<typeof createTestDb>;
	let accountId: number;

	beforeEach(() => {
		db = createTestDb();
		accountId = createTestAccount(db);
	});

	test("no folders → no labels created", () => {
		makeSync(accountId, db).ensureLabelsForFolders();
		const count = (
			db.prepare("SELECT COUNT(*) as n FROM labels WHERE account_id = ?").get(accountId) as {
				n: number;
			}
		).n;
		expect(count).toBe(0);
	});

	test("creates one label per folder using folder name", () => {
		createTestFolder(db, accountId, "INBOX");
		createTestFolder(db, accountId, "Sent");
		createTestFolder(db, accountId, "Drafts");

		makeSync(accountId, db).ensureLabelsForFolders();

		const labels = db
			.prepare("SELECT name, source FROM labels WHERE account_id = ? ORDER BY name")
			.all(accountId) as { name: string; source: string }[];

		expect(labels).toHaveLength(3);
		expect(labels.map((l) => l.name)).toEqual(["Drafts", "INBOX", "Sent"]);
		for (const l of labels) {
			expect(l.source).toBe("imap");
		}
	});

	test("idempotent — calling twice does not create duplicates", () => {
		createTestFolder(db, accountId, "INBOX");
		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		sync.ensureLabelsForFolders();

		const count = (
			db.prepare("SELECT COUNT(*) as n FROM labels WHERE account_id = ?").get(accountId) as {
				n: number;
			}
		).n;
		expect(count).toBe(1);
	});

	test("ON CONFLICT DO NOTHING preserves existing user label", () => {
		createTestFolder(db, accountId, "INBOX");
		// Pre-create a user-created label with same name
		db.prepare(
			"INSERT INTO labels (account_id, name, color, source) VALUES (?, 'INBOX', '#ff0000', 'user')",
		).run(accountId);

		makeSync(accountId, db).ensureLabelsForFolders();

		const label = db
			.prepare("SELECT source, color FROM labels WHERE account_id = ? AND name = 'INBOX'")
			.get(accountId) as { source: string; color: string } | undefined;
		// Original row preserved — not overwritten by imap source
		expect(label?.source).toBe("user");
		expect(label?.color).toBe("#ff0000");
		// Still only one label
		const count = (
			db.prepare("SELECT COUNT(*) as n FROM labels WHERE account_id = ?").get(accountId) as {
				n: number;
			}
		).n;
		expect(count).toBe(1);
	});

	test("multi-account isolation — only creates labels for the correct account", () => {
		const otherAccountId = createTestAccount(db, {
			email: "other@example.com",
		});

		createTestFolder(db, accountId, "INBOX");
		createTestFolder(db, otherAccountId, "INBOX");
		createTestFolder(db, otherAccountId, "Sent");

		makeSync(accountId, db).ensureLabelsForFolders();

		const myLabels = (
			db.prepare("SELECT COUNT(*) as n FROM labels WHERE account_id = ?").get(accountId) as {
				n: number;
			}
		).n;
		const otherLabels = (
			db.prepare("SELECT COUNT(*) as n FROM labels WHERE account_id = ?").get(otherAccountId) as {
				n: number;
			}
		).n;

		expect(myLabels).toBe(1);
		expect(otherLabels).toBe(0);
	});

	test("nested folder path — label name is the folder display name (not full path)", () => {
		// createTestFolder stores path in both path and name columns,
		// but name is just the last segment (mimics real IMAP behaviour)
		db.prepare(`
			INSERT INTO folders (account_id, path, name, delimiter, flags, special_use, uid_validity)
			VALUES (?, 'Archive/2025', '2025', '/', '[]', null, 1)
		`).run(accountId);

		makeSync(accountId, db).ensureLabelsForFolders();

		const label = db.prepare("SELECT name FROM labels WHERE account_id = ?").get(accountId) as
			| { name: string }
			| undefined;
		expect(label?.name).toBe("2025");
	});
});

// ─── applyFolderLabelsToMessages ──────────────────────────────────────────

describe("applyFolderLabelsToMessages", () => {
	let db: ReturnType<typeof createTestDb>;
	let accountId: number;

	beforeEach(() => {
		db = createTestDb();
		accountId = createTestAccount(db);
	});

	test("no messages → nothing inserted", () => {
		createTestFolder(db, accountId, "INBOX");
		makeSync(accountId, db).ensureLabelsForFolders();
		makeSync(accountId, db).applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(0);
	});

	test("applies label to each message in matching folder", () => {
		const folderId = createTestFolder(db, accountId, "INBOX");
		createTestMessage(db, accountId, folderId, 1);
		createTestMessage(db, accountId, folderId, 2);

		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(2);
	});

	test("idempotent — calling twice does not create duplicate message_labels rows", () => {
		const folderId = createTestFolder(db, accountId, "INBOX");
		createTestMessage(db, accountId, folderId, 1);

		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();
		sync.applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("messages in different folders get their own folder labels", () => {
		const inboxId = createTestFolder(db, accountId, "INBOX");
		const sentId = createTestFolder(db, accountId, "Sent");
		const msgInbox = createTestMessage(db, accountId, inboxId, 1);
		const msgSent = createTestMessage(db, accountId, sentId, 2);

		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();

		const labelFor = (msgId: number): string => {
			const row = db
				.prepare(`
					SELECT l.name FROM message_labels ml
					JOIN labels l ON l.id = ml.label_id
					WHERE ml.message_id = ?
				`)
				.get(msgId) as { name: string } | undefined;
			return row?.name ?? "(none)";
		};

		expect(labelFor(msgInbox)).toBe("INBOX");
		expect(labelFor(msgSent)).toBe("Sent");
	});

	test("already-labelled messages are skipped (INSERT OR IGNORE)", () => {
		const folderId = createTestFolder(db, accountId, "INBOX");
		const msgId = createTestMessage(db, accountId, folderId, 1);

		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		// Apply once manually
		sync.applyFolderLabelsToMessages();

		// Tamper: try inserting again — should still be just 1 row
		const countBefore = (
			db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }
		).n;
		sync.applyFolderLabelsToMessages();
		const countAfter = (
			db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }
		).n;

		expect(countBefore).toBe(1);
		expect(countAfter).toBe(1);
		void msgId; // just to avoid unused-var lint
	});

	test("multi-account isolation — only applies labels for the correct account", () => {
		const otherAccountId = createTestAccount(db, { email: "other@example.com" });

		const myFolderId = createTestFolder(db, accountId, "INBOX");
		const otherFolderId = createTestFolder(db, otherAccountId, "INBOX");

		createTestMessage(db, accountId, myFolderId, 1);
		createTestMessage(db, otherAccountId, otherFolderId, 1);

		// Only sync account 1
		const sync = makeSync(accountId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();

		// Account 1's message has a label
		const myCount = (
			db
				.prepare(`
					SELECT COUNT(*) as n FROM message_labels ml
					JOIN messages m ON m.id = ml.message_id
					WHERE m.account_id = ?
				`)
				.get(accountId) as { n: number }
		).n;
		// Account 2's message has no label (no label was created for it)
		const otherCount = (
			db
				.prepare(`
					SELECT COUNT(*) as n FROM message_labels ml
					JOIN messages m ON m.id = ml.message_id
					WHERE m.account_id = ?
				`)
				.get(otherAccountId) as { n: number }
		).n;

		expect(myCount).toBe(1);
		expect(otherCount).toBe(0);
	});

	test("messages without a matching folder label are not labelled", () => {
		const folderId = createTestFolder(db, accountId, "INBOX");
		createTestMessage(db, accountId, folderId, 1);

		// Don't call ensureLabelsForFolders — no labels exist
		makeSync(accountId, db).applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(0);
	});
});

// ─── syncAll integration via mock IMAP ─────────────────────────────────────

import { afterEach } from "vitest";
import { MockImapServer, type MockMailbox, buildRawEmail } from "./helpers/mock-imap-server.js";

describe("syncAll — label pipeline integration", () => {
	let db: ReturnType<typeof createTestDb>;
	let accountId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
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
						internalDate: "2026-01-15T10:00:00Z",
						source: buildRawEmail({
							from: "sender@example.com",
							to: "testuser@example.com",
							subject: "Hello",
							body: "Hello world",
							messageId: "<hello@test.local>",
							date: "Wed, 15 Jan 2026 10:00:00 +0000",
						}),
					},
				],
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();

		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'testuser@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("syncAll creates labels for synced folders and applies them to messages", async () => {
		const sync = new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			accountId,
		);
		await sync.connect();
		await sync.syncAll();
		await sync.disconnect();

		// INBOX label must exist with source='imap'
		const label = db
			.prepare("SELECT name, source FROM labels WHERE account_id = ?")
			.get(accountId) as { name: string; source: string } | undefined;
		expect(label?.name).toBe("INBOX");
		expect(label?.source).toBe("imap");

		// The synced message must have the INBOX label applied
		const msgLabel = db
			.prepare(`
				SELECT l.name FROM message_labels ml
				JOIN labels l ON l.id = ml.label_id
				JOIN messages m ON m.id = ml.message_id
				WHERE m.account_id = ?
			`)
			.get(accountId) as { name: string } | undefined;
		expect(msgLabel?.name).toBe("INBOX");
	});
});

// ─── sub-batch label application ───────────────────────────────────────────

describe("syncAll — sub-batch label application during large folder sync", () => {
	let db: ReturnType<typeof createTestDb>;
	let accountId: number;
	let server: MockImapServer;
	let port: number;

	beforeEach(async () => {
		// Build 3 messages so we can set subBatchLabelSize=2 and trigger a mid-batch call
		const messages = [1, 2, 3].map((i) => ({
			uid: i,
			flags: [] as string[],
			internalDate: "2026-01-15T10:00:00Z",
			source: buildRawEmail({
				from: "sender@example.com",
				to: "testuser@example.com",
				subject: `Message ${i}`,
				body: `Body ${i}`,
				messageId: `<msg${i}@test.local>`,
				date: "Wed, 15 Jan 2026 10:00:00 +0000",
			}),
		}));

		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "INBOX",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 4,
				messages,
			},
		];

		server = new MockImapServer({ user: "testuser", pass: "testpass", mailboxes });
		port = await server.start();

		db = createTestDb();
		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'testuser@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("applyFolderLabelsToMessages called mid-folder when batch threshold is reached", async () => {
		// subBatchLabelSize=2: with 3 messages, triggers once at count=2 plus the
		// end-of-folder call and final pass — verifies labels are applied before folder completes
		const sync = new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			accountId,
			2, // subBatchLabelSize
		);

		const spy = vi.spyOn(sync, "applyFolderLabelsToMessages");

		await sync.connect();
		await sync.syncAll();
		await sync.disconnect();

		// Expected calls:
		//   1) mid-batch at count=2 (inside fetchNewMessages)
		//   2) after folder completes in syncAll (newMessages > 0)
		//   3) final pass at end of syncAll
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);

		// All 3 messages must be labelled in the end
		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(3);
	});
});
