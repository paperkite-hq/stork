import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { simpleParser } from "mailparser";
import type { ContainerContext } from "../../crypto/lifecycle.js";

interface InboundConnectorRow {
	id: number;
	cf_email_webhook_secret: string | null;
}

interface AccountRow {
	id: number;
}

interface FolderRow {
	id: number;
}

/** Expected payload from a Cloudflare Email Worker */
interface CloudflareEmailPayload {
	from: string;
	to: string;
	raw: string;
	rawSize: number;
}

/**
 * Webhook routes for push-based inbound connectors.
 *
 * These routes are mounted BEFORE the lock middleware so they can reject
 * requests with a proper 503 when the container is locked rather than a
 * generic 423. Messages are only stored when the container is unlocked.
 */
export function webhookRoutes(context: ContainerContext): Hono {
	const api = new Hono();

	/**
	 * POST /api/webhook/cloudflare-email/:connectorId
	 *
	 * Receives an email from a Cloudflare Email Worker and stores it for all
	 * accounts linked to the given inbound connector.
	 *
	 * Authentication: Bearer token in Authorization header, matched against
	 * cf_email_webhook_secret stored in inbound_connectors.
	 *
	 * Expected body (JSON):
	 *   { from: string, to: string, raw: string (base64), rawSize: number }
	 */
	api.post("/cloudflare-email/:connectorId", async (c) => {
		if (context.state !== "unlocked" || !context.db) {
			return c.json({ error: "Service unavailable: container is locked" }, 503);
		}

		const db = context.db;

		// Parse connector ID
		const connectorIdStr = c.req.param("connectorId");
		const connectorId = Number(connectorIdStr);
		if (!Number.isInteger(connectorId) || connectorId <= 0) {
			return c.json({ error: "Invalid connector ID" }, 400);
		}

		// Look up the connector
		const connector = db
			.prepare(
				"SELECT id, cf_email_webhook_secret FROM inbound_connectors WHERE id = ? AND type = 'cloudflare-email'",
			)
			.get(connectorId) as InboundConnectorRow | undefined;

		if (!connector) {
			return c.json({ error: "Connector not found" }, 404);
		}

		if (!connector.cf_email_webhook_secret) {
			return c.json({ error: "Connector is not fully configured" }, 400);
		}

		// Validate Authorization header
		const authHeader = c.req.header("Authorization") ?? "";
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
		if (!timingSafeEqual(token, connector.cf_email_webhook_secret)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Parse body
		let payload: CloudflareEmailPayload;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		if (!payload.raw || typeof payload.raw !== "string") {
			return c.json({ error: "Missing required field: raw" }, 400);
		}

		// Parse the raw RFC 5322 message
		let parsed: Awaited<ReturnType<typeof simpleParser>>;
		try {
			const rawBuffer = Buffer.from(payload.raw, "base64");
			parsed = await simpleParser(rawBuffer);
		} catch (err) {
			return c.json(
				{
					error: `Failed to parse email: ${err instanceof Error ? err.message : String(err)}`,
				},
				400,
			);
		}

		// Find all accounts linked to this connector
		const accounts = db
			.prepare("SELECT id FROM accounts WHERE inbound_connector_id = ?")
			.all(connectorId) as AccountRow[];

		if (accounts.length === 0) {
			// Connector exists but no accounts reference it — accept and discard
			return c.json({ ok: true, stored: 0 });
		}

		// Extract parsed fields
		const fromAddr = parsed.from?.value?.[0];
		const toAddrs = parsed.to
			? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((a) =>
					a.value.map((v) => v.address).filter(Boolean),
				)
			: [];
		const ccAddrs = parsed.cc
			? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((a) =>
					a.value.map((v) => v.address).filter(Boolean),
				)
			: [];
		const refs = parsed.references
			? Array.isArray(parsed.references)
				? parsed.references
				: [parsed.references]
			: null;

		const checkDuplicate = parsed.messageId
			? db.prepare("SELECT id FROM messages WHERE account_id = ? AND message_id = ? LIMIT 1")
			: null;

		const insertMessage = db.prepare(`
			INSERT INTO messages (
				account_id, folder_id, uid, message_id, in_reply_to, "references",
				subject, from_address, from_name, to_addresses, cc_addresses,
				date, text_body, html_body, flags, size, has_attachments
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
		`);

		let stored = 0;

		for (const account of accounts) {
			// Deduplicate by message-id to handle at-least-once delivery from Cloudflare
			if (checkDuplicate) {
				const existing = checkDuplicate.get(account.id, parsed.messageId) as
					| { id: number }
					| undefined;
				if (existing) continue;
			}

			const folderId = findOrCreateInbox(db, account.id);
			const uid = nextInboxUid(db, folderId);

			insertMessage.run(
				account.id,
				folderId,
				uid,
				parsed.messageId ?? null,
				parsed.inReplyTo ?? null,
				refs ? JSON.stringify(refs) : null,
				parsed.subject ?? null,
				fromAddr?.address ?? payload.from ?? null,
				fromAddr?.name ?? null,
				toAddrs.length > 0 ? JSON.stringify(toAddrs) : null,
				ccAddrs.length > 0 ? JSON.stringify(ccAddrs) : null,
				parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
				parsed.text ?? null,
				typeof parsed.html === "string" ? parsed.html : null,
				payload.rawSize ?? 0,
				(parsed.attachments?.length ?? 0) > 0 ? 1 : 0,
			);
			stored++;
			// Update folder unread count
			db.prepare(
				"UPDATE folders SET unread_count = unread_count + 1, message_count = message_count + 1 WHERE id = ?",
			).run(folderId);
		}

		return c.json({ ok: true, stored });
	});

	return api;
}

/** Find or create the INBOX folder for an account, returning its ID */
function findOrCreateInbox(db: Database.Database, accountId: number): number {
	const existing = db
		.prepare(
			`SELECT id FROM folders
			WHERE account_id = ? AND (path = 'INBOX' OR special_use = '\\\\Inbox' OR name = 'Inbox')
			LIMIT 1`,
		)
		.get(accountId) as FolderRow | undefined;

	if (existing) return existing.id;

	const result = db
		.prepare(
			`INSERT INTO folders (account_id, path, name, delimiter, flags, special_use, message_count, unread_count)
			VALUES (?, 'INBOX', 'Inbox', '/', '[]', '\\Inbox', 0, 0)`,
		)
		.run(accountId);
	return Number(result.lastInsertRowid);
}

/** Get the next available positive UID for a folder */
function nextInboxUid(db: Database.Database, folderId: number): number {
	const row = db
		.prepare(
			"SELECT COALESCE(MAX(uid), 0) + 1 AS next_uid FROM messages WHERE folder_id = ? AND uid > 0",
		)
		.get(folderId) as { next_uid: number };
	return row.next_uid;
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
