import type Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDb } from "../test-helpers/test-db.js";
import { R2Poller, parseListObjectsKeys } from "./r2-poller.js";

/** Minimal RFC 5322 email, base64-encoded */
function buildRawEmail(
	opts: {
		from?: string;
		subject?: string;
		messageId?: string;
		noDate?: boolean;
		html?: string;
		references?: string;
		noTo?: boolean;
	} = {},
): string {
	const lines: string[] = [
		`From: ${opts.from ?? "sender@example.com"}`,
	];
	if (!opts.noTo) {
		lines.push("To: recipient@example.com");
	}
	lines.push(`Subject: ${opts.subject ?? "Test"}`);
	lines.push(`Message-ID: ${opts.messageId ?? `<test-${Date.now()}@example.com>`}`);
	if (!opts.noDate) {
		lines.push("Date: Mon, 01 Jan 2024 12:00:00 +0000");
	}
	if (opts.references) {
		lines.push(`References: ${opts.references}`);
	}
	if (opts.html) {
		lines.push("MIME-Version: 1.0");
		lines.push("Content-Type: text/html; charset=utf-8");
		lines.push("");
		lines.push(opts.html);
	} else {
		lines.push("Content-Type: text/plain");
		lines.push("");
		lines.push("Hello, world!");
	}
	return Buffer.from(lines.join("\r\n")).toString("base64");
}

