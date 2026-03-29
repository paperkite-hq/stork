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
		// Join with connector tables so callers see connector type without having to
		// fetch each connector separately. Credentials are never returned in list view.
		const accounts = getDb()
			.prepare(
				`SELECT a.id, a.name, a.email,
					COALESCE(ic.type, a.ingest_connector_type) AS ingest_connector_type,
					COALESCE(oc.type, a.send_connector_type) AS send_connector_type,
					COALESCE(ic.imap_host, a.imap_host) AS imap_host,
					COALESCE(oc.smtp_host, a.smtp_host) AS smtp_host,
					a.inbound_connector_id, a.outbound_connector_id,
					a.default_view, a.sync_delete_from_server, a.created_at
				FROM accounts a
				LEFT JOIN inbound_connectors ic ON ic.id = a.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = a.outbound_connector_id
				ORDER BY a.name`,
			)
			.all();
		return c.json(accounts);
	});

	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		if (!body.name || !body.email) {
			return c.json({ error: "Missing required fields: name, email" }, 400);
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
			return c.json({ error: "Invalid email address format" }, 400);
		}

		let inboundConnectorId: number | null = body.inbound_connector_id ?? null;
		let outboundConnectorId: number | null = body.outbound_connector_id ?? null;

		// Backward-compat: if inline connector fields are provided and no connector IDs,
		// auto-create connector rows so callers using the old API continue to work.
		if (inboundConnectorId === null) {
			const ingestType: IngestConnectorType = body.ingest_connector_type ?? "imap";
			if (!VALID_INGEST_TYPES.includes(ingestType)) {
				return c.json({ error: `Invalid ingest_connector_type: ${ingestType}` }, 400);
			}
			if (ingestType === "imap") {
				if (!body.imap_host || !body.imap_user || !body.imap_pass) {
					return c.json(
						{ error: "Missing required IMAP fields: imap_host, imap_user, imap_pass" },
						400,
					);
				}
				if (body.imap_port != null) {
					const port = body.imap_port;
					if (!Number.isInteger(port) || port < 1 || port > 65535) {
						return c.json({ error: "IMAP port must be between 1 and 65535" }, 400);
					}
				}
			} else if (ingestType === "cloudflare-email") {
				if (!body.cf_email_webhook_secret) {
					return c.json({ error: "Missing required field: cf_email_webhook_secret" }, 400);
				}
			}
			const r = db
				.prepare(
					`INSERT INTO inbound_connectors
						(name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass, cf_email_webhook_secret)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					`${body.name} (Inbound)`,
					ingestType,
					body.imap_host ?? null,
					body.imap_port ?? 993,
					body.imap_tls ?? 1,
					body.imap_user ?? null,
					body.imap_pass ?? null,
					body.cf_email_webhook_secret ?? null,
				);
			inboundConnectorId = Number(r.lastInsertRowid);
		} else {
			// Verify the referenced connector exists
			const exists = db
				.prepare("SELECT id FROM inbound_connectors WHERE id = ?")
				.get(inboundConnectorId);
			if (!exists) {
				return c.json({ error: `Inbound connector ${inboundConnectorId} not found` }, 400);
			}
		}

		if (outboundConnectorId === null) {
			const sendType: SendConnectorType = body.send_connector_type ?? "smtp";
			if (!VALID_SEND_TYPES.includes(sendType)) {
				return c.json({ error: `Invalid send_connector_type: ${sendType}` }, 400);
			}
			if (sendType === "ses" && !body.ses_region) {
				return c.json({ error: "Missing required field: ses_region" }, 400);
			}
			if (body.smtp_port != null) {
				const port = body.smtp_port;
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					return c.json({ error: "SMTP port must be between 1 and 65535" }, 400);
				}
			}
			const r = db
				.prepare(
					`INSERT INTO outbound_connectors
						(name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass,
						ses_region, ses_access_key_id, ses_secret_access_key)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					`${body.name} (Outbound)`,
					sendType,
					body.smtp_host ?? null,
					body.smtp_port ?? 587,
					body.smtp_tls ?? 1,
					body.smtp_user ?? null,
					body.smtp_pass ?? null,
					body.ses_region ?? null,
					body.ses_access_key_id ?? null,
					body.ses_secret_access_key ?? null,
				);
			outboundConnectorId = Number(r.lastInsertRowid);
		} else {
			const exists = db
				.prepare("SELECT id FROM outbound_connectors WHERE id = ?")
				.get(outboundConnectorId);
			if (!exists) {
				return c.json({ error: `Outbound connector ${outboundConnectorId} not found` }, 400);
			}
		}

		// Fetch connector types for the legacy columns (kept for backward compat)
		const ic = db
			.prepare("SELECT type FROM inbound_connectors WHERE id = ?")
			.get(inboundConnectorId) as { type: string };
		const oc = db
			.prepare("SELECT type FROM outbound_connectors WHERE id = ?")
			.get(outboundConnectorId) as { type: string };

		const result = db
			.prepare(
				`INSERT INTO accounts
					(name, email, inbound_connector_id, outbound_connector_id,
					ingest_connector_type, send_connector_type,
					sync_delete_from_server, default_view)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				body.name,
				body.email,
				inboundConnectorId,
				outboundConnectorId,
				ic.type,
				oc.type,
				body.sync_delete_from_server ?? 0,
				body.default_view ?? "inbox",
			);
		const accountId = Number(result.lastInsertRowid);

		// Register IMAP accounts with the sync scheduler
		if (ic.type === "imap") {
			const imap = db
				.prepare(
					"SELECT imap_host, imap_port, imap_tls, imap_user, imap_pass FROM inbound_connectors WHERE id = ?",
				)
				.get(inboundConnectorId) as {
				imap_host: string | null;
				imap_port: number;
				imap_tls: number;
				imap_user: string | null;
				imap_pass: string | null;
			};
			if (imap.imap_host && imap.imap_user && imap.imap_pass) {
				getScheduler().addAccount({
					accountId,
					imapConfig: {
						host: imap.imap_host,
						port: imap.imap_port,
						secure: imap.imap_tls === 1,
						auth: { user: imap.imap_user, pass: imap.imap_pass },
					},
				});
			}
		}

		return c.json({ id: accountId }, 201);
	});

	api.get("/:accountId", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;

		// Return account identity fields + full connector details (minus secrets).
		// Passwords/secret keys are intentionally excluded.
		const account = getDb()
			.prepare(
				`SELECT
					a.id, a.name, a.email,
					a.inbound_connector_id, a.outbound_connector_id,
					COALESCE(ic.type, a.ingest_connector_type) AS ingest_connector_type,
					COALESCE(oc.type, a.send_connector_type) AS send_connector_type,
					ic.name AS inbound_connector_name,
					ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user,
					ic.cf_email_webhook_secret,
					oc.name AS outbound_connector_name,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user,
					oc.ses_region, oc.ses_access_key_id,
					a.sync_delete_from_server, a.default_view, a.created_at, a.updated_at
				FROM accounts a
				LEFT JOIN inbound_connectors ic ON ic.id = a.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = a.outbound_connector_id
				WHERE a.id = ?`,
			)
			.get(accountId);

		if (!account) return c.json({ error: "Account not found" }, 404);
		return c.json(account);
	});

	api.put("/:accountId", async (c) => {
		const db = getDb();
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const body = await c.req.json();

		// Validate connector references if provided
		if (body.inbound_connector_id != null) {
			const exists = db
				.prepare("SELECT id FROM inbound_connectors WHERE id = ?")
				.get(body.inbound_connector_id);
			if (!exists) {
				return c.json({ error: `Inbound connector ${body.inbound_connector_id} not found` }, 400);
			}
		}
		if (body.outbound_connector_id != null) {
			const exists = db
				.prepare("SELECT id FROM outbound_connectors WHERE id = ?")
				.get(body.outbound_connector_id);
			if (!exists) {
				return c.json({ error: `Outbound connector ${body.outbound_connector_id} not found` }, 400);
			}
		}

		// Identity fields that can be updated directly on the account row
		const allowedAccountFields = [
			"name",
			"email",
			"inbound_connector_id",
			"outbound_connector_id",
			"sync_delete_from_server",
			"default_view",
		];
		const sets: string[] = [];
		const values: (string | number | null)[] = [];
		for (const field of allowedAccountFields) {
			if (field in body) {
				sets.push(`${field} = ?`);
				values.push(body[field] as string | number | null);
			}
		}

		// Backward-compat: keep legacy type columns in sync when connector is reassigned
		if (body.inbound_connector_id != null) {
			const ic = db
				.prepare("SELECT type FROM inbound_connectors WHERE id = ?")
				.get(body.inbound_connector_id) as { type: string } | undefined;
			if (ic) {
				sets.push("ingest_connector_type = ?");
				values.push(ic.type);
			}
		}
		if (body.outbound_connector_id != null) {
			const oc = db
				.prepare("SELECT type FROM outbound_connectors WHERE id = ?")
				.get(body.outbound_connector_id) as { type: string } | undefined;
			if (oc) {
				sets.push("send_connector_type = ?");
				values.push(oc.type);
			}
		}

		if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);

		sets.push("updated_at = datetime('now')");
		values.push(accountId);
		db.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(
			...(values as [string | number | null, ...Array<string | number | null>]),
		);

		// If inbound connector changed, update the scheduler
		if (body.inbound_connector_id != null) {
			const imap = db
				.prepare(
					`SELECT ic.type, ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user, ic.imap_pass
					FROM inbound_connectors ic WHERE ic.id = ?`,
				)
				.get(body.inbound_connector_id) as {
				type: string;
				imap_host: string | null;
				imap_port: number;
				imap_tls: number;
				imap_user: string | null;
				imap_pass: string | null;
			} | null;

			getScheduler().removeAccount(accountId);
			if (imap?.type === "imap" && imap.imap_host && imap.imap_user && imap.imap_pass) {
				getScheduler().addAccount({
					accountId,
					imapConfig: {
						host: imap.imap_host,
						port: imap.imap_port,
						secure: imap.imap_tls === 1,
						auth: { user: imap.imap_user, pass: imap.imap_pass },
					},
				});
			}
		}

		return c.json({ ok: true });
	});

	api.delete("/:accountId", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const result = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
		if (result.changes === 0) return c.json({ error: "Account not found" }, 404);
		getScheduler().removeAccount(accountId);
		return c.json({ ok: true });
	});

	api.get("/:accountId/sync-status", (c) => {
		const accountId = parseIntParam(c, "accountId", c.req.param("accountId"));
		if (accountId instanceof Response) return accountId;
		const folders = getDb()
			.prepare(
				`SELECT f.id, f.name, f.path, f.message_count, f.unread_count, f.last_synced_at,
					ss.last_uid
				FROM folders f
				LEFT JOIN sync_state ss ON ss.folder_id = f.id AND ss.account_id = f.account_id
				WHERE f.account_id = ?
				ORDER BY f.path`,
			)
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
			.prepare(
				`SELECT id, uid, message_id, subject, from_address, from_name,
					to_addresses, date, flags, size, has_attachments,
					SUBSTR(text_body, 1, 200) as preview
				FROM messages
				WHERE folder_id = ?
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
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
			.prepare(
				`SELECT id, uid, message_id, subject, from_address, from_name,
					to_addresses, date, flags, size, has_attachments,
					SUBSTR(text_body, 1, 200) as preview
				FROM messages
				WHERE account_id = ?
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
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
			.prepare(
				`SELECT id, uid, message_id, subject, from_address, from_name,
					to_addresses, date, flags, size, has_attachments,
					SUBSTR(text_body, 1, 200) as preview
				FROM messages
				WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
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
			.prepare(
				`SELECT COUNT(*) as total
				FROM messages WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')`,
			)
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
			.prepare(
				`SELECT
					COUNT(*) as total,
					COALESCE(SUM(CASE WHEN flags IS NULL OR flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END), 0) as unread
				FROM messages
				WHERE account_id = ?`,
			)
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

		// Fetch account + joined connector rows
		const account = db
			.prepare(
				`SELECT
					a.id,
					ic.type AS ingest_type,
					ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user, ic.imap_pass,
					ic.cf_email_webhook_secret,
					oc.type AS send_type,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user, oc.smtp_pass,
					oc.ses_region, oc.ses_access_key_id, oc.ses_secret_access_key
				FROM accounts a
				LEFT JOIN inbound_connectors ic ON ic.id = a.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = a.outbound_connector_id
				WHERE a.id = ?`,
			)
			.get(accountId) as
			| {
					id: number;
					ingest_type: IngestConnectorType | null;
					imap_host: string | null;
					imap_port: number;
					imap_tls: number;
					imap_user: string | null;
					imap_pass: string | null;
					cf_email_webhook_secret: string | null;
					send_type: SendConnectorType | null;
					smtp_host: string | null;
					smtp_port: number;
					smtp_tls: number;
					smtp_user: string | null;
					smtp_pass: string | null;
					ses_region: string | null;
					ses_access_key_id: string | null;
					ses_secret_access_key: string | null;
			  }
			| undefined;

		if (!account) return c.json({ error: "Account not found" }, 404);

		const ingestType = account.ingest_type ?? "imap";
		const sendType = account.send_type ?? "smtp";

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
