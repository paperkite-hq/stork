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
import { upsertAttachmentBlob } from "./attachment-storage.js";
import { compressText } from "./compression.js";

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
	/** 1 if the message was stored, 0 if it was a duplicate */
	stored: number;
}

const connectorLabelPalette = [
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
 * Parse and store an inbound email for the given connector.
 *
 * Returns stored=1 if stored, stored=0 if it was a duplicate.
 *
 * Throws if `payload.raw` cannot be parsed as a valid RFC 5322 message.
 */
export async function storeInboundEmail(
	db: Database.Database,
	connectorId: number,
	payload: InboundEmailPayload,
): Promise<StoreEmailResult> {
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

	// Deduplicate by message-id to handle at-least-once delivery
	if (parsed.messageId) {
		const existing = db
			.prepare("SELECT id FROM messages WHERE inbound_connector_id = ? AND message_id = ? LIMIT 1")
			.get(connectorId, parsed.messageId) as { id: number } | undefined;
		if (existing) return { stored: 0 };
	}

	const insertMessage = db.prepare(`
		INSERT INTO messages (
			inbound_connector_id, folder_id, uid, message_id, in_reply_to, "references",
			subject, from_address, from_name, to_addresses, cc_addresses,
			date, text_body, html_body, flags, size, has_attachments
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
	`);

	const ensureConnectorLabel = db.prepare(`
		INSERT INTO labels (name, source, color)
		VALUES (?, 'connector', ?)
		ON CONFLICT(name) DO UPDATE SET source = 'connector'
	`);
	const applyConnectorLabel = db.prepare(`
		INSERT OR IGNORE INTO message_labels (message_id, label_id)
		SELECT ?, l.id FROM labels l WHERE l.name = ? AND l.source = 'connector'
	`);
	const applyInboxLabel = db.prepare(`
		INSERT OR IGNORE INTO message_labels (message_id, label_id)
		SELECT ?, l.id FROM labels l WHERE LOWER(l.name) = 'inbox'
	`);

	const folderId = findOrCreateInbox(db, connectorId);
	const uid = nextInboxUid(db, folderId);

	const result = insertMessage.run(
		connectorId,
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
		typeof parsed.html === "string" ? compressText(parsed.html) : null,
		payload.rawSize ?? 0,
		(parsed.attachments?.length ?? 0) > 0 ? 1 : 0,
	);
	const messageRowId = Number(result.lastInsertRowid);

	// Extract and store attachment blobs
	if (result.changes > 0 && parsed.attachments.length > 0) {
		const insertAttachment = db.prepare(`
			INSERT INTO attachments (message_id, filename, content_type, size, content_id, content_hash)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		for (const att of parsed.attachments) {
			const content = att.content ?? null;
			if (!content) continue; // Can't hash without data
			const contentHash = upsertAttachmentBlob(db, content);
			insertAttachment.run(
				messageRowId,
				att.filename ?? null,
				typeof att.contentType === "string" ? att.contentType : "application/octet-stream",
				typeof att.size === "number" ? att.size : content.length,
				att.contentId ?? null,
				contentHash,
			);
		}
	}

	// Auto-label with connector name and Inbox
	const connectorRow = db
		.prepare("SELECT name FROM inbound_connectors WHERE id = ?")
		.get(connectorId) as { name: string } | undefined;
	if (connectorRow) {
		const color = connectorLabelPalette[(connectorId - 1) % connectorLabelPalette.length];
		ensureConnectorLabel.run(connectorRow.name, color);
		applyConnectorLabel.run(messageRowId, connectorRow.name);
	}
	applyInboxLabel.run(messageRowId);

	db.prepare(
		"UPDATE folders SET unread_count = unread_count + 1, message_count = message_count + 1 WHERE id = ?",
	).run(folderId);

	return { stored: 1 };
}

/** Find or create the INBOX folder for an inbound connector, returning its ID. */
function findOrCreateInbox(db: Database.Database, inboundConnectorId: number): number {
	const existing = db
		.prepare(
			`SELECT id FROM folders
			WHERE inbound_connector_id = ? AND (path = 'INBOX' OR special_use = '\\\\Inbox' OR name = 'Inbox')
			LIMIT 1`,
		)
		.get(inboundConnectorId) as { id: number } | undefined;

	if (existing) return existing.id;

	const result = db
		.prepare(
			`INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, special_use, message_count, unread_count)
			VALUES (?, 'INBOX', 'Inbox', '/', '[]', '\\Inbox', 0, 0)`,
		)
		.run(inboundConnectorId);
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
