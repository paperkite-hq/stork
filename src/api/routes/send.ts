import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { type SendConnectorType, createSendConnector } from "../../connectors/registry.js";
import { SmtpSendConnector } from "../../connectors/smtp.js";
import type { OutgoingAttachment } from "../../connectors/types.js";
import { upsertAttachmentBlob } from "../../storage/attachment-storage.js";

interface IdentitySendRow {
	id: number;
	email: string;
	name: string;
	send_type: SendConnectorType | null;
	smtp_host: string | null;
	smtp_port: number | null;
	smtp_tls: number | null;
	smtp_user: string | null;
	smtp_pass: string | null;
	ses_region: string | null;
	ses_access_key_id: string | null;
	ses_secret_access_key: string | null;
}

interface FolderRow {
	id: number;
}

export function sendRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	/** POST /send — send an email via the identity's configured send connector */
	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		const {
			identity_id,
			to,
			cc,
			bcc,
			subject,
			text_body,
			html_body,
			in_reply_to,
			references,
			attachments,
		} = body as {
			identity_id: number;
			to: string[];
			cc?: string[];
			bcc?: string[];
			subject: string;
			text_body?: string;
			html_body?: string;
			in_reply_to?: string;
			references?: string[];
			attachments?: { filename: string; content_type: string; content_base64: string }[];
		};

		if (!identity_id) return c.json({ error: "identity_id is required" }, 400);
		if (!Array.isArray(to) || to.length === 0)
			return c.json({ error: "to must be a non-empty array of email addresses" }, 400);
		if (!subject && !text_body && !html_body)
			return c.json({ error: "At least one of subject, text_body, or html_body is required" }, 400);

		const identity = db
			.prepare(
				`SELECT i.id, i.email, i.name,
					oc.type AS send_type,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user, oc.smtp_pass,
					oc.ses_region, oc.ses_access_key_id, oc.ses_secret_access_key
				FROM identities i
				LEFT JOIN outbound_connectors oc ON oc.id = i.outbound_connector_id
				WHERE i.id = ?`,
			)
			.get(identity_id) as IdentitySendRow | undefined;

		if (!identity) return c.json({ error: "Identity not found" }, 404);

		const sendType = identity.send_type ?? "smtp";
		let connector: import("../../connectors/types.js").SendConnector;
		try {
			if (sendType === "ses") {
				if (!identity.ses_region) {
					return c.json({ error: "SES is not configured for this identity" }, 400);
				}
				connector = createSendConnector({
					type: "ses",
					ses: {
						region: identity.ses_region,
						credentials:
							identity.ses_access_key_id && identity.ses_secret_access_key
								? {
										accessKeyId: identity.ses_access_key_id,
										secretAccessKey: identity.ses_secret_access_key,
									}
								: undefined,
					},
				});
			} else {
				if (!identity.smtp_host || !identity.smtp_user || !identity.smtp_pass) {
					return c.json({ error: "SMTP is not configured for this identity" }, 400);
				}
				connector = createSendConnector({
					type: "smtp",
					smtp: {
						host: identity.smtp_host,
						port: identity.smtp_port ?? 587,
						secure: (identity.smtp_tls ?? 1) === 1,
						auth: { user: identity.smtp_user, pass: identity.smtp_pass },
					},
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Failed to create send connector: ${message}` }, 500);
		}

		const outgoingAttachments: OutgoingAttachment[] | undefined = attachments?.map((a) => ({
			filename: a.filename,
			contentType: a.content_type,
			content: Buffer.from(a.content_base64, "base64"),
		}));

		const fromAddress = identity.name ? `${identity.name} <${identity.email}>` : identity.email;

		try {
			const result = await connector.send({
				from: fromAddress,
				to,
				cc,
				bcc,
				subject: subject ?? "",
				textBody: text_body,
				htmlBody: html_body,
				inReplyTo: in_reply_to,
				references,
				attachments: outgoingAttachments,
			});

			// Save sent message to local storage
			const sentFolderId = findOrCreateSentFolder(db, identity_id);
			const nextUid = getNextLocalUid(db, sentFolderId);

			const msgId = db
				.prepare(`
					INSERT INTO messages (
						identity_id, folder_id, uid, message_id, subject,
						from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
						date, text_body, html_body, flags, size, has_attachments,
						in_reply_to, "references"
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, '\\Seen', ?, ?, ?, ?)
				`)
				.run(
					identity_id,
					sentFolderId,
					nextUid,
					result.messageId,
					subject ?? "",
					identity.email,
					identity.name ?? null,
					JSON.stringify(to),
					cc ? JSON.stringify(cc) : null,
					bcc ? JSON.stringify(bcc) : null,
					text_body ?? null,
					html_body ?? null,
					(text_body ?? "").length + (html_body ?? "").length,
					attachments ? 1 : 0,
					in_reply_to ?? null,
					references ? JSON.stringify(references) : null,
				);

			// Save attachments if present
			if (attachments && attachments.length > 0) {
				const insertAttachment = db.prepare(
					"INSERT INTO attachments (message_id, filename, content_type, size, content_hash) VALUES (?, ?, ?, ?, ?)",
				);
				for (const att of attachments) {
					const buf = Buffer.from(att.content_base64, "base64");
					const contentHash = upsertAttachmentBlob(db, buf);
					insertAttachment.run(
						Number(msgId.lastInsertRowid),
						att.filename,
						att.content_type,
						buf.length,
						contentHash,
					);
				}
			}

			// Update folder counts
			db.prepare(
				"UPDATE folders SET message_count = (SELECT COUNT(*) FROM messages WHERE folder_id = ?) WHERE id = ?",
			).run(sentFolderId, sentFolderId);

			return c.json({
				ok: true,
				message_id: result.messageId,
				accepted: result.accepted,
				rejected: result.rejected,
				stored_message_id: Number(msgId.lastInsertRowid),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Failed to send: ${message}` }, 500);
		}
	});

	/** POST /send/test-smtp — verify SMTP connection with provided credentials */
	api.post("/test-smtp", async (c) => {
		const body = await c.req.json();
		if (!body.smtp_host || !body.smtp_user || !body.smtp_pass) {
			return c.json({ error: "Missing required fields: smtp_host, smtp_user, smtp_pass" }, 400);
		}

		const connector = new SmtpSendConnector({
			host: body.smtp_host,
			port: body.smtp_port ?? 587,
			secure: (body.smtp_tls ?? 1) === 1,
			auth: { user: body.smtp_user, pass: body.smtp_pass },
		});

		const ok = await connector.verify();
		return c.json({ ok, error: ok ? undefined : "SMTP connection verification failed" });
	});

	return api;
}

