import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ensureSchema, openDatabase } from "./db.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-db-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true });
});

describe("openDatabase", () => {
	test("creates database file in specified directory", () => {
		const db = openDatabase("test.db", tmpDir);
		db.close();
		expect(fs.existsSync(path.join(tmpDir, "test.db"))).toBe(true);
	});

	test("returns a database with schema applied", () => {
		const db = openDatabase("test.db", tmpDir);
		const row = db.prepare("SELECT version FROM schema_version").get() as
			| { version: number }
			| undefined;
		expect(row).toBeTruthy();
		expect(row?.version).toBe(SCHEMA_VERSION);
		db.close();
	});

	test("default filename is stork.db", () => {
		const db = openDatabase(undefined, tmpDir);
		db.close();
		expect(fs.existsSync(path.join(tmpDir, "stork.db"))).toBe(true);
	});

	test("enables foreign keys pragma", () => {
		const db = openDatabase("pragma-test.db", tmpDir);
		const result = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
		expect(result.foreign_keys).toBe(1);
		db.close();
	});
});

describe("ensureSchema", () => {
	test("is idempotent — calling twice does not duplicate schema", () => {
		const db = new Database(":memory:");
		db.exec("ATTACH DATABASE ':memory:' AS blobs");
		db.exec(
			"CREATE TABLE IF NOT EXISTS blobs.attachment_blobs (content_hash TEXT PRIMARY KEY, data BLOB NOT NULL)",
		);
		ensureSchema(db);
		ensureSchema(db);
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
	});

	test("applies all migrations to reach current SCHEMA_VERSION", () => {
		const db = new Database(":memory:");
		db.exec("ATTACH DATABASE ':memory:' AS blobs");
		db.exec(
			"CREATE TABLE IF NOT EXISTS blobs.attachment_blobs (content_hash TEXT PRIMARY KEY, data BLOB NOT NULL)",
		);
		ensureSchema(db);
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
	});
});

/**
 * Helper: apply migrations 0..targetVersion-1 to a fresh in-memory DB,
 * set schema_version to targetVersion, return the DB at that state.
 */
function applyMigrationsTo(targetVersion: number): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("ATTACH DATABASE ':memory:' AS blobs");
	db.exec(
		"CREATE TABLE IF NOT EXISTS blobs.attachment_blobs (content_hash TEXT PRIMARY KEY, data BLOB NOT NULL)",
	);
	// Apply first migration to create base schema
	db.exec(MIGRATIONS[0]);
	// Apply subsequent migrations up to targetVersion
	for (let i = 1; i < targetVersion; i++) {
		db.exec(MIGRATIONS[i]);
	}
	db.prepare("UPDATE schema_version SET version = ?").run(targetVersion);
	return db;
}

