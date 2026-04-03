import Database from "better-sqlite3-multiple-ciphers";
import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, test } from "vitest";
import { upsertAttachmentBlob } from "../storage/attachment-storage.js";
import { ensureSchema } from "../storage/db.js";
import { MIGRATIONS, SCHEMA_VERSION } from "../storage/schema.js";

// We test the MIME parsing and helper functions directly since the ImapSync class
// requires a live IMAP connection. Integration tests with a mock IMAP server
// belong in a separate suite.

function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

function createAccount(db: Database.Database): number {
	db.prepare(`
		INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
		VALUES ('Test Inbound', 'imap', 'imap.example.com', 993, 1, 'test', 'pass')
	`).run();
	return (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

function createFolder(db: Database.Database, connectorId: number, path: string): number {
	db.prepare(`
		INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags)
		VALUES (?, ?, ?, '/', '[]')
	`).run(connectorId, path, path.split("/").pop());
	return (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

describe("MIME parsing with mailparser", () => {
	test("parses simple plain text email", async () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: Hello World",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"This is the body text.",
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		expect(parsed.text).toBe("This is the body text.");
		expect(parsed.subject).toBe("Hello World");
		expect(parsed.from?.value[0].address).toBe("sender@example.com");
	});

	test("parses multipart email with text and HTML", async () => {
		const boundary = "----=_Part_12345";
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: Multipart Test",
			`Content-Type: multipart/alternative; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Plain text version.",
			`--${boundary}`,
			"Content-Type: text/html; charset=utf-8",
			"",
			"<p>HTML version.</p>",
			`--${boundary}--`,
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		expect(parsed.text).toBe("Plain text version.");
		expect(parsed.html).toBe("<p>HTML version.</p>");
	});

	test("extracts attachments from multipart/mixed", async () => {
		const boundary = "----=_Part_67890";
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: With Attachment",
			`Content-Type: multipart/mixed; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			"See attached.",
			`--${boundary}`,
			"Content-Type: application/octet-stream",
			'Content-Disposition: attachment; filename="data.bin"',
			"Content-Transfer-Encoding: base64",
			"",
			"SGVsbG8gV29ybGQ=",
			`--${boundary}--`,
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		expect(parsed.attachments.length).toBe(1);
		expect(parsed.attachments[0].filename).toBe("data.bin");
		expect(parsed.attachments[0].content.toString()).toBe("Hello World");
	});

	test("handles email with no text body (HTML only)", async () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: HTML Only",
			"Content-Type: text/html; charset=utf-8",
			"",
			"<h1>Hello</h1>",
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		// mailparser auto-generates text from HTML
		expect(parsed.html).toBe("<h1>Hello</h1>");
	});

	test("parses references header", async () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: Re: Thread",
			"In-Reply-To: <msg1@example.com>",
			"References: <msg0@example.com> <msg1@example.com>",
			"Content-Type: text/plain",
			"",
			"Reply body.",
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		expect(parsed.inReplyTo).toBe("<msg1@example.com>");
		const refs = parsed.references;
		expect(Array.isArray(refs)).toBe(true);
		expect(refs).toContain("<msg0@example.com>");
		expect(refs).toContain("<msg1@example.com>");
	});

	test("handles encoded subject (RFC 2047)", async () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: =?UTF-8?B?w7xiZXIgZGllIEJyw7xja2U=?=",
			"Content-Type: text/plain",
			"",
			"Body.",
		].join("\r\n");

		const parsed = await simpleParser(Buffer.from(raw));
		// mailparser lowercases the first char in RFC 2047 decoding
		expect(parsed.subject).toBe("über die Brücke");
	});
});