/** Build an R2 ListObjectsV2 XML response with the given keys */
function buildListXml(keys: string[]): string {
	const contents = keys
		.map(
			(k) =>
				`<Contents><Key>${k}</Key><Size>100</Size><StorageClass>STANDARD</StorageClass></Contents>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>my-bucket</Name>
  <Prefix>pending/</Prefix>
  <IsTruncated>false</IsTruncated>
  ${contents}
</ListBucketResult>`;
}

/** Create an R2 connector row in the DB and return its id */
function createR2Connector(
	db: Database.Database,
	opts: {
		accountId?: string;
		bucketName?: string;
		accessKeyId?: string;
		secretAccessKey?: string;
		prefix?: string;
		pollIntervalMs?: number;
	} = {},
): number {
	db.prepare(`
		INSERT INTO inbound_connectors (
			name, type,
			cf_r2_account_id, cf_r2_bucket_name,
			cf_r2_access_key_id, cf_r2_secret_access_key,
			cf_r2_prefix, cf_r2_poll_interval_ms
		) VALUES (?, 'cloudflare-r2', ?, ?, ?, ?, ?, ?)
	`).run(
		"R2 Test",
		opts.accountId ?? "testacc123",
		opts.bucketName ?? "test-bucket",
		opts.accessKeyId ?? "AKID",
		opts.secretAccessKey ?? "SECRET",
		opts.prefix ?? "pending/",
		opts.pollIntervalMs ?? null,
	);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Create an account linked to the given inbound connector */
function createAccount(db: Database.Database, connectorId: number): number {
	db.prepare(`
		INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
		VALUES ('SMTP', 'smtp', 'smtp.example.com', 587, 1, 'u', 'p')
	`).run();
	const outboundId = Number(
		(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
	);

	db.prepare(`
		INSERT INTO accounts (name, email, inbound_connector_id, outbound_connector_id,
			ingest_connector_type, send_connector_type)
		VALUES ('Test', 'test@example.com', ?, ?, 'cloudflare-r2', 'smtp')
	`).run(connectorId, outboundId);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

describe("parseListObjectsKeys", () => {
	test("extracts keys from ListObjectsV2 XML", () => {
		const xml = buildListXml(["pending/a.json", "pending/b.json"]);
		expect(parseListObjectsKeys(xml)).toEqual(["pending/a.json", "pending/b.json"]);
	});

	test("returns empty array for empty bucket response", () => {
		const xml = "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>";
		expect(parseListObjectsKeys(xml)).toEqual([]);
	});

	test("unescapes XML entities in keys", () => {
		const xml =
			"<ListBucketResult><Contents><Key>pending/hello&amp;world.json</Key></Contents></ListBucketResult>";
		expect(parseListObjectsKeys(xml)).toEqual(["pending/hello&world.json"]);
	});

	test("handles single key", () => {
		expect(parseListObjectsKeys(buildListXml(["pending/only.json"]))).toEqual([
			"pending/only.json",
		]);
	});
});

describe("R2Poller", () => {
	let db: Database.Database;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		db = createTestDb();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		db.close();
	});

	function makeFetchResponses(responses: { body: string; status?: number }[]) {
		let i = 0;
		fetchMock.mockImplementation(() => {
			const r = responses[i++] ?? { body: "", status: 200 };
			return Promise.resolve({
				ok: (r.status ?? 200) < 400,
				status: r.status ?? 200,
				statusText: r.status === 404 ? "Not Found" : "OK",
				text: () => Promise.resolve(r.body),
			});
		});
	}

	test("loadConnectorsFromDb only loads cloudflare-r2 type with full credentials", () => {
		// Create a fully-configured R2 connector
		createR2Connector(db);

		// Create a partially-configured R2 connector (missing secret)
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, cf_r2_account_id, cf_r2_bucket_name, cf_r2_access_key_id)
			VALUES ('Partial R2', 'cloudflare-r2', 'acc', 'bucket', 'key')
		`).run();

		// Create an IMAP connector (should be ignored)
		db.prepare(`
			INSERT INTO inbound_connectors (name, type, imap_host, imap_user, imap_pass)
			VALUES ('IMAP', 'imap', 'imap.example.com', 'user', 'pass')
		`).run();

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		// Only the fully-configured R2 connector should be loaded
		expect(poller.getStatus().size).toBe(1);
	});

	test("pollNow returns 0 when bucket is empty", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		makeFetchResponses([{ body: buildListXml([]) }]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		const stored = await poller.pollNow(connId);
		expect(stored).toBe(0);
		expect(fetchMock).toHaveBeenCalledOnce(); // only the list call
	});

	test("pollNow processes an object, stores message, then deletes from R2", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<unique-msg-1@test.com>" });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/msg1.json"]) }, // LIST
			{ body: payload }, // GET object
			{ body: "", status: 204 }, // DELETE
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		const stored = await poller.pollNow(connId);
		expect(stored).toBe(1);

		// Verify message is in DB
		const messages = db.prepare("SELECT id FROM messages").all();
		expect(messages).toHaveLength(1);

		// Verify DELETE was called
		const calls = fetchMock.mock.calls;
		const deletedCall = calls.find((c) => c[1]?.method === "DELETE");
		expect(deletedCall).toBeDefined();
		expect(deletedCall[0]).toContain("msg1.json");
	});

	test("does NOT delete from R2 if DB is closed (transient DB error)", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<transient-fail@example.com>" });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) }, // LIST
			{ body: payload }, // GET
			// No DELETE expected (DB write should fail)
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		// Close the DB to simulate a transient failure during write
		db.close();

		await expect(poller.pollNow(connId)).rejects.toThrow(/DB write failed/);

		// No DELETE call should have been made
		const deleteCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE");
		expect(deleteCalls).toHaveLength(0);

		// Re-open for cleanup in afterEach — create a dummy DB so close() doesn't error
		db = createTestDb();
	});

	test("deletes from R2 when object has invalid JSON (unrecoverable)", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		makeFetchResponses([
			{ body: buildListXml(["pending/bad-json.json"]) }, // LIST
			{ body: "this is not json at all" }, // GET
			{ body: "", status: 204 }, // DELETE
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		const stored = await poller.pollNow(connId);
		expect(stored).toBe(0); // No messages stored

		// DELETE should have been called (unrecoverable bad JSON)
		const deleteCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE");
		expect(deleteCalls).toHaveLength(1);
	});

	test("deduplicates: does not store same message-id twice", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const messageId = "<dedup-test@example.com>";
		const raw = buildRawEmail({ messageId });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		// First poll: stores the message
		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		await poller.pollNow(connId);

		expect(db.prepare("SELECT COUNT(*) as n FROM messages").get()).toMatchObject({ n: 1 });

		// Second poll: same message still in R2 (simulate crash before delete)
		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		await poller.pollNow(connId);

		// Should still only have 1 message (deduplication)
		expect(db.prepare("SELECT COUNT(*) as n FROM messages").get()).toMatchObject({ n: 1 });
	});

	test("addConnector / removeConnector at runtime", () => {
		const poller = new R2Poller(db);

		const connId = createR2Connector(db);
		const row = db
			.prepare(
				`SELECT id, cf_r2_account_id, cf_r2_bucket_name,
					cf_r2_access_key_id, cf_r2_secret_access_key,
					cf_r2_prefix, cf_r2_poll_interval_ms
				FROM inbound_connectors WHERE id = ?`,
			)
			.get(connId) as {
			id: number;
			cf_r2_account_id: string;
			cf_r2_bucket_name: string;
			cf_r2_access_key_id: string;
			cf_r2_secret_access_key: string;
			cf_r2_prefix: string;
			cf_r2_poll_interval_ms: number | null;
		};

		expect(poller.getStatus().size).toBe(0);
		poller.addConnector(row);
		expect(poller.getStatus().size).toBe(1);

		poller.removeConnector(connId);
		expect(poller.getStatus().size).toBe(0);
	});

	test("stop() resolves cleanly when no polls are running", async () => {
		const poller = new R2Poller(db);
		await expect(poller.stop()).resolves.toBeUndefined();
	});

	test("pollNow throws for unknown connector", async () => {
		const poller = new R2Poller(db);
		await expect(poller.pollNow(9999)).rejects.toThrow("not registered");
	});

	test("R2 list HTTP error causes poll to fail", async () => {
		const connId = createR2Connector(db);

		makeFetchResponses([{ body: "<Error><Code>InvalidAccessKeyId</Code></Error>", status: 403 }]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		await expect(poller.pollNow(connId)).rejects.toThrow(/R2 list failed.*403/);
	});

	test("onPollComplete callback is called with stored count", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<callback-test@example.com>" });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const completeCalls: { connectorId: number; stored: number }[] = [];
		const poller = new R2Poller(db, {
			onPollComplete: (connectorId, stored) => {
				completeCalls.push({ connectorId, stored });
			},
		});
		poller.loadConnectorsFromDb();

		await poller.pollNow(connId);

		expect(completeCalls).toHaveLength(1);
		expect(completeCalls[0]).toMatchObject({ connectorId: connId, stored: 1 });
	});

	test("addConnector replaces existing connector (does not register twice)", () => {
		const poller = new R2Poller(db);
		const connId = createR2Connector(db);
		const row = db
			.prepare(
				`SELECT id, cf_r2_account_id, cf_r2_bucket_name,
					cf_r2_access_key_id, cf_r2_secret_access_key,
					cf_r2_prefix, cf_r2_poll_interval_ms
				FROM inbound_connectors WHERE id = ?`,
			)
			.get(connId) as {
			id: number;
			cf_r2_account_id: string;
			cf_r2_bucket_name: string;
			cf_r2_access_key_id: string;
			cf_r2_secret_access_key: string;
			cf_r2_prefix: string;
			cf_r2_poll_interval_ms: number | null;
		};

		poller.addConnector(row);
		expect(poller.getStatus().size).toBe(1);
		// Adding the same connector again replaces it — size stays 1
		poller.addConnector(row);
		expect(poller.getStatus().size).toBe(1);
	});

	test("deletes from R2 when payload is valid JSON but missing raw field", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		// Valid JSON but no 'raw' field
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com" });

		makeFetchResponses([
			{ body: buildListXml(["pending/no-raw.json"]) }, // LIST
			{ body: payload }, // GET
			{ body: "", status: 204 }, // DELETE (unrecoverable malformed payload)
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(0);

		const deleteCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE");
		expect(deleteCalls).toHaveLength(1);
	});

	test("deleteObject logs error for non-404 failure without throwing", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<delete-500-fail@example.com>" });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) }, // LIST
			{ body: payload }, // GET
			{ body: "Internal Error", status: 500 }, // DELETE — server error
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		// Should not throw — deleteObject swallows non-fatal delete errors
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(1); // message was stored despite delete failure
	});

	test("stores two distinct messages for same account in one poll cycle", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw1 = buildRawEmail({ messageId: "<first-msg@example.com>", subject: "First" });
		const payload1 = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw: raw1, rawSize: 100 });
		const raw2 = buildRawEmail({ messageId: "<second-msg@example.com>", subject: "Second" });
		const payload2 = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw: raw2, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/msg1.json", "pending/msg2.json"]) }, // LIST
			{ body: payload1 }, // GET msg1
			{ body: "", status: 204 }, // DELETE msg1
			{ body: payload2 }, // GET msg2
			{ body: "", status: 204 }, // DELETE msg2
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(2);

		const messages = db.prepare("SELECT id FROM messages").all();
		expect(messages).toHaveLength(2);
	});

	test("onPollError callback is called when poll fails", async () => {
		const connId = createR2Connector(db);

		makeFetchResponses([{ body: "<Error>Forbidden</Error>", status: 403 }]);

		const errorCalls: { connectorId: number; error: Error }[] = [];
		const poller = new R2Poller(db, {
			onPollError: (connectorId, error) => {
				errorCalls.push({ connectorId, error });
			},
		});
		poller.loadConnectorsFromDb();

		await expect(poller.pollNow(connId)).rejects.toThrow();
		expect(errorCalls).toHaveLength(1);
		expect(errorCalls[0].connectorId).toBe(connId);
	});

	test("R2 GET failure on object download causes poll to fail", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		makeFetchResponses([
			{ body: buildListXml(["pending/msg.json"]) }, // LIST succeeds
			{ body: "Access Denied", status: 403 }, // GET fails
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();

		await expect(poller.pollNow(connId)).rejects.toThrow(/R2 get failed.*403/);
	});

	test("addConnector after start() triggers immediate poll", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		makeFetchResponses([{ body: buildListXml([]) }]); // empty bucket for immediate poll

		const completedIds: number[] = [];
		const poller = new R2Poller(db, {
			defaultPollIntervalMs: 100_000, // won't fire in test
			onPollComplete: (id) => completedIds.push(id),
		});
		poller.start(); // no connectors yet — just sets started=true

		const row = db
			.prepare(
				`SELECT id, cf_r2_account_id, cf_r2_bucket_name,
					cf_r2_access_key_id, cf_r2_secret_access_key,
					cf_r2_prefix, cf_r2_poll_interval_ms
				FROM inbound_connectors WHERE id = ?`,
			)
			.get(connId) as {
			id: number;
			cf_r2_account_id: string;
			cf_r2_bucket_name: string;
			cf_r2_access_key_id: string;
			cf_r2_secret_access_key: string;
			cf_r2_prefix: string;
			cf_r2_poll_interval_ms: number | null;
		};

		poller.addConnector(row); // this.started=true → calls startConnectorPoll
		expect(poller.getStatus().size).toBe(1);

		// Wait for the fire-and-forget poll triggered by startConnectorPoll
		await new Promise((r) => setTimeout(r, 50));
		expect(completedIds).toContain(connId);

		await poller.stop();
	});

	test("HTML email is stored with html_body populated", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({
			messageId: "<html-email@example.com>",
			html: "<h1>Hello</h1><p>World</p>",
		});
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 200 });

		makeFetchResponses([
			{ body: buildListXml(["pending/html.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		await poller.pollNow(connId);

		const msg = db.prepare("SELECT html_body FROM messages").get() as
			| { html_body: string | null }
			| undefined;
		expect(msg?.html_body).toBeTruthy();
	});

	test("email without Date header uses current timestamp", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<no-date@example.com>", noDate: true });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 50 });

		makeFetchResponses([
			{ body: buildListXml(["pending/no-date.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(1);
	});

	test("email with References header stores refs in DB", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({
			messageId: "<with-refs@example.com>",
			references: "<prior-msg@example.com>",
		});
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 100 });

		makeFetchResponses([
			{ body: buildListXml(["pending/refs.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(1);

		const msg = db.prepare('SELECT "references" FROM messages').get() as
			| { references: string | null }
			| undefined;
		expect(msg?.references).not.toBeNull();
	});

	test("email without To header stores null to_addresses", async () => {
		const connId = createR2Connector(db);
		createAccount(db, connId);

		const raw = buildRawEmail({ messageId: "<no-to@example.com>", noTo: true });
		const payload = JSON.stringify({ from: "a@b.com", to: "c@d.com", raw, rawSize: 50 });

		makeFetchResponses([
			{ body: buildListXml(["pending/no-to.json"]) },
			{ body: payload },
			{ body: "", status: 204 },
		]);

		const poller = new R2Poller(db);
		poller.loadConnectorsFromDb();
		const stored = await poller.pollNow(connId);
		expect(stored).toBe(1);

		const msg = db.prepare("SELECT to_addresses FROM messages").get() as
			| { to_addresses: string | null }
			| undefined;
		expect(msg?.to_addresses).toBeNull();
	});
});
