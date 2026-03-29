/**
 * Shared helper for storing inbound emails received via push (webhook) or
 * pull (R2 queue poll) connectors.
 *
 * Handles identity lookup, message-ID deduplication, DB insertion, auto-labeling,
 * and folder unread-count maintenance. Both the webhook route and the R2 poller
 * delegate here so the storage logic stays in one place.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import { simpleParser } from "mailparser";

export interface InboundEmailPayload {
	/** Envelope sender (fallback if From header is absent) */
	from: string;
	/** Envelope recipient */
	to: string;
	/** Raw RFC 5322 message, base64-encoded */
	raw: string;
	/** Size of the raw message in bytes */
	rawSize: number;
}

export interface StoreEmailResult {
	/** Number of identities the message was stored for */
	stored: number;
}

const identityLabelPalette = [
	"#3b82f6",
	"#10b981",
	"#f59e0b",
	"#8b5cf6",
	"#ef4444",
	"#06b6d4",
	"#ec4899",
	"#84cc16",
];

/**
 * Parse and store an inbound email for all identities linked to the given connector.
 *
 * Returns the number of identities the message was stored for. Returns 0 if the
 * connector has no linked identities or all deliveries were duplicates.
 *
 * Throws if `payload.raw` cannot be parsed as a valid RFC 5322 message.
 */
export async function storeInboundEmail(
	db: Database.Database,
	connectorId: number,
	payload: InboundEmailPayload,
): Promise<StoreEmailResult> {
	// Find all identities linked to this connector
	const identities = db
		.prepare("SELECT id FROM identities WHERE inbound_connector_id = ?")
		.all(connectorId) as { id: number }[];

	if (identities.length === 0) {
		return { stored: 0 };
	}

	// Parse the raw RFC 5322 message
	const rawBuffer = Buffer.from(payload.raw, "base64");
	const parsed = await simpleParser(rawBuffer);

	// Extract address fields
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
		? db.prepare("SELECT id FROM messages WHERE identity_id = ? AND message_id = ? LIMIT 1")
		: null;

	const insertMessage = db.prepare(`
		INSERT INTO messages (
			identity_id, folder_id, uid, message_id, in_reply_to, "references",
			subject, from_address, from_name, to_addresses, cc_addresses,
			date, text_body, html_body, flags, size, has_attachments
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
	`);

	const ensureIdentityLabel = db.prepare(`
		INSERT INTO labels (name, source, color)
		VALUES (?, 'identity', ?)
		ON CONFLICT(name) DO UPDATE SET source = 'identity'
	`);
	const applyIdentityLabel = db.prepare(`
		INSERT OR IGNORE INTO message_labels (message_id, label_id)
		SELECT ?, l.id FROM labels l WHERE l.name = ? AND l.source = 'identity'
	`);
	const applyInboxLabel = db.prepare(`
		INSERT OR IGNORE INTO message_labels (message_id, label_id)
		SELECT ?, l.id FROM labels l WHERE LOWER(l.name) = 'inbox'
	`);

	let stored = 0;

	for (const identity of identities) {
		// Deduplicate by message-id to handle at-least-once delivery
		if (checkDuplicate) {
			const existing = checkDuplicate.get(identity.id, parsed.messageId) as
				| { id: number }
				| undefined;
			if (existing) continue;
		}

		const folderId = findOrCreateInbox(db, identity.id);
		const uid = nextInboxUid(db, folderId);

		const result = insertMessage.run(
			identity.id,
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
		const messageRowId = Number(result.lastInsertRowid);

		// Auto-label with identity name and Inbox
		const identityRow = db.prepare("SELECT name FROM identities WHERE id = ?").get(identity.id) as
			| { name: string }
			| undefined;
		if (identityRow) {
			const color = identityLabelPalette[(identity.id - 1) % identityLabelPalette.length];
			ensureIdentityLabel.run(identityRow.name, color);
			applyIdentityLabel.run(messageRowId, identityRow.name);
		}
		applyInboxLabel.run(messageRowId);

		stored++;
		db.prepare(
			"UPDATE folders SET unread_count = unread_count + 1, message_count = message_count + 1 WHERE id = ?",
		).run(folderId);
	}

	return { stored };
}

/** Find or create the INBOX folder for an identity, returning its ID. */
function findOrCreateInbox(db: Database.Database, identityId: number): number {
	const existing = db
		.prepare(
			`SELECT id FROM folders
			WHERE identity_id = ? AND (path = 'INBOX' OR special_use = '\\\\Inbox' OR name = 'Inbox')
			LIMIT 1`,
		)
		.get(identityId) as { id: number } | undefined;

	if (existing) return existing.id;

	const result = db
		.prepare(
			`INSERT INTO folders (identity_id, path, name, delimiter, flags, special_use, message_count, unread_count)
			VALUES (?, 'INBOX', 'Inbox', '/', '[]', '\\Inbox', 0, 0)`,
		)
		.run(identityId);
	return Number(result.lastInsertRowid);
}

/** Get the next available positive UID for a folder. */
function nextInboxUid(db: Database.Database, folderId: number): number {
	const row = db
		.prepare(
			"SELECT COALESCE(MAX(uid), 0) + 1 AS next_uid FROM messages WHERE folder_id = ? AND uid > 0",
		)
		.get(folderId) as { next_uid: number };
	return row.next_uid;
}
