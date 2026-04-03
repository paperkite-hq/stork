import type Database from "better-sqlite3-multiple-ciphers";
import { describe, expect, test } from "vitest";
import { createTestDb } from "../test-helpers/test-db.js";
import { decompressText } from "./compression.js";
import { storeInboundEmail } from "./email-storage.js";

/** Build a minimal RFC 5322 message and return it as base64 */
function buildRaw(
	opts: {
		from?: string;
		to?: string;
		cc?: string;
		subject?: string;
		body?: string;
		messageId?: string;
		inReplyTo?: string;
		references?: string;
		noDate?: boolean;
		html?: string;
		hasAttachment?: boolean;
	} = {},
): string {
	const lines: string[] = [];
	if (opts.messageId) lines.push(`Message-ID: ${opts.messageId}`);
	if (opts.from) lines.push(`From: ${opts.from}`);
	if (opts.to) lines.push(`To: ${opts.to}`);
	if (opts.cc) lines.push(`Cc: ${opts.cc}`);
	if (opts.subject) lines.push(`Subject: ${opts.subject ?? "Test"}`);
	if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
	if (opts.references) lines.push(`References: ${opts.references}`);
	if (!opts.noDate) lines.push("Date: Mon, 01 Jan 2024 12:00:00 +0000");

	if (opts.hasAttachment) {
		const boundary = "----boundary";
		lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
		lines.push("");
		lines.push(`--${boundary}`);
		lines.push("Content-Type: text/plain");
		lines.push("");
		lines.push(opts.body ?? "body");
		lines.push(`--${boundary}`);
		lines.push('Content-Type: text/plain; name="file.txt"');
		lines.push('Content-Disposition: attachment; filename="file.txt"');
		lines.push("");
		lines.push("content");
		lines.push(`--${boundary}--`);
	} else if (opts.html) {
		lines.push("MIME-Version: 1.0");
		lines.push("Content-Type: text/html; charset=utf-8");
		lines.push("");
		lines.push(opts.html);
	} else {
		lines.push("Content-Type: text/plain");
		lines.push("");
		lines.push(opts.body ?? "Hello");
	}

	return Buffer.from(lines.join("\r\n")).toString("base64");
}