/** Find or create a "Sent" folder for the identity */
function findOrCreateSentFolder(db: Database.Database, identityId: number): number {
	// Look for existing Sent folder (by special_use or name)
	const existing = db
		.prepare(
			`SELECT id FROM folders
			 WHERE identity_id = ? AND (special_use = '\\\\Sent' OR path IN ('Sent', '[Gmail]/Sent Mail', 'INBOX.Sent'))
			 LIMIT 1`,
		)
		.get(identityId) as FolderRow | undefined;

	if (existing) return existing.id;

	// Create a local Sent folder
	const result = db
		.prepare(
			`INSERT INTO folders (identity_id, path, name, delimiter, flags, special_use, message_count, unread_count)
			 VALUES (?, 'Sent', 'Sent', '/', '[]', '\\Sent', 0, 0)`,
		)
		.run(identityId);
	return Number(result.lastInsertRowid);
}

/** Get the next UID for locally-stored messages (negative to avoid IMAP UID conflicts) */
function getNextLocalUid(db: Database.Database, folderId: number): number {
	const row = db
		.prepare("SELECT MIN(uid) as min_uid FROM messages WHERE folder_id = ?")
		.get(folderId) as { min_uid: number | null };
	// Use negative UIDs for locally-stored outgoing messages to avoid
	// conflicts with IMAP UIDs (which are always positive)
	const minUid = row.min_uid ?? 0;
	return minUid < 0 ? minUid - 1 : -1;
}