describe("pre-migration hooks", () => {
	test("v21 hook migrates inline attachment data to attachment_blobs", () => {
		// Build DB at schema version 20: has attachments.data column and
		// attachment_blobs table, but attachments may have inline data + null content_hash
		const db = applyMigrationsTo(20);

		// Insert a connector and message so FK constraints are satisfied
		db.exec(`
			INSERT INTO inbound_connectors (id, name, type) VALUES (1, 'Test IMAP', 'imap');
			INSERT INTO folders (id, inbound_connector_id, path, name) VALUES (1, 1, 'INBOX', 'Inbox');
			INSERT INTO messages (id, folder_id, uid, subject) VALUES (1, 1, 100, 'Test');
		`);

		// Insert attachment with inline data but no content_hash
		const testData = Buffer.from("hello attachment");
		db.prepare(
			"INSERT INTO attachments (id, message_id, filename, data) VALUES (1, 1, 'test.txt', ?)",
		).run(testData);

		// Run ensureSchema to trigger v21 hook + remaining migrations
		ensureSchema(db);

		// Verify: attachment_blobs should have the data keyed by SHA-256
		const expectedHash = createHash("sha256").update(testData).digest("hex");
		const blob = db
			.prepare("SELECT data FROM blobs.attachment_blobs WHERE content_hash = ?")
			.get(expectedHash) as { data: Buffer } | undefined;
		expect(blob).toBeTruthy();

		// Verify schema is at latest version
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
		db.close();
	});

	test("v23 hook compresses html_body, raw_headers, and attachment blobs", () => {
		// Build DB at schema version 22
		const db = applyMigrationsTo(22);

		// Insert test data: a connector, folder, and message with uncompressed text fields
		db.exec(`
			INSERT INTO inbound_connectors (id, name, type) VALUES (1, 'Test IMAP', 'imap');
			INSERT INTO folders (id, inbound_connector_id, path, name) VALUES (1, 1, 'INBOX', 'Inbox');
		`);

		const htmlBody =
			"<h1>Hello World</h1><p>This is a test email with enough content to compress well.</p>";
		const rawHeaders = "From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Test\r\n";
		db.prepare(
			"INSERT INTO messages (id, folder_id, uid, subject, html_body, raw_headers) VALUES (1, 1, 100, 'Test', ?, ?)",
		).run(htmlBody, rawHeaders);

		// Insert an uncompressed attachment blob
		const blobData = Buffer.from("This is attachment content that should be compressed");
		const hash = createHash("sha256").update(blobData).digest("hex");
		db.prepare("INSERT INTO attachment_blobs (content_hash, data) VALUES (?, ?)").run(
			hash,
			blobData,
		);

		// Run ensureSchema to trigger v23 hook + v24 hook + remaining migrations
		ensureSchema(db);

		// Verify html_body is now a compressed Buffer (not a string)
		const msg = db.prepare("SELECT html_body, raw_headers FROM messages WHERE id = 1").get() as {
			html_body: Buffer | string;
			raw_headers: Buffer | string;
		};
		expect(Buffer.isBuffer(msg.html_body)).toBe(true);
		expect(inflateSync(msg.html_body as Buffer).toString("utf-8")).toBe(htmlBody);
		expect(Buffer.isBuffer(msg.raw_headers)).toBe(true);
		expect(inflateSync(msg.raw_headers as Buffer).toString("utf-8")).toBe(rawHeaders);

		// Verify attachment blob is compressed (starts with zlib header 0x78)
		const blob = db
			.prepare("SELECT data FROM blobs.attachment_blobs WHERE content_hash = ?")
			.get(hash) as {
			data: Buffer;
		};
		expect(blob.data[0]).toBe(0x78);
		expect(inflateSync(blob.data).toString("utf-8")).toBe(
			"This is attachment content that should be compressed",
		);

		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
		db.close();
	});

	test("v23 hook skips already-compressed attachment blobs", () => {
		const db = applyMigrationsTo(22);

		// Insert a pre-compressed blob (starts with 0x78 zlib header)
		const original = Buffer.from("test data for compression");
		const compressed = deflateSync(original);
		expect(compressed[0]).toBe(0x78); // sanity check
		const hash = createHash("sha256").update(original).digest("hex");
		db.prepare("INSERT INTO attachment_blobs (content_hash, data) VALUES (?, ?)").run(
			hash,
			compressed,
		);

		ensureSchema(db);

		// Should remain as-is (not double-compressed)
		const blob = db
			.prepare("SELECT data FROM blobs.attachment_blobs WHERE content_hash = ?")
			.get(hash) as {
			data: Buffer;
		};
		expect(inflateSync(blob.data).toString("utf-8")).toBe("test data for compression");
		db.close();
	});

	test("v24 hook backfills text_body from HTML-only messages", () => {
		// Build DB at schema version 23 (v23 hook needs no data, just runs)
		const db = applyMigrationsTo(23);

		db.exec(`
			INSERT INTO inbound_connectors (id, name, type) VALUES (1, 'Test IMAP', 'imap');
			INSERT INTO folders (id, inbound_connector_id, path, name) VALUES (1, 1, 'INBOX', 'Inbox');
		`);

		// Insert a message with compressed html_body but null text_body
		const html = "<h1>Title</h1><p>Body text for search indexing</p>";
		const compressedHtml = deflateSync(Buffer.from(html, "utf-8"));
		db.prepare(
			"INSERT INTO messages (id, folder_id, uid, subject, html_body, text_body) VALUES (1, 1, 100, 'Test', ?, NULL)",
		).run(compressedHtml);

		ensureSchema(db);

		// Verify text_body was backfilled with extracted text
		const msg = db.prepare("SELECT text_body FROM messages WHERE id = 1").get() as {
			text_body: string | null;
		};
		expect(msg.text_body).toBeTruthy();
		expect(msg.text_body).toContain("Title");
		expect(msg.text_body).toContain("Body text for search indexing");

		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
		db.close();
	});

	test("v24 hook handles uncompressed (string) html_body", () => {
		const db = applyMigrationsTo(23);

		db.exec(`
			INSERT INTO inbound_connectors (id, name, type) VALUES (1, 'Test IMAP', 'imap');
			INSERT INTO folders (id, inbound_connector_id, path, name) VALUES (1, 1, 'INBOX', 'Inbox');
		`);

		// Insert with plain string html_body (legacy uncompressed)
		const html = "<p>Plain string HTML body</p>";
		db.prepare(
			"INSERT INTO messages (id, folder_id, uid, subject, html_body, text_body) VALUES (1, 1, 100, 'Test', ?, NULL)",
		).run(html);

		ensureSchema(db);

		const msg = db.prepare("SELECT text_body FROM messages WHERE id = 1").get() as {
			text_body: string | null;
		};
		expect(msg.text_body).toBeTruthy();
		expect(msg.text_body).toContain("Plain string HTML body");
		db.close();
	});
});
