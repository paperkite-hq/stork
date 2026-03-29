import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { type SendConnectorType, createSendConnector } from "../../connectors/registry.js";
import { SmtpSendConnector } from "../../connectors/smtp.js";
import type { OutgoingAttachment } from "../../connectors/types.js";

interface AccountSendRow {
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

	/** POST /send — send an email via the account's configured SMTP server */
	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		const {
			account_id,
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
			account_id: number;
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

		if (!account_id) return c.json({ error: "account_id is required" }, 400);
		if (!Array.isArray(to) || to.length === 0)
			return c.json({ error: "to must be a non-empty array of email addresses" }, 400);
		if (!subject && !text_body && !html_body)
			return c.json({ error: "At least one of subject, text_body, or html_body is required" }, 400);

		const account = db
			.prepare(
				`SELECT a.id, a.email, a.name,
					oc.type AS send_type,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user, oc.smtp_pass,
					oc.ses_region, oc.ses_access_key_id, oc.ses_secret_access_key
				FROM accounts a
				LEFT JOIN outbound_connectors oc ON oc.id = a.outbound_connector_id
				WHERE a.id = ?`,
			)
			.get(account_id) as AccountSendRow | undefined;

		if (!account) return c.json({ error: "Account not found" }, 404);

		const sendType = account.send_type ?? "smtp";
		let connector: import("../../connectors/types.js").SendConnector;
		try {
			if (sendType === "ses") {
				if (!account.ses_region) {
					return c.json({ error: "SES is not configured for this account" }, 400);
				}
				connector = createSendConnector({
					type: "ses",
					ses: {
						region: account.ses_region,
						credentials:
							account.ses_access_key_id && account.ses_secret_access_key
								? {
										accessKeyId: account.ses_access_key_id,
										secretAccessKey: account.ses_secret_access_key,
									}
								: undefined,
					},
				});
			} else {
				if (!account.smtp_host || !account.smtp_user || !account.smtp_pass) {
					return c.json({ error: "SMTP is not configured for this account" }, 400);
				}
				connector = createSendConnector({
					type: "smtp",
					smtp: {
						host: account.smtp_host,
						port: account.smtp_port ?? 587,
						secure: (account.smtp_tls ?? 1) === 1,
						auth: { user: account.smtp_user, pass: account.smtp_pass },
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

		const fromAddress = account.name ? `${account.name} <${account.email}>` : account.email;

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
			const sentFolderId = findOrCreateSentFolder(db, account_id);
			const nextUid = getNextLocalUid(db, sentFolderId);

			const msgId = db
				.prepare(`
					INSERT INTO messages (
						account_id, folder_id, uid, message_id, subject,
						from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
						date, text_body, html_body, flags, size, has_attachments,
						in_reply_to, "references"
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, '\\Seen', ?, ?, ?, ?)
				`)
				.run(
					account_id,
					sentFolderId,
					nextUid,
					result.messageId,
					subject ?? "",
					account.email,
					account.name ?? null,
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
					"INSERT INTO attachments (message_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)",
				);
				for (const att of attachments) {
					const buf = Buffer.from(att.content_base64, "base64");
					insertAttachment.run(
						Number(msgId.lastInsertRowid),
						att.filename,
						att.content_type,
						buf.length,
						buf,
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

/** Find or create a "Sent" folder for the account */
function findOrCreateSentFolder(db: Database.Database, accountId: number): number {
	// Look for existing Sent folder (by special_use or name)
	const existing = db
		.prepare(
			`SELECT id FROM folders
			 WHERE account_id = ? AND (special_use = '\\\\Sent' OR path IN ('Sent', '[Gmail]/Sent Mail', 'INBOX.Sent'))
			 LIMIT 1`,
		)
		.get(accountId) as FolderRow | undefined;

	if (existing) return existing.id;

	// Create a local Sent folder
	const result = db
		.prepare(
			`INSERT INTO folders (account_id, path, name, delimiter, flags, special_use, message_count, unread_count)
			 VALUES (?, 'Sent', 'Sent', '/', '[]', '\\Sent', 0, 0)`,
		)
		.run(accountId);
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