describe("schema migrations", () => {
	test("version 2 adds special_use column to folders", () => {
		const db = createTestDb();
		const identityId = createAccount(db);

		// Insert a folder with special_use
		db.prepare(`
			INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, special_use)
			VALUES (?, 'INBOX', 'Inbox', '/', '[]', '\\Inbox')
		`).run(identityId);

		const folder = db.prepare("SELECT special_use FROM folders WHERE path = 'INBOX'").get() as {
			special_use: string;
		};
		expect(folder.special_use).toBe("\\Inbox");
		db.close();
	});

	test("fresh database via ensureSchema applies all migrations including special_use", () => {
		// Use ensureSchema directly (the same code path as openDatabase) on an empty DB
		const db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		ensureSchema(db);

		// Verify special_use column exists by inserting a folder that uses it
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('Test Inbound', 'imap', 'localhost', 993, 1, 'user', 'pass')
		`).run();
		const inboundId = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
		db.prepare(
			`INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, special_use)
				 VALUES (?, 'INBOX', 'Inbox', '/', '[]', '\\Inbox')`,
		).run(inboundId.id);

		const folder = db.prepare("SELECT special_use FROM folders WHERE path = 'INBOX'").get() as {
			special_use: string;
		};
		expect(folder.special_use).toBe("\\Inbox");

		// Verify schema version is set to latest
		const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(version.version).toBe(SCHEMA_VERSION);

		db.close();
	});
});

describe("database operations", () => {
	let db: Database.Database;
	let identityId: number;

	beforeEach(() => {
		db = createTestDb();
		identityId = createAccount(db);
	});

	test("message insert with attachments", () => {
		const folderId = createFolder(db, identityId, "INBOX");

		const result = db
			.prepare(`
			INSERT INTO messages (
				inbound_connector_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, date,
				text_body, html_body, flags, size, has_attachments
			) VALUES (?, ?, 1, '<test@example.com>', 'Test Subject',
				'sender@example.com', 'Sender', '["recipient@example.com"]',
				'2026-01-01T00:00:00Z', 'body text', '<p>body</p>',
				'["\\\\Seen"]', 1234, 1)
		`)
			.run(identityId, folderId);

		const messageId = result.lastInsertRowid;

		// Insert attachment via blob-based path
		const attHash = upsertAttachmentBlob(db, Buffer.from("Hello"));
		db.prepare(`
			INSERT INTO attachments (message_id, filename, content_type, size, content_id, content_hash)
			VALUES (?, 'test.pdf', 'application/pdf', 1024, null, ?)
		`).run(messageId, attHash);

		const att = db.prepare("SELECT * FROM attachments WHERE message_id = ?").get(messageId) as {
			filename: string;
			content_type: string;
			size: number;
		};
		expect(att.filename).toBe("test.pdf");
		expect(att.content_type).toBe("application/pdf");
		expect(att.size).toBe(1024);

		db.close();
	});

	test("UIDVALIDITY change triggers message cleanup", () => {
		const folderId = createFolder(db, identityId, "INBOX");

		// Insert some messages
		db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, subject, from_address, flags, size)
			VALUES (?, ?, 1, 'Msg 1', 'a@b.com', '[]', 100)
		`).run(identityId, folderId);
		db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, subject, from_address, flags, size)
			VALUES (?, ?, 2, 'Msg 2', 'a@b.com', '[]', 200)
		`).run(identityId, folderId);

		const countBefore = (
			db.prepare("SELECT count(*) as c FROM messages WHERE folder_id = ?").get(folderId) as {
				c: number;
			}
		).c;
		expect(countBefore).toBe(2);

		// Simulate UIDVALIDITY change by deleting messages (as the sync engine would)
		db.prepare("DELETE FROM messages WHERE folder_id = ?").run(folderId);

		const countAfter = (
			db.prepare("SELECT count(*) as c FROM messages WHERE folder_id = ?").get(folderId) as {
				c: number;
			}
		).c;
		expect(countAfter).toBe(0);

		db.close();
	});

	test("folder deletion cascades to messages and sync_state", () => {
		const folderId = createFolder(db, identityId, "INBOX");

		db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, subject, from_address, flags, size)
			VALUES (?, ?, 1, 'Test', 'a@b.com', '[]', 100)
		`).run(identityId, folderId);

		db.prepare(`
			INSERT INTO sync_state (inbound_connector_id, folder_id, last_uid)
			VALUES (?, ?, 1)
		`).run(identityId, folderId);

		// Delete folder — should cascade
		db.prepare("DELETE FROM folders WHERE id = ?").run(folderId);

		const msgCount = (
			db.prepare("SELECT count(*) as c FROM messages WHERE folder_id = ?").get(folderId) as {
				c: number;
			}
		).c;
		const syncCount = (
			db.prepare("SELECT count(*) as c FROM sync_state WHERE folder_id = ?").get(folderId) as {
				c: number;
			}
		).c;

		expect(msgCount).toBe(0);
		expect(syncCount).toBe(0);

		db.close();
	});

	test("flag update on existing message", () => {
		const folderId = createFolder(db, identityId, "INBOX");

		db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, subject, from_address, flags, size)
			VALUES (?, ?, 1, 'Test', 'a@b.com', '[]', 100)
		`).run(identityId, folderId);

		// Simulate flag sync
		db.prepare("UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?").run(
			'["\\\\Seen","\\\\Flagged"]',
			folderId,
			1,
		);

		const msg = db
			.prepare("SELECT flags FROM messages WHERE folder_id = ? AND uid = ?")
			.get(folderId, 1) as { flags: string };
		expect(msg.flags).toContain("\\Seen");
		expect(msg.flags).toContain("\\Flagged");

		db.close();
	});
});
