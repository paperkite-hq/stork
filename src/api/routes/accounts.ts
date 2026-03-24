import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import {
	type IngestConnectorType,
	type SendConnectorType,
	createIngestConnector,
	createSendConnector,
} from "../../connectors/registry.js";
import type { SyncScheduler } from "../../sync/sync-scheduler.js";
import { parseIntParam, parsePagination } from "../validation.js";

const VALID_INGEST_TYPES: IngestConnectorType[] = ["imap", "cloudflare-email"];
const VALID_SEND_TYPES: SendConnectorType[] = ["smtp", "ses"];

export function accountRoutes(
	getDb: () => Database.Database,
	getScheduler: () => SyncScheduler,
): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const accounts = getDb()
			.prepare(
				`SELECT id, name, email, ingest_connector_type, send_connector_type,
					imap_host, smtp_host, default_view, created_at
				FROM accounts ORDER BY name`,
			)
			.all();
		return c.json(accounts);
	});

	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		const ingestType: IngestConnectorType = body.ingest_connector_type ?? "imap";
		const sendType: SendConnectorType = body.send_connector_type ?? "smtp";

		if (!VALID_INGEST_TYPES.includes(ingestType)) {
			return c.json({ error: `Invalid ingest_connector_type: ${ingestType}` }, 400);
		}
		if (!VALID_SEND_TYPES.includes(sendType)) {
			return c.json({ error: `Invalid send_connector_type: ${sendType}` }, 400);
		}

		if (!body.name || !body.email) {
			return c.json({ error: "Missing required fields: name, email" }, 400);
		}

		// Validate connector-specific required fields
		if (ingestType === "imap") {
			if (!body.imap_host || !body.imap_user || !body.imap_pass) {
				return c.json(
					{ error: "Missing required IMAP fields: imap_host, imap_user, imap_pass" },
					400,
				);
			}
		} else if (ingestType === "cloudflare-email") {
			if (!body.cf_email_webhook_secret) {
				return c.json({ error: "Missing required field: cf_email_webhook_secret" }, 400);
			}
		}

		if (sendType === "ses") {
			if (!body.ses_region) {
				return c.json({ error: "Missing required field: ses_region" }, 400);
			}
		}

		// Validate email format
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
			return c.json({ error: "Invalid email address format" }, 400);
		}
		// Validate port ranges when applicable
		if (body.imap_port != null) {
			const imapPort = body.imap_port;
			if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) {
				return c.json({ error: "IMAP port must be between 1 and 65535" }, 400);
			}
		}
		if (body.smtp_port != null) {
			const smtpPort = body.smtp_port;
			if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
				return c.json({ error: "SMTP port must be between 1 and 65535" }, 400);
			}
		}

		const result = db
			.prepare(`
			INSERT INTO accounts (name, email,
				ingest_connector_type, send_connector_type,
				imap_host, imap_port, imap_tls, imap_user, imap_pass,
				smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass,
				cf_email_webhook_secret,
				ses_region, ses_access_key_id, ses_secret_access_key,
				sync_delete_from_server)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.run(
				body.name,
				body.email,
				ingestType,
				sendType,
				body.imap_host ?? null,
				body.imap_port ?? 993,
				body.imap_tls ?? 1,
				body.imap_user ?? null,
				body.imap_pass ?? null,
				body.smtp_host ?? null,
				body.smtp_port ?? 587,
				body.smtp_tls ?? 1,
				body.smtp_user ?? null,
				body.smtp_pass ?? null,
				body.cf_email_webhook_secret ?? null,
				body.ses_region ?? null,
				body.ses_access_key_id ?? null,
				body.ses_secret_access_key ?? null,
				body.sync_delete_from_server ?? 0,
			);
		const accountId = Number(result.lastInsertRowid);

		// Only register IMAP accounts with the sync scheduler — Cloudflare Email
		// is push-based (webhook) and doesn't need periodic polling
		if (ingestType === "imap" && body.imap_host) {
			getScheduler().addAccount({
				accountId,
				imapConfig: {
					host: body.imap_host,
					port: body.imap_port ?? 993,
					secure: (body.imap_tls ?? 1) === 1,
					auth: {
						user: body.imap_user,
						pass: body.imap_pass,
					},
				},
			});
		}

		return c.json({ id: accountId }, 201);
	});

	api.get("/:accountId", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const account = getDb()
			.prepare(`
			SELECT id, name, email,
				ingest_connector_type, send_connector_type,
				imap_host, imap_port, imap_tls, imap_user,
				smtp_host, smtp_port, smtp_tls, smtp_user,
				cf_email_webhook_secret,
				ses_region, ses_access_key_id,
				sync_delete_from_server, default_view, created_at, updated_at
			FROM accounts WHERE id = ?
		`)
			.get(accountId);
		if (!account) return c.json({ error: "Account not found" }, 404);
		return c.json(account);
	});

	api.put("/:accountId", async (c) => {
		const db = getDb();
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const body = await c.req.json();

		const allowedFields = [
			"name",
			"email",
			"ingest_connector_type",
			"send_connector_type",
			"imap_host",
			"imap_port",
			"imap_tls",
			"imap_user",
			"imap_pass",
			"smtp_host",
			"smtp_port",
			"smtp_tls",
			"smtp_user",
			"smtp_pass",
			"cf_email_webhook_secret",
			"ses_region",
			"ses_access_key_id",
			"ses_secret_access_key",
			"sync_delete_from_server",
			"default_view",
		];
		const sets: string[] = [];
		const values: (string | number | null)[] = [];
		for (const field of allowedFields) {
			if (field in body) {
				sets.push(`${field} = ?`);
				values.push(body[field] as string | number | null);
			}
		}
		if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);

		sets.push("updated_at = datetime('now')");
		values.push(accountId);

		db.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(
			...(values as [string | number | null, ...Array<string | number | null>]),
		);
		return c.json({ ok: true });
	});

	api.delete("/:accountId", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const result = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
		if (result.changes === 0) return c.json({ error: "Account not found" }, 404);
		return c.json({ ok: true });
	});

	api.get("/:accountId/sync-status", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const folders = getDb()
			.prepare(`
			SELECT f.id, f.name, f.path, f.message_count, f.unread_count, f.last_synced_at,
				ss.last_uid
			FROM folders f
			LEFT JOIN sync_state ss ON ss.folder_id = f.id AND ss.account_id = f.account_id
			WHERE f.account_id = ?
			ORDER BY f.path
		`)
			.all(accountId);
		return c.json(folders);
	});

	api.get("/:accountId/folders", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const folders = getDb()
			.prepare(
				"SELECT id, path, name, special_use, message_count, unread_count, last_synced_at FROM folders WHERE account_id = ? ORDER BY path",
			)
			.all(accountId);
		return c.json(folders);
	});

	api.get("/:accountId/folders/:folderId/messages", (c) => {
		const folderId = parseIntParam(c, "folderId", c.req.param("folderId"));
		if (folderId instanceof Response) return folderId;
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const messages = getDb()
			.prepare(`
			SELECT id, uid, message_id, subject, from_address, from_name,
				to_addresses, date, flags, size, has_attachments,
				SUBSTR(text_body, 1, 200) as preview
			FROM messages
			WHERE folder_id = ?
			ORDER BY date DESC
			LIMIT ? OFFSET ?
		`)
			.all(folderId, limit, offset);

		return c.json(messages);
	});

	api.get("/:accountId/labels", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const labels = getDb()
			.prepare(
				"SELECT id, name, color, source, created_at, message_count, unread_count FROM labels WHERE account_id = ? ORDER BY name",
			)
			.all(accountId);
		return c.json(labels);
	});

	api.post("/:accountId/labels", async (c) => {
		const db = getDb();
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const body = await c.req.json();
		if (!body.name) return c.json({ error: "name is required" }, 400);

		try {
			const result = db
				.prepare("INSERT INTO labels (account_id, name, color, source) VALUES (?, ?, ?, ?)")
				.run(accountId, body.name, body.color ?? null, body.source ?? "user");
			return c.json({ id: Number(result.lastInsertRowid) }, 201);
		} catch (err) {
			if (String(err).includes("UNIQUE constraint")) {
				return c.json({ error: "Label already exists" }, 409);
			}
			throw err;
		}
	});

	// All messages for an account (regardless of labels) — used by "All Mail" view
	api.get("/:accountId/all-messages", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;
		const db = getDb();

		const messages = db
			.prepare(`
				SELECT id, uid, message_id, subject, from_address, from_name,
					to_addresses, date, flags, size, has_attachments,
					SUBSTR(text_body, 1, 200) as preview
				FROM messages
				WHERE account_id = ?
				ORDER BY date DESC
				LIMIT ? OFFSET ?
			`)
			.all(accountId, limit, offset);

		return c.json(messages);
	});

	// Unread messages for an account (messages without \Seen flag) — used by "Unread" view
	api.get("/:accountId/unread-messages", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;
		const db = getDb();

		const messages = db
			.prepare(`
				SELECT id, uid, message_id, subject, from_address, from_name,
					to_addresses, date, flags, size, has_attachments,
					SUBSTR(text_body, 1, 200) as preview
				FROM messages
				WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
				ORDER BY date DESC
				LIMIT ? OFFSET ?
			`)
			.all(accountId, limit, offset);

		return c.json(messages);
	});

	// Count of unread messages for an account (for "Unread" badge).
	// Returns the cached value from accounts.cached_unread_count (O(1)).
	// On first call after migration, computes and stores the count (one-time scan).
	api.get("/:accountId/unread-messages/count", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const db = getDb();

		const account = db
			.prepare("SELECT cached_unread_count FROM accounts WHERE id = ?")
			.get(accountId) as { cached_unread_count: number | null } | undefined;
		if (!account) return c.json({ error: "Account not found" }, 404);

		if (account.cached_unread_count !== null) {
			return c.json({ total: account.cached_unread_count });
		}

		// First call after migration — compute and cache
		const row = db
			.prepare(`
				SELECT COUNT(*) as total
				FROM messages WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
			`)
			.get(accountId) as { total: number };
		db.prepare("UPDATE accounts SET cached_unread_count = ? WHERE id = ?").run(
			row.total,
			accountId,
		);
		return c.json(row);
	});

	// Total message count for an account (for "All Mail" badge).
	// Returns the cached value from accounts.cached_message_count/cached_unread_count (O(1)).
	// On first call after migration, computes and stores the counts (one-time scan).
	api.get("/:accountId/all-messages/count", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const db = getDb();

		const account = db
			.prepare("SELECT cached_message_count, cached_unread_count FROM accounts WHERE id = ?")
			.get(accountId) as
			| {
					cached_message_count: number | null;
					cached_unread_count: number | null;
			  }
			| undefined;
		if (!account) return c.json({ error: "Account not found" }, 404);

		if (account.cached_message_count !== null && account.cached_unread_count !== null) {
			return c.json({ total: account.cached_message_count, unread: account.cached_unread_count });
		}

		// First call after migration — compute and cache
		const row = db
			.prepare(`
				SELECT
					COUNT(*) as total,
					COALESCE(SUM(CASE WHEN flags IS NULL OR flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END), 0) as unread
				FROM messages
				WHERE account_id = ?
			`)
			.get(accountId) as { total: number; unread: number };
		db.prepare(
			"UPDATE accounts SET cached_message_count = ?, cached_unread_count = ? WHERE id = ?",
		).run(row.total, row.unread, accountId);
		return c.json(row);
	});

	api.post("/:accountId/sync", async (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		try {
			const result = await getScheduler().syncNow(accountId);
			return c.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
	});

	api.get("/:accountId/connector-health", async (c) => {
		const db = getDb();
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const account = db
			.prepare(
				`SELECT id, ingest_connector_type, send_connector_type,
					imap_host, imap_port, imap_tls, imap_user, imap_pass,
					smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass,
					cf_email_webhook_secret,
					ses_region, ses_access_key_id, ses_secret_access_key
				FROM accounts WHERE id = ?`,
			)
			.get(accountId) as
			| {
					id: number;
					ingest_connector_type: IngestConnectorType;
					send_connector_type: SendConnectorType;
					imap_host: string | null;
					imap_port: number;
					imap_tls: number;
					imap_user: string | null;
					imap_pass: string | null;
					smtp_host: string | null;
					smtp_port: number;
					smtp_tls: number;
					smtp_user: string | null;
					smtp_pass: string | null;
					cf_email_webhook_secret: string | null;
					ses_region: string | null;
					ses_access_key_id: string | null;
					ses_secret_access_key: string | null;
			  }
			| undefined;

		if (!account) return c.json({ error: "Account not found" }, 404);

		const ingestType = account.ingest_connector_type ?? "imap";
		const sendType = account.send_connector_type ?? "smtp";

		const health: {
			ingest: { type: string; ok: boolean; error?: string; details?: Record<string, unknown> };
			send: { type: string; ok: boolean; error?: string };
		} = {
			ingest: { type: ingestType, ok: false },
			send: { type: sendType, ok: false },
		};

		// Check ingest connector health
		if (ingestType === "imap" && account.imap_host && account.imap_user && account.imap_pass) {
			try {
				const connector = createIngestConnector({
					type: "imap",
					imap: {
						host: account.imap_host,
						port: account.imap_port,
						secure: account.imap_tls === 1,
						auth: { user: account.imap_user, pass: account.imap_pass },
					},
				});
				await connector.connect();
				const folders = await connector.listFolders();
				await connector.disconnect();
				health.ingest = { type: "imap", ok: true, details: { folders: folders.length } };
			} catch (err) {
				health.ingest = {
					type: "imap",
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		} else if (ingestType === "cloudflare-email") {
			// Cloudflare Email is push-based — we can only verify the webhook secret is configured
			health.ingest = {
				type: "cloudflare-email",
				ok: !!account.cf_email_webhook_secret,
				error: account.cf_email_webhook_secret ? undefined : "Webhook secret not configured",
				details: { mode: "push-based webhook" },
			};
		} else {
			health.ingest = {
				type: ingestType,
				ok: false,
				error: "Ingest connector not configured",
			};
		}

		// Check send connector health
		if (sendType === "smtp" && account.smtp_host && account.smtp_user && account.smtp_pass) {
			try {
				const connector = createSendConnector({
					type: "smtp",
					smtp: {
						host: account.smtp_host,
						port: account.smtp_port,
						secure: account.smtp_tls === 1,
						auth: { user: account.smtp_user, pass: account.smtp_pass },
					},
				});
				const ok = await connector.verify();
				health.send = { type: "smtp", ok, error: ok ? undefined : "SMTP verification failed" };
			} catch (err) {
				health.send = {
					type: "smtp",
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		} else if (sendType === "ses" && account.ses_region) {
			try {
				const connector = createSendConnector({
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
				const ok = await connector.verify();
				health.send = { type: "ses", ok, error: ok ? undefined : "SES verification failed" };
			} catch (err) {
				health.send = {
					type: "ses",
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		} else {
			health.send = {
				type: sendType,
				ok: false,
				error: "Send connector not configured",
			};
		}

		// Include sync status for IMAP accounts
		const syncStatus = getScheduler().getStatus().get(accountId);
		return c.json({
			...health,
			sync: syncStatus
				? {
						running: syncStatus.running,
						lastSync: syncStatus.lastSync,
						lastError: syncStatus.lastError,
						consecutiveErrors: syncStatus.consecutiveErrors,
					}
				: null,
		});
	});

	api.post("/test-connection", async (c) => {
		const body = await c.req.json();
		if (!body.imap_host || !body.imap_user || !body.imap_pass) {
			return c.json({ error: "Missing required fields: imap_host, imap_user, imap_pass" }, 400);
		}

		const client = new ImapFlow({
			host: body.imap_host,
			port: body.imap_port ?? 993,
			secure: (body.imap_tls ?? 1) === 1,
			auth: { user: body.imap_user, pass: body.imap_pass },
			logger: false,
		});

		try {
			await client.connect();
			const list = await client.list();
			await client.logout();
			return c.json({ ok: true, mailboxes: list.length });
		} catch (err) {
			let message: string;
			if (err instanceof AggregateError) {
				message = err.errors.map((e: Error) => e.message).join("; ") || "Connection failed";
			} else {
				message = err instanceof Error ? err.message : String(err);
			}
			return c.json({ ok: false, error: message || "Connection failed" }, 200);
		}
	});

	return api;
}
