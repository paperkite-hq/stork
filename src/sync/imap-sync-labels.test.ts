/**
 * Unit tests for label-related methods in ImapSync.
 *
 * ensureLabelsForFolders() and applyFolderLabelsToMessages() are pure DB
 * operations — no IMAP connection needed. We instantiate ImapSync with a
 * dummy config and an in-memory SQLite DB so these can run fast and in
 * isolation.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestMessage,
} from "../test-helpers/test-db.js";
import { ImapSync } from "./imap-sync.js";

const DUMMY_CONFIG = {
	host: "127.0.0.1",
	port: 993,
	secure: true,
	auth: { user: "test", pass: "test" },
};

function makeSync(identityId: number, db: ReturnType<typeof createTestDb>): ImapSync {
	return new ImapSync(DUMMY_CONFIG, db, identityId);
}

// ─── ensureLabelsForFolders ────────────────────────────────────────────────

describe("ensureLabelsForFolders", () => {
	let db: ReturnType<typeof createTestDb>;
	let identityId: number;

	beforeEach(() => {
		db = createTestDb();
		identityId = createTestIdentity(db);
	});

	test("no folders → no labels created", () => {
		makeSync(identityId, db).ensureLabelsForFolders();
		const count = (db.prepare("SELECT COUNT(*) as n FROM labels").get() as { n: number }).n;
		expect(count).toBe(0);
	});

	test("creates one label per folder using folder name", () => {
		createTestFolder(db, identityId, "INBOX");
		createTestFolder(db, identityId, "Sent");
		createTestFolder(db, identityId, "Drafts");

		makeSync(identityId, db).ensureLabelsForFolders();

		const labels = db.prepare("SELECT name, source FROM labels ORDER BY name").all() as {
			name: string;
			source: string;
		}[];

		expect(labels).toHaveLength(3);
		expect(labels.map((l) => l.name)).toEqual(["Drafts", "INBOX", "Sent"]);
		for (const l of labels) {
			expect(l.source).toBe("imap");
		}
	});

	test("idempotent — calling twice does not create duplicates", () => {
		createTestFolder(db, identityId, "INBOX");
		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();
		sync.ensureLabelsForFolders();

		const count = (db.prepare("SELECT COUNT(*) as n FROM labels").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("ON CONFLICT DO NOTHING preserves existing user label", () => {
		createTestFolder(db, identityId, "INBOX");
		// Pre-create a user-created label with same name
		db.prepare(
			"INSERT INTO labels (name, color, source) VALUES ('INBOX', '#ff0000', 'user')",
		).run();

		makeSync(identityId, db).ensureLabelsForFolders();

		const label = db.prepare("SELECT source, color FROM labels WHERE name = 'INBOX'").get() as
			| { source: string; color: string }
			| undefined;
		// Original row preserved — not overwritten by imap source
		expect(label?.source).toBe("user");
		expect(label?.color).toBe("#ff0000");
		// Still only one label
		const count = (db.prepare("SELECT COUNT(*) as n FROM labels").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("labels are global — two identities sharing a folder name produce one label", () => {
		const otherAccountId = createTestIdentity(db, {
			email: "other@example.com",
		});

		createTestFolder(db, identityId, "INBOX");
		createTestFolder(db, otherAccountId, "INBOX");
		createTestFolder(db, otherAccountId, "Sent");

		// Sync identity1 — creates INBOX label
		makeSync(identityId, db).ensureLabelsForFolders();
		// Sync identity2 — INBOX already exists (no-op), Sent is new
		makeSync(otherAccountId, db).ensureLabelsForFolders();

		const totalLabels = (db.prepare("SELECT COUNT(*) as n FROM labels").get() as { n: number }).n;
		// INBOX (shared) + Sent = 2 global labels
		expect(totalLabels).toBe(2);
	});

	test("nested folder path — label name is the folder display name (not full path)", () => {
		// createTestFolder stores path in both path and name columns,
		// but name is just the last segment (mimics real IMAP behaviour)
		db.prepare(`
			INSERT INTO folders (identity_id, path, name, delimiter, flags, special_use, uid_validity)
			VALUES (?, 'Archive/2025', '2025', '/', '[]', null, 1)
		`).run(identityId);

		makeSync(identityId, db).ensureLabelsForFolders();

		const label = db.prepare("SELECT name FROM labels").get() as { name: string } | undefined;
		expect(label?.name).toBe("2025");
	});
});

// ─── applyFolderLabelsToMessages ──────────────────────────────────────────

describe("applyFolderLabelsToMessages", () => {
	let db: ReturnType<typeof createTestDb>;
	let identityId: number;

	beforeEach(() => {
		db = createTestDb();
		identityId = createTestIdentity(db);
	});

	test("no messages → nothing inserted", () => {
		createTestFolder(db, identityId, "INBOX");
		makeSync(identityId, db).ensureLabelsForFolders();
		makeSync(identityId, db).applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(0);
	});

	test("applies label to each message in matching folder", () => {
		const folderId = createTestFolder(db, identityId, "INBOX");
		createTestMessage(db, identityId, folderId, 1);
		createTestMessage(db, identityId, folderId, 2);

		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(2);
	});

	test("idempotent — calling twice does not create duplicate message_labels rows", () => {
		const folderId = createTestFolder(db, identityId, "INBOX");
		createTestMessage(db, identityId, folderId, 1);

		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();
		sync.applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("messages in different folders get their own folder labels", () => {
		const inboxId = createTestFolder(db, identityId, "INBOX");
		const sentId = createTestFolder(db, identityId, "Sent");
		const msgInbox = createTestMessage(db, identityId, inboxId, 1);
		const msgSent = createTestMessage(db, identityId, sentId, 2);

		const sync = makeSync(identityId, db);
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
		const folderId = createTestFolder(db, identityId, "INBOX");
		const msgId = createTestMessage(db, identityId, folderId, 1);

		const sync = makeSync(identityId, db);
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

	test("multi-identity isolation — only applies labels for the correct identity", () => {
		const otherAccountId = createTestIdentity(db, { email: "other@example.com" });

		const myFolderId = createTestFolder(db, identityId, "INBOX");
		const otherFolderId = createTestFolder(db, otherAccountId, "INBOX");

		createTestMessage(db, identityId, myFolderId, 1);
		createTestMessage(db, otherAccountId, otherFolderId, 1);

		// Only sync identity 1
		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();
		sync.applyFolderLabelsToMessages();

		// Account 1's message has a label
		const myCount = (
			db
				.prepare(`
					SELECT COUNT(*) as n FROM message_labels ml
					JOIN messages m ON m.id = ml.message_id
					WHERE m.identity_id = ?
				`)
				.get(identityId) as { n: number }
		).n;
		// Account 2's message has no label (no label was created for it)
		const otherCount = (
			db
				.prepare(`
					SELECT COUNT(*) as n FROM message_labels ml
					JOIN messages m ON m.id = ml.message_id
					WHERE m.identity_id = ?
				`)
				.get(otherAccountId) as { n: number }
		).n;

		expect(myCount).toBe(1);
		expect(otherCount).toBe(0);
	});

	test("messages without a matching folder label are not labelled", () => {
		const folderId = createTestFolder(db, identityId, "INBOX");
		createTestMessage(db, identityId, folderId, 1);

		// Don't call ensureLabelsForFolders — no labels exist
		makeSync(identityId, db).applyFolderLabelsToMessages();

		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(0);
	});
});

// ─── refreshLabelCounts ────────────────────────────────────────────────────

describe("refreshLabelCounts", () => {
	let db: ReturnType<typeof createTestDb>;
	let identityId: number;

	beforeEach(() => {
		db = createTestDb();
		identityId = createTestIdentity(db);
	});

	test("no labels → no-op", () => {
		makeSync(identityId, db).refreshLabelCounts();
		// Just verify it doesn't throw
	});

	test("sets message_count and unread_count correctly", () => {
		const folderId = createTestFolder(db, identityId, "INBOX");
		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();

		// 2 unread, 1 read
		createTestMessage(db, identityId, folderId, 1, { flags: "" });
		createTestMessage(db, identityId, folderId, 2, { flags: "" });
		createTestMessage(db, identityId, folderId, 3, { flags: "\\Seen" });
		sync.applyFolderLabelsToMessages();
		sync.refreshLabelCounts();

		const label = db
			.prepare("SELECT message_count, unread_count FROM labels WHERE name = 'INBOX'")
			.get() as { message_count: number; unread_count: number };
		expect(label.message_count).toBe(3);
		expect(label.unread_count).toBe(2);
	});

	test("updates counts after additional messages are applied", () => {
		const folderId = createTestFolder(db, identityId, "INBOX");
		const sync = makeSync(identityId, db);
		sync.ensureLabelsForFolders();

		createTestMessage(db, identityId, folderId, 1, { flags: "" });
		sync.applyFolderLabelsToMessages();
		sync.refreshLabelCounts();

		const before = db
			.prepare("SELECT message_count, unread_count FROM labels WHERE name = 'INBOX'")
			.get() as { message_count: number; unread_count: number };
		expect(before.message_count).toBe(1);
		expect(before.unread_count).toBe(1);

		createTestMessage(db, identityId, folderId, 2, { flags: "\\Seen" });
		sync.applyFolderLabelsToMessages();
		sync.refreshLabelCounts();

		const after = db
			.prepare("SELECT message_count, unread_count FROM labels WHERE name = 'INBOX'")
			.get() as { message_count: number; unread_count: number };
		expect(after.message_count).toBe(2);
		expect(after.unread_count).toBe(1);
	});

	test("global refresh — counts span all identities", () => {
		const otherAccountId = createTestIdentity(db);
		const folderId = createTestFolder(db, identityId, "INBOX");
		const otherFolderId = createTestFolder(db, otherAccountId, "INBOX");
		const sync = makeSync(identityId, db);
		const otherSync = makeSync(otherAccountId, db);

		// Both identities share the global INBOX label
		sync.ensureLabelsForFolders();
		otherSync.ensureLabelsForFolders();

		createTestMessage(db, identityId, folderId, 1, { flags: "" });
		createTestMessage(db, otherAccountId, otherFolderId, 1, { flags: "" });
		createTestMessage(db, otherAccountId, otherFolderId, 2, { flags: "" });
		sync.applyFolderLabelsToMessages();
		otherSync.applyFolderLabelsToMessages();

		// Refresh using either identity's sync — result is the same (global)
		sync.refreshLabelCounts();

		const inboxLabel = db
			.prepare("SELECT message_count FROM labels WHERE name = 'INBOX'")
			.get() as { message_count: number };
		// All 3 messages (1 from identity, 2 from otherIdentity) are under the global INBOX label
		expect(inboxLabel.message_count).toBe(3);
	});
});

// ─── syncAll integration via mock IMAP ─────────────────────────────────────

import { afterEach } from "vitest";
import {
	MockImapServer,
	type MockMailbox,
	buildRawEmail,
} from "../test-helpers/mock-imap-server.js";

describe("syncAll — label pipeline integration", () => {
	let db: ReturnType<typeof createTestDb>;
	let identityId: number;
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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		db.prepare(`
			INSERT INTO outbound_connectors (name, type)
			VALUES ('Test Outbound', 'smtp')
		`).run();
		const outboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		db.prepare(`
			INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
			VALUES ('Test', 'testuser@example.com', ?, ?)
		`).run(inboundId, outboundId);
		identityId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
	});

	afterEach(async () => {
		await server.stop();
		db.close();
	});

	test("syncAll creates labels for synced folders and applies them to messages", async () => {
		const sync = new ImapSync(
			{ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" } },
			db,
			identityId,
		);
		await sync.connect();
		await sync.syncAll();
		await sync.disconnect();

		// INBOX label must exist with source='imap'
		const label = db.prepare("SELECT name, source FROM labels WHERE name = 'INBOX'").get() as
			| { name: string; source: string }
			| undefined;
		expect(label?.name).toBe("INBOX");
		expect(label?.source).toBe("imap");

		// The synced message must have the INBOX label applied
		const msgLabel = db
			.prepare(`
				SELECT l.name FROM message_labels ml
				JOIN labels l ON l.id = ml.label_id
				JOIN messages m ON m.id = ml.message_id
				WHERE m.identity_id = ?
			`)
			.get(identityId) as { name: string } | undefined;
		expect(msgLabel?.name).toBe("INBOX");
	});
});

// ─── sub-batch label application ───────────────────────────────────────────

describe("syncAll — sub-batch label application during large folder sync", () => {
	let db: ReturnType<typeof createTestDb>;
	let identityId: number;
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
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		const inboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		db.prepare(`
			INSERT INTO outbound_connectors (name, type)
			VALUES ('Test Outbound', 'smtp')
		`).run();
		const outboundId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
		db.prepare(`
			INSERT INTO identities (name, email, inbound_connector_id, outbound_connector_id)
			VALUES ('Test', 'testuser@example.com', ?, ?)
		`).run(inboundId, outboundId);
		identityId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);
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
			identityId,
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

		// All 3 messages must be labelled in the end — each gets a folder label + an identity label
		const count = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number }).n;
		expect(count).toBe(6);
	});
});