/** Create an inbound R2 connector and return { connectorId } */
function createR2IdentityAndConnector(
	db: Database.Database,
	name = "Test",
): { connectorId: number } {
	db.prepare(
		`INSERT INTO inbound_connectors (name, type, cf_r2_account_id, cf_r2_bucket_name,
		 cf_r2_access_key_id, cf_r2_secret_access_key, cf_r2_prefix)
		 VALUES (?, 'cloudflare-r2', 'acc', 'bucket', 'key', 'secret', 'pending/')`,
	).run(name);
	const connectorId = Number(
		(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
	);

	return { connectorId };
}

describe("storeInboundEmail", () => {
	test("stores email for a connector with no linked identities", async () => {
		const db = createTestDb();
		db.prepare(
			`INSERT INTO inbound_connectors (name, type, cf_r2_account_id, cf_r2_bucket_name,
			 cf_r2_access_key_id, cf_r2_secret_access_key, cf_r2_prefix)
			 VALUES ('standalone', 'cloudflare-r2', 'acc', 'bucket', 'key', 'secret', 'pending/')`,
		).run();
		const connectorId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);

		const raw = buildRaw({ from: "alice@example.com", subject: "Hi", messageId: "<hi@test.com>" });
		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "",
			raw,
			rawSize: 100,
		});
		expect(result.stored).toBe(1);
	});

	test("stores a basic email and returns stored:1", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "Hello",
			body: "World",
			messageId: "<basic@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: raw.length,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare("SELECT subject, from_address FROM messages LIMIT 1").get() as {
			subject: string;
			from_address: string;
		};
		expect(msg.subject).toBe("Hello");
		expect(msg.from_address).toBe("alice@example.com");
	});

	test("deduplicates emails with the same message-id", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "Duplicate",
			messageId: "<dup@example.com>",
		});
		const payload = { from: "alice@example.com", to: "inbox@example.com", raw, rawSize: 100 };

		const r1 = await storeInboundEmail(db, connectorId, payload);
		expect(r1.stored).toBe(1);

		const r2 = await storeInboundEmail(db, connectorId, payload);
		expect(r2.stored).toBe(0);

		const count = (db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("stores email with no message-id (checkDuplicate = null)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		// No Message-ID header → checkDuplicate is null → no dedup
		const raw = buildRaw({ from: "alice@example.com", subject: "No ID", body: "hi" });

		const r1 = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "",
			raw,
			rawSize: 50,
		});
		expect(r1.stored).toBe(1);

		// Store again — no dedup, so stored again
		const r2 = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "",
			raw,
			rawSize: 50,
		});
		expect(r2.stored).toBe(1);

		const count = (db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number }).n;
		expect(count).toBe(2);
	});

	test("stores email with no Date header (falls back to current time)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		const raw = buildRaw({
			from: "alice@example.com",
			subject: "No date",
			noDate: true,
			messageId: "<nodate@example.com>",
		});

		const before = Date.now();
		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "",
			raw,
			rawSize: 50,
		});
		const after = Date.now();

		expect(result.stored).toBe(1);
		const msg = db.prepare("SELECT date FROM messages LIMIT 1").get() as { date: string };
		const stored = new Date(msg.date).getTime();
		// Should be close to now (within the test window)
		expect(stored).toBeGreaterThanOrEqual(before - 1000);
		expect(stored).toBeLessThanOrEqual(after + 1000);
	});

	test("stores email with no To/Cc headers (null JSON fields)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		// No To or Cc headers → toAddrs/ccAddrs empty → JSON stored as null
		const raw = buildRaw({
			from: "alice@example.com",
			subject: "No recipients",
			messageId: "<norecip@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "",
			raw,
			rawSize: 50,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare("SELECT to_addresses, cc_addresses FROM messages LIMIT 1").get() as {
			to_addresses: string | null;
			cc_addresses: string | null;
		};
		expect(msg.to_addresses).toBeNull();
		expect(msg.cc_addresses).toBeNull();
	});

	test("stores email with no From header (falls back to payload.from)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		// No From header → fromAddr undefined → uses payload.from
		const raw = buildRaw({
			subject: "No from header",
			body: "test",
			messageId: "<nofrom@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "fallback@example.com",
			to: "",
			raw,
			rawSize: 50,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare("SELECT from_address FROM messages LIMIT 1").get() as {
			from_address: string | null;
		};
		expect(msg.from_address).toBe("fallback@example.com");
	});

	test("stores email with HTML body", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "HTML",
			html: "<h1>Hello</h1>",
			messageId: "<html@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: 100,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare("SELECT html_body FROM messages LIMIT 1").get() as {
			html_body: Buffer | string | null;
		};
		expect(decompressText(msg.html_body)).toContain("<h1>Hello</h1>");
	});

	test("stores email with attachment (has_attachments = 1)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "Has attachment",
			messageId: "<attach@example.com>",
			hasAttachment: true,
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: 200,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare("SELECT has_attachments FROM messages LIMIT 1").get() as {
			has_attachments: number;
		};
		expect(msg.has_attachments).toBe(1);
	});

	test("stores email with no References header (refs = null)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		// No References or In-Reply-To → refs = null
		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "Fresh thread",
			messageId: "<fresh@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: 100,
		});
		expect(result.stored).toBe(1);

		const msg = db.prepare('SELECT "references" FROM messages LIMIT 1').get() as {
			references: string | null;
		};
		expect(msg.references).toBeNull();
	});

	test("stores one message per connector regardless of linked identities", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db, "Account1");

		const raw = buildRaw({
			from: "alice@example.com",
			to: "inbox@example.com",
			subject: "Multi-identity",
			messageId: "<multi@example.com>",
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "alice@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: 100,
		});
		// One message per connector (not per identity)
		expect(result.stored).toBe(1);
	});

	test("stores attachment blob when email has an attachment", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);
		const raw = buildRaw({
			from: "sender@example.com",
			to: "inbox@example.com",
			subject: "Has attachment",
			messageId: "<att@example.com>",
			hasAttachment: true,
		});

		const result = await storeInboundEmail(db, connectorId, {
			from: "sender@example.com",
			to: "inbox@example.com",
			raw,
			rawSize: 200,
		});
		expect(result.stored).toBe(1);

		const blobs = db.prepare("SELECT * FROM attachment_blobs").all() as { content_hash: string }[];
		expect(blobs.length).toBe(1);

		const atts = db.prepare("SELECT * FROM attachments").all() as {
			filename: string;
			content_hash: string;
		}[];
		expect(atts.length).toBe(1);
		expect(atts[0].filename).toBe("file.txt");
		expect(atts[0].content_hash).toBe(blobs[0].content_hash);
	});

	test("deduplicates attachment blobs across messages (R2 path)", async () => {
		const db = createTestDb();
		const { connectorId } = createR2IdentityAndConnector(db);

		// Two emails with identical attachment content
		const raw1 = buildRaw({
			from: "a@example.com",
			to: "inbox@example.com",
			messageId: "<dup1@example.com>",
			hasAttachment: true,
		});
		const raw2 = buildRaw({
			from: "b@example.com",
			to: "inbox@example.com",
			messageId: "<dup2@example.com>",
			hasAttachment: true,
		});

		await storeInboundEmail(db, connectorId, {
			from: "a@example.com",
			to: "inbox@example.com",
			raw: raw1,
			rawSize: 200,
		});
		await storeInboundEmail(db, connectorId, {
			from: "b@example.com",
			to: "inbox@example.com",
			raw: raw2,
			rawSize: 200,
		});

		// Two attachment rows (one per message)
		const atts = db.prepare("SELECT * FROM attachments").all();
		expect(atts.length).toBe(2);

		// But only one blob (identical file content stored once)
		const blobs = db.prepare("SELECT * FROM attachment_blobs").all();
		expect(blobs.length).toBe(1);
	});
});
