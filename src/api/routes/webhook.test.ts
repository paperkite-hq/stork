import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { createTestContext, createTestDb } from "../../test-helpers/test-db.js";

/**
 * Build a minimal RFC 5322 message and return it as a base64 string.
 * mailparser accepts bare-minimum messages, so this is enough for testing.
 */
function buildRawEmail(opts: {
	from?: string;
	to?: string;
	subject?: string;
	body?: string;
	messageId?: string;
}): string {
	const lines = [
		`From: ${opts.from ?? "sender@example.com"}`,
		`To: ${opts.to ?? "recipient@example.com"}`,
		`Subject: ${opts.subject ?? "Test subject"}`,
		`Message-ID: ${opts.messageId ?? "<test-id@example.com>"}`,
		"Date: Thu, 01 Jan 2026 12:00:00 +0000",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		opts.body ?? "Hello, world!",
	];
	return Buffer.from(lines.join("\r\n")).toString("base64");
}

describe("Cloudflare Email Webhook", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../sync/sync-scheduler.js").SyncScheduler;

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
	});

	afterEach(async () => {
		await scheduler.stop();
		db.close();
	});

	function createCloudflareConnector(name = "CF Inbound", secret = "test-secret-abc") {
		db.prepare(
			`INSERT INTO inbound_connectors (name, type, cf_email_webhook_secret)
			VALUES (?, 'cloudflare-email', ?)`,
		).run(name, secret);
		return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	}

	function createOutboundConnector(name = "SMTP Out") {
		db.prepare(
			`INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
			VALUES (?, 'smtp', 'smtp.example.com', 587, 1, 'user', 'pass')`,
		).run(name);
		return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	}

	function createAccount(
		name: string,
		email: string,
		inboundConnectorId: number,
		outboundConnectorId: number,
	) {
		db.prepare(
			`INSERT INTO accounts (name, email, inbound_connector_id, outbound_connector_id,
				ingest_connector_type, send_connector_type)
			VALUES (?, ?, ?, ?, 'cloudflare-email', 'smtp')`,
		).run(name, email, inboundConnectorId, outboundConnectorId);
		return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
	}

	function webhookPost(connectorId: number, payload: unknown, token = "test-secret-abc") {
		return app.request(`/api/webhook/cloudflare-email/${connectorId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(payload),
		});
	}

	test("returns 404 for unknown connector", async () => {
		const res = await webhookPost(9999, {
			from: "a@b.com",
			to: "c@d.com",
			raw: buildRawEmail({}),
			rawSize: 100,
		});
		expect(res.status).toBe(404);
	});

	test("returns 404 if connector type is not cloudflare-email", async () => {
		// Create an IMAP connector
		db.prepare(
			`INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			VALUES ('IMAP', 'imap', 'imap.example.com', 993, 1, 'u', 'p')`,
		).run();
		const imapId = Number(
			(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
		);

		const res = await webhookPost(imapId, {
			from: "a@b.com",
			to: "c@d.com",
			raw: buildRawEmail({}),
			rawSize: 100,
		});
		expect(res.status).toBe(404);
	});

	test("returns 401 with wrong secret", async () => {
		const connectorId = createCloudflareConnector();

		const res = await webhookPost(
			connectorId,
			{ from: "a@b.com", to: "c@d.com", raw: buildRawEmail({}), rawSize: 100 },
			"wrong-secret",
		);
		expect(res.status).toBe(401);
	});

	test("returns 401 with missing Authorization header", async () => {
		const connectorId = createCloudflareConnector();

		const res = await app.request(`/api/webhook/cloudflare-email/${connectorId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ from: "a@b.com", to: "c@d.com", raw: buildRawEmail({}), rawSize: 0 }),
		});
		expect(res.status).toBe(401);
	});

	test("stores message for linked account", async () => {
		const connectorId = createCloudflareConnector();
		const outboundId = createOutboundConnector();
		const accountId = createAccount("Alice", "alice@example.com", connectorId, outboundId);

		const raw = buildRawEmail({
			from: "sender@example.com",
			to: "alice@example.com",
			subject: "Hello Alice",
			body: "This is a test message.",
			messageId: "<unique-123@example.com>",
		});

		const res = await webhookPost(connectorId, {
			from: "sender@example.com",
			to: "alice@example.com",
			raw,
			rawSize: raw.length,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; stored: number };
		expect(body.ok).toBe(true);
		expect(body.stored).toBe(1);

		// Verify message was stored
		const msg = db
			.prepare("SELECT subject, from_address, account_id FROM messages WHERE account_id = ?")
			.get(accountId) as { subject: string; from_address: string; account_id: number } | undefined;
		expect(msg).toBeDefined();
		expect(msg?.subject).toBe("Hello Alice");
		expect(msg?.from_address).toBe("sender@example.com");

		// Verify INBOX folder was created
		const folder = db
			.prepare("SELECT path, unread_count, message_count FROM folders WHERE account_id = ?")
			.get(accountId) as { path: string; unread_count: number; message_count: number } | undefined;
		expect(folder).toBeDefined();
		expect(folder?.path).toBe("INBOX");
		expect(folder?.unread_count).toBe(1);
		expect(folder?.message_count).toBe(1);
	});

	test("stores message for multiple accounts sharing the same connector", async () => {
		const connectorId = createCloudflareConnector();
		const outboundId = createOutboundConnector();
		const account1 = createAccount("Alice", "alice@example.com", connectorId, outboundId);
		const account2 = createAccount("Bob", "bob@example.com", connectorId, outboundId);

		const raw = buildRawEmail({ subject: "Shared connector test" });
		const res = await webhookPost(connectorId, {
			from: "x@y.com",
			to: "z@y.com",
			raw,
			rawSize: raw.length,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; stored: number };
		expect(body.stored).toBe(2);

		const msgs = db
			.prepare("SELECT account_id FROM messages WHERE subject = 'Shared connector test'")
			.all() as { account_id: number }[];
		const accountIds = msgs.map((m) => m.account_id);
		expect(accountIds).toContain(account1);
		expect(accountIds).toContain(account2);
	});

	test("deduplicates by message-id (INSERT OR IGNORE)", async () => {
		const connectorId = createCloudflareConnector();
		const outboundId = createOutboundConnector();
		createAccount("Alice", "alice@example.com", connectorId, outboundId);

		const raw = buildRawEmail({ messageId: "<dedup-test@example.com>" });
		const payload = { from: "a@b.com", to: "c@d.com", raw, rawSize: raw.length };

		const res1 = await webhookPost(connectorId, payload);
		expect(res1.status).toBe(200);
		const b1 = (await res1.json()) as { stored: number };
		expect(b1.stored).toBe(1);

		// Second POST with the same message
		const res2 = await webhookPost(connectorId, payload);
		expect(res2.status).toBe(200);
		const b2 = (await res2.json()) as { stored: number };
		// INSERT OR IGNORE: no second row, stored = 0
		expect(b2.stored).toBe(0);

		const count = (db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number }).n;
		expect(count).toBe(1);
	});

	test("returns ok with stored=0 when no accounts reference the connector", async () => {
		const connectorId = createCloudflareConnector();
		// No account linked to this connector

		const raw = buildRawEmail({});
		const res = await webhookPost(connectorId, {
			from: "a@b.com",
			to: "c@d.com",
			raw,
			rawSize: raw.length,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; stored: number };
		expect(body.ok).toBe(true);
		expect(body.stored).toBe(0);
	});

	test("returns 400 for invalid connector ID", async () => {
		const res = await webhookPost(0, {});
		expect(res.status).toBe(400);
	});

	test("returns 400 for missing raw field", async () => {
		const connectorId = createCloudflareConnector();
		const res = await webhookPost(connectorId, { from: "a@b.com", to: "c@d.com" });
		expect(res.status).toBe(400);
	});
});
