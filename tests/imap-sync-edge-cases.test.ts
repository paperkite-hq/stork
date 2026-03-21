import type Database from "@signalapp/better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ImapSync } from "../src/sync/imap-sync.js";
import { MockImapServer, type MockMailbox, buildRawEmail } from "./helpers/mock-imap-server.js";
import { createTestDb } from "./helpers/test-db.js";

describe("IMAP sync edge cases", () => {
	let server: MockImapServer;
	let port: number;
	let db: Database;
	let accountId: number;

	function makeMailboxes(overrides?: Partial<MockMailbox>[]): MockMailbox[] {
		const defaults: MockMailbox[] = [
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
							from: "alice@example.com",
							to: "test@example.com",
							subject: "First message",
							body: "Hello world.",
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
							subject: "Second message",
							body: "Another email.",
							messageId: "<msg2@example.com>",
							date: "Thu, 16 Jan 2026 14:30:00 +0000",
						}),
					},
				],
			},
		];

		if (overrides) {
			for (let i = 0; i < overrides.length && i < defaults.length; i++) {
				Object.assign(defaults[i], overrides[i]);
			}
		}

		return defaults;
	}

	beforeEach(async () => {
		db = createTestDb();
	});

	afterEach(async () => {
		db.close();
		if (server) await server.stop();
	});

	async function setupServer(mailboxes: MockMailbox[]) {
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes,
		});
		port = await server.start();

		db.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test', 'test@example.com', '127.0.0.1', ?, 0, 'testuser', 'testpass')
		`).run(port);
		accountId = Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	}

	function makeSync() {
		return new ImapSync(
			{
				host: "127.0.0.1",
				port,
				secure: false,
				auth: { user: "testuser", pass: "testpass" },
			},
			db,
			accountId,
		);
	}

	test("UIDVALIDITY change triggers full resync of folder", async () => {
		// Phase 1: initial sync with uidValidity=1
		const mailboxes = makeMailboxes();
		await setupServer(mailboxes);

		const sync1 = makeSync();
		await sync1.connect();
		await sync1.syncAll();

		const msgCount1 = (
			db.prepare("SELECT count(*) as c FROM messages WHERE account_id = ?").get(accountId) as {
				c: number;
			}
		).c;
		expect(msgCount1).toBe(2);

		// Verify uid_validity was stored
		const folder1 = db
			.prepare("SELECT uid_validity FROM folders WHERE account_id = ? AND path = 'INBOX'")
			.get(accountId) as { uid_validity: number };
		expect(folder1.uid_validity).toBe(1);

		await sync1.disconnect();
		await server.stop();

		// Phase 2: server now has different uidValidity (simulating folder recreation)
		const newMailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 2, // Changed!
				uidNext: 2,
				messages: [
					{
						uid: 1,
						flags: [],
						internalDate: "2026-02-01T10:00:00Z",
						source: buildRawEmail({
							from: "carol@example.com",
							to: "test@example.com",
							subject: "New message after recreate",
							body: "Entirely new mailbox.",
							messageId: "<new1@example.com>",
							date: "Sat, 01 Feb 2026 10:00:00 +0000",
						}),
					},
				],
			},
		];

		await setupServer(newMailboxes);

		// Need to update the existing account rather than inserting a new one
		db.prepare("UPDATE accounts SET imap_port = ? WHERE id = ?").run(port, accountId);

		const sync2 = makeSync();
		await sync2.connect();
		await sync2.syncAll();

		// The old messages should be cleared and only the new one remains
		const messages = db
			.prepare("SELECT subject FROM messages WHERE account_id = ?")
			.all(accountId) as { subject: string }[];

		// Should have the new message
		expect(messages.some((m) => m.subject === "New message after recreate")).toBe(true);

		// uid_validity should be updated
		const folder2 = db
			.prepare("SELECT uid_validity FROM folders WHERE account_id = ? AND path = 'INBOX'")
			.get(accountId) as { uid_validity: number };
		expect(folder2.uid_validity).toBe(2);

		await sync2.disconnect();
	});

	test("multipart MIME email with HTML body is parsed correctly", async () => {
		const mailboxes: MockMailbox[] = [
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
						internalDate: "2026-01-20T12:00:00Z",
						source: buildRawEmail({
							from: "designer@example.com",
							to: "test@example.com",
							subject: "HTML Newsletter",
							body: "Plain text fallback of the newsletter.",
							html: "<html><body><h1>Welcome</h1><p>Rich content here.</p></body></html>",
							messageId: "<html1@example.com>",
							date: "Mon, 20 Jan 2026 12:00:00 +0000",
						}),
					},
				],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		const msg = db
			.prepare(
				"SELECT subject, text_body, html_body FROM messages WHERE account_id = ? AND uid = 1",
			)
			.get(accountId) as { subject: string; text_body: string | null; html_body: string | null };

		expect(msg.subject).toBe("HTML Newsletter");
		expect(msg.text_body).toContain("Plain text fallback");
		expect(msg.html_body).toContain("<h1>Welcome</h1>");

		await sync.disconnect();
	});

	test("message with thread references is stored correctly", async () => {
		const mailboxes: MockMailbox[] = [
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
							subject: "Original thread",
							body: "Starting a conversation.",
							messageId: "<thread1@example.com>",
							date: "Wed, 15 Jan 2026 10:00:00 +0000",
						}),
					},
					{
						uid: 2,
						flags: [],
						internalDate: "2026-01-15T11:00:00Z",
						source: buildRawEmail({
							from: "bob@example.com",
							to: "alice@example.com",
							subject: "Re: Original thread",
							body: "Reply to the thread.",
							messageId: "<thread2@example.com>",
							inReplyTo: "<thread1@example.com>",
							references: "<thread1@example.com>",
							date: "Wed, 15 Jan 2026 11:00:00 +0000",
						}),
					},
					{
						uid: 3,
						flags: [],
						internalDate: "2026-01-15T12:00:00Z",
						source: buildRawEmail({
							from: "carol@example.com",
							to: "bob@example.com",
							subject: "Re: Original thread",
							body: "Joining the thread.",
							messageId: "<thread3@example.com>",
							inReplyTo: "<thread2@example.com>",
							references: "<thread1@example.com> <thread2@example.com>",
							date: "Wed, 15 Jan 2026 12:00:00 +0000",
						}),
					},
				],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		await sync.syncAll();

		const msg2 = db
			.prepare('SELECT in_reply_to, "references" FROM messages WHERE account_id = ? AND uid = 2')
			.get(accountId) as { in_reply_to: string | null; references: string | null };

		expect(msg2.in_reply_to).toBe("<thread1@example.com>");
		expect(msg2.references).toBeTruthy();
		const refs = JSON.parse(msg2.references ?? "[]");
		expect(refs).toContain("<thread1@example.com>");

		const msg3 = db
			.prepare('SELECT in_reply_to, "references" FROM messages WHERE account_id = ? AND uid = 3')
			.get(accountId) as { in_reply_to: string | null; references: string | null };

		expect(msg3.in_reply_to).toBe("<thread2@example.com>");
		const refs3 = JSON.parse(msg3.references ?? "[]");
		expect(refs3.length).toBeGreaterThanOrEqual(2);

		await sync.disconnect();
	});

	test("empty mailbox syncs without errors", async () => {
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		const result = await sync.syncAll();

		expect(result.totalErrors).toBe(0);
		expect(result.totalNew).toBe(0);

		const msgCount = (
			db.prepare("SELECT count(*) as c FROM messages WHERE account_id = ?").get(accountId) as {
				c: number;
			}
		).c;
		expect(msgCount).toBe(0);

		await sync.disconnect();
	});

	test("incremental sync picks up new messages added after first sync", async () => {
		const mailboxes = makeMailboxes();
		await setupServer(mailboxes);

		// First sync
		const sync1 = makeSync();
		await sync1.connect();
		await sync1.syncAll();

		const count1 = (
			db.prepare("SELECT count(*) as c FROM messages WHERE account_id = ?").get(accountId) as {
				c: number;
			}
		).c;
		expect(count1).toBe(2);

		await sync1.disconnect();

		// Add a new message to the server
		server.updateMailbox("INBOX", (mb) => {
			mb.messages.push({
				uid: 3,
				flags: [],
				internalDate: "2026-01-18T09:00:00Z",
				source: buildRawEmail({
					from: "dave@example.com",
					to: "test@example.com",
					subject: "Late arrival",
					body: "I arrived after the first sync.",
					messageId: "<msg3@example.com>",
					date: "Sat, 18 Jan 2026 09:00:00 +0000",
				}),
			});
			mb.uidNext = 4;
		});

		// Second sync
		const sync2 = makeSync();
		await sync2.connect();
		const result2 = await sync2.syncAll();

		expect(result2.totalNew).toBeGreaterThanOrEqual(1);

		const allMsgs = db
			.prepare("SELECT subject FROM messages WHERE account_id = ? ORDER BY uid")
			.all(accountId) as { subject: string }[];

		expect(allMsgs.length).toBeGreaterThanOrEqual(3);
		expect(allMsgs.some((m) => m.subject === "Late arrival")).toBe(true);

		await sync2.disconnect();
	});

	test("special-use folder detection by common names", async () => {
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: [],
				// No specialUse attribute — should be detected by name
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Sent",
				name: "Sent",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Trash",
				name: "Trash",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Junk",
				name: "Junk",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Drafts",
				name: "Drafts",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		await sync.syncFolders();

		const folders = db
			.prepare("SELECT path, special_use FROM folders WHERE account_id = ? ORDER BY path")
			.all(accountId) as { path: string; special_use: string | null }[];

		const folderMap = new Map(folders.map((f) => [f.path, f.special_use]));
		expect(folderMap.get("INBOX")).toBe("\\Inbox");
		expect(folderMap.get("Sent")).toBe("\\Sent");
		expect(folderMap.get("Trash")).toBe("\\Trash");
		expect(folderMap.get("Junk")).toBe("\\Junk");
		expect(folderMap.get("Drafts")).toBe("\\Drafts");

		await sync.disconnect();
	});

	test("flag sync detects changed flags between syncs", async () => {
		const mailboxes = makeMailboxes();
		await setupServer(mailboxes);

		// First sync — message UID 1 has \\Seen flag
		const sync1 = makeSync();
		await sync1.connect();
		await sync1.syncAll();

		const flagsBefore = db
			.prepare("SELECT flags FROM messages WHERE account_id = ? AND uid = 1")
			.get(accountId) as { flags: string } | undefined;

		expect(flagsBefore).toBeTruthy();
		if (flagsBefore) {
			const parsedFlags = JSON.parse(flagsBefore.flags);
			expect(parsedFlags).toContain("\\Seen");
		}

		await sync1.disconnect();

		// Now change flags on server: add \\Flagged to UID 1
		server.updateMailbox("INBOX", (mb) => {
			const msg = mb.messages.find((m) => m.uid === 1);
			if (msg) msg.flags = ["\\Seen", "\\Flagged"];
		});

		// Second sync — should detect the flag change
		const sync2 = makeSync();
		await sync2.connect();
		const result2 = await sync2.syncAll();

		const flagsAfter = db
			.prepare("SELECT flags FROM messages WHERE account_id = ? AND uid = 1")
			.get(accountId) as { flags: string } | undefined;

		expect(flagsAfter).toBeTruthy();
		if (flagsAfter) {
			const parsedFlags = JSON.parse(flagsAfter.flags);
			expect(parsedFlags).toContain("\\Flagged");
		}

		await sync2.disconnect();
	});

	test("disconnect() does not throw when the server closes the connection abruptly", async () => {
		await setupServer(makeMailboxes());
		const sync = makeSync();
		await sync.connect();

		// Stop the server before calling disconnect — logout() will fail because the
		// underlying TCP connection is gone. The catch block in disconnect() must
		// swallow the error silently.
		await server.stop();

		// Should resolve without throwing despite the broken connection
		await expect(sync.disconnect()).resolves.toBeUndefined();
	});

	test("\\Noselect folder is skipped during syncFolders", async () => {
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: ["\\HasNoChildren"],
				specialUse: "\\Inbox",
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				// A namespace root that should not be selectable
				path: "[Gmail]",
				name: "[Gmail]",
				delimiter: "/",
				flags: ["\\Noselect", "\\HasChildren"],
				uidValidity: 0,
				uidNext: 0,
				messages: [],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		await sync.syncFolders();

		const folders = db.prepare("SELECT path FROM folders WHERE account_id = ?").all(accountId) as {
			path: string;
		}[];

		const paths = folders.map((f) => f.path);
		// The \Noselect folder must be filtered out
		expect(paths).not.toContain("[Gmail]");
		expect(paths).toContain("INBOX");

		await sync.disconnect();
	});

	test("special-use folder detection: additional name variants (Sent Mail, Deleted Items, [Gmail]/All Mail)", async () => {
		const mailboxes: MockMailbox[] = [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Sent Mail",
				name: "Sent Mail",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Sent Items",
				name: "Sent Items",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Draft",
				name: "Draft",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Deleted",
				name: "Deleted",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Deleted Items",
				name: "Deleted Items",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Spam",
				name: "Spam",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "Archive",
				name: "Archive",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				path: "[Gmail]/All Mail",
				name: "All Mail",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
			{
				// Path with no matching special-use name — should remain null
				path: "Custom Folder",
				name: "Custom Folder",
				delimiter: "/",
				flags: [],
				uidValidity: 1,
				uidNext: 1,
				messages: [],
			},
		];

		await setupServer(mailboxes);
		const sync = makeSync();
		await sync.connect();
		await sync.syncFolders();

		const folders = db
			.prepare("SELECT path, special_use FROM folders WHERE account_id = ? ORDER BY path")
			.all(accountId) as { path: string; special_use: string | null }[];

		const folderMap = new Map(folders.map((f) => [f.path, f.special_use]));

		expect(folderMap.get("Sent Mail")).toBe("\\Sent");
		expect(folderMap.get("Sent Items")).toBe("\\Sent");
		expect(folderMap.get("Draft")).toBe("\\Drafts");
		expect(folderMap.get("Deleted")).toBe("\\Trash");
		expect(folderMap.get("Deleted Items")).toBe("\\Trash");
		expect(folderMap.get("Spam")).toBe("\\Junk");
		expect(folderMap.get("Archive")).toBe("\\Archive");
		expect(folderMap.get("[Gmail]/All Mail")).toBe("\\Archive");
		expect(folderMap.get("Custom Folder")).toBeNull();

		await sync.disconnect();
	});

	test("flag sync with no flag changes does not update the database", async () => {
		// Set up with one message
		const mailboxes = makeMailboxes();
		await setupServer(mailboxes);

		// First sync — establishes baseline flags
		const sync1 = makeSync();
		await sync1.connect();
		await sync1.syncAll();
		await sync1.disconnect();

		// Read the initial flags
		const flagsBefore = db
			.prepare("SELECT flags FROM messages WHERE account_id = ? AND uid = 1")
			.get(accountId) as { flags: string };
		expect(flagsBefore).toBeTruthy();

		// Second sync — server flags are unchanged
		const sync2 = makeSync();
		await sync2.connect();
		const result = await sync2.syncAll();
		await sync2.disconnect();

		// Flags should be unchanged in the DB (false branch of oldFlags !== newFlags)
		const flagsAfter = db
			.prepare("SELECT flags FROM messages WHERE account_id = ? AND uid = 1")
			.get(accountId) as { flags: string };
		expect(flagsAfter.flags).toBe(flagsBefore.flags);

		// No errors from sync
		expect(result.totalErrors).toBe(0);
	});
});
