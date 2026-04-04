import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import {
	createIngestConnector,
	createSendConnector,
	type IngestConnectorType,
	type SendConnectorType,
} from "../../connectors/registry.js";
import type { R2Poller } from "../../sync/r2-poller.js";
import { signR2Request } from "../../sync/r2-sigv4.js";
import type { SyncScheduler } from "../../sync/sync-scheduler.js";
import { parseIntParam, parsePagination } from "../validation.js";

const VALID_INGEST_TYPES: IngestConnectorType[] = ["imap", "cloudflare-email", "cloudflare-r2"];
const VALID_SEND_TYPES: SendConnectorType[] = ["smtp", "ses"];

export interface InboundConnectorRow {
	id: number;
	name: string;
	type: IngestConnectorType;
	imap_host: string | null;
	imap_port: number;
	imap_tls: number;
	imap_user: string | null;
	imap_pass: string | null;
	cf_email_webhook_secret: string | null;
	cf_r2_account_id: string | null;
	cf_r2_bucket_name: string | null;
	cf_r2_access_key_id: string | null;
	cf_r2_secret_access_key: string | null;
	cf_r2_prefix: string;
	cf_r2_poll_interval_ms: number | null;
	created_at: string;
	updated_at: string;
}

export interface OutboundConnectorRow {
	id: number;
	name: string;
	type: SendConnectorType;
	smtp_host: string | null;
	smtp_port: number;
	smtp_tls: number;
	smtp_user: string | null;
	smtp_pass: string | null;
	ses_region: string | null;
	ses_access_key_id: string | null;
	ses_secret_access_key: string | null;
	created_at: string;
	updated_at: string;
}

export function connectorRoutes(
	getDb: () => Database.Database,
	getScheduler: () => SyncScheduler,
	getR2Poller: () => R2Poller | null,
): Hono {
	const api = new Hono();

	// ── Inbound Connectors ────────────────────────────────────────────────────

	api.get("/inbound", (c) => {
		const connectors = getDb()
			.prepare(
				`SELECT id, name, type, imap_host, imap_port, imap_tls, imap_user,
					cf_email_webhook_secret, sync_delete_from_server,
					cf_r2_account_id, cf_r2_bucket_name, cf_r2_access_key_id,
					cf_r2_prefix, cf_r2_poll_interval_ms,
					created_at, updated_at
				FROM inbound_connectors ORDER BY name`,
			)
			.all();
		return c.json(connectors);
	});

	// Returns all folders across all inbound connectors (for global move-to-folder UI)
	api.get("/inbound/folders", (c) => {
		const folders = getDb()
			.prepare(
				`SELECT id, inbound_connector_id, path, name, special_use, message_count, unread_count, last_synced_at
				FROM folders
				WHERE inbound_connector_id IS NOT NULL
				ORDER BY name`,
			)
			.all();
		return c.json(folders);
	});

	api.post("/inbound", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		const type: IngestConnectorType = body.type ?? "imap";
		if (!VALID_INGEST_TYPES.includes(type)) {
			return c.json({ error: `Invalid type: ${type}` }, 400);
		}
		if (!body.name) {
			return c.json({ error: "name is required" }, 400);
		}

		if (type === "imap") {
			if (!body.imap_host || !body.imap_user || !body.imap_pass) {
				return c.json(
					{ error: "Missing required IMAP fields: imap_host, imap_user, imap_pass" },
					400,
				);
			}
			if (body.imap_port != null) {
				const port = body.imap_port;
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					return c.json({ error: "imap_port must be between 1 and 65535" }, 400);
				}
			}
		} else if (type === "cloudflare-email") {
			if (!body.cf_email_webhook_secret) {
				return c.json({ error: "cf_email_webhook_secret is required" }, 400);
			}
		} else if (type === "cloudflare-r2") {
			const missing = [
				"cf_r2_account_id",
				"cf_r2_bucket_name",
				"cf_r2_access_key_id",
				"cf_r2_secret_access_key",
			].filter((f) => !body[f]);
			if (missing.length > 0) {
				return c.json({ error: `Missing required R2 fields: ${missing.join(", ")}` }, 400);
			}
		}

		const result = db
			.prepare(
				`INSERT INTO inbound_connectors
					(name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass,
					cf_email_webhook_secret, sync_delete_from_server,
					cf_r2_account_id, cf_r2_bucket_name, cf_r2_access_key_id,
					cf_r2_secret_access_key, cf_r2_prefix, cf_r2_poll_interval_ms)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				body.name,
				type,
				body.imap_host ?? null,
				body.imap_port ?? 993,
				body.imap_tls ?? 1,
				body.imap_user ?? null,
				body.imap_pass ?? null,
				body.cf_email_webhook_secret ?? null,
				body.sync_delete_from_server ?? 0,
				body.cf_r2_account_id ?? null,
				body.cf_r2_bucket_name ?? null,
				body.cf_r2_access_key_id ?? null,
				body.cf_r2_secret_access_key ?? null,
				body.cf_r2_prefix ?? "pending/",
				body.cf_r2_poll_interval_ms ?? null,
			);

		const newId = Number(result.lastInsertRowid);

		// Register IMAP connectors with the sync scheduler immediately
		if (type === "imap" && body.imap_host && body.imap_user && body.imap_pass) {
			try {
				getScheduler().addConnector({
					inboundConnectorId: newId,
					imapConfig: {
						host: body.imap_host,
						port: body.imap_port ?? 993,
						secure: (body.imap_tls ?? 1) === 1,
						auth: { user: body.imap_user, pass: body.imap_pass },
					},
				});
			} catch {
				// Scheduler may not be started yet (setup phase) — not fatal
			}
		}

		return c.json({ id: newId }, 201);
	});

	api.get("/inbound/:connectorId", (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const connector = getDb()
			.prepare(
				`SELECT id, name, type, imap_host, imap_port, imap_tls, imap_user,
					cf_email_webhook_secret, sync_delete_from_server,
					cf_r2_account_id, cf_r2_bucket_name, cf_r2_access_key_id,
					cf_r2_prefix, cf_r2_poll_interval_ms,
					created_at, updated_at
				FROM inbound_connectors WHERE id = ?`,
			)
			.get(connectorId);

		if (!connector) return c.json({ error: "Inbound connector not found" }, 404);
		return c.json(connector);
	});

	api.put("/inbound/:connectorId", async (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;
		const body = await c.req.json();

		const existing = db.prepare("SELECT id FROM inbound_connectors WHERE id = ?").get(connectorId);
		if (!existing) return c.json({ error: "Inbound connector not found" }, 404);

		if (body.type != null && !VALID_INGEST_TYPES.includes(body.type)) {
			return c.json({ error: `Invalid type: ${body.type}` }, 400);
		}
		if (body.imap_port != null) {
			const port = body.imap_port;
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				return c.json({ error: "imap_port must be between 1 and 65535" }, 400);
			}
		}

		const allowedFields = [
			"name",
			"type",
			"imap_host",
			"imap_port",
			"imap_tls",
			"imap_user",
			"imap_pass",
			"cf_email_webhook_secret",
			"sync_delete_from_server",
			"cf_r2_account_id",
			"cf_r2_bucket_name",
			"cf_r2_access_key_id",
			"cf_r2_secret_access_key",
			"cf_r2_prefix",
			"cf_r2_poll_interval_ms",
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
		values.push(connectorId);
		db.prepare(`UPDATE inbound_connectors SET ${sets.join(", ")} WHERE id = ?`).run(
			...(values as [string | number | null, ...Array<string | number | null>]),
		);

		// Reload connector in scheduler if IMAP credentials changed
		if (
			"imap_host" in body ||
			"imap_port" in body ||
			"imap_tls" in body ||
			"imap_user" in body ||
			"imap_pass" in body
		) {
			_reloadConnector(db, getScheduler(), connectorId);
		}

		// Reload R2 poller if R2 credentials changed
		if (
			"cf_r2_account_id" in body ||
			"cf_r2_bucket_name" in body ||
			"cf_r2_access_key_id" in body ||
			"cf_r2_secret_access_key" in body ||
			"cf_r2_prefix" in body ||
			"cf_r2_poll_interval_ms" in body
		) {
			const poller = getR2Poller();
			if (poller) {
				_reloadR2Connector(db, poller, connectorId);
			}
		}

		return c.json({ ok: true });
	});

	api.delete("/inbound/:connectorId", (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const result = db.prepare("DELETE FROM inbound_connectors WHERE id = ?").run(connectorId);
		if (result.changes === 0) return c.json({ error: "Inbound connector not found" }, 404);

		// Remove from scheduler and R2 poller
		try {
			getScheduler().removeConnector(connectorId);
		} catch {
			/* not registered */
		}
		const poller = getR2Poller();
		if (poller) poller.removeConnector(connectorId);

		return c.json({ ok: true });
	});

	api.post("/inbound/:connectorId/test", async (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const connector = db
			.prepare(
				`SELECT type, imap_host, imap_port, imap_tls, imap_user, imap_pass,
					cf_email_webhook_secret,
					cf_r2_account_id, cf_r2_bucket_name, cf_r2_access_key_id,
					cf_r2_secret_access_key, cf_r2_prefix
				FROM inbound_connectors WHERE id = ?`,
			)
			.get(connectorId) as InboundConnectorRow | undefined;
		if (!connector) return c.json({ error: "Inbound connector not found" }, 404);

		if (connector.type === "imap") {
			if (!connector.imap_host || !connector.imap_user || !connector.imap_pass) {
				return c.json({ ok: false, error: "IMAP connector is not fully configured" });
			}
			try {
				const ingest = createIngestConnector({
					type: "imap",
					imap: {
						host: connector.imap_host,
						port: connector.imap_port,
						secure: connector.imap_tls === 1,
						auth: { user: connector.imap_user, pass: connector.imap_pass },
					},
				});
				await ingest.connect();
				const folders = await ingest.listFolders();
				await ingest.disconnect();
				return c.json({ ok: true, details: { folders: folders.length } });
			} catch (err) {
				return c.json({
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		} else if (connector.type === "cloudflare-email") {
			return c.json({
				ok: !!connector.cf_email_webhook_secret,
				error: connector.cf_email_webhook_secret ? undefined : "Webhook secret not configured",
				details: { mode: "push-based webhook" },
			});
		} else if (connector.type === "cloudflare-r2") {
			if (
				!connector.cf_r2_account_id ||
				!connector.cf_r2_bucket_name ||
				!connector.cf_r2_access_key_id ||
				!connector.cf_r2_secret_access_key
			) {
				return c.json({ ok: false, error: "R2 connector is not fully configured" });
			}
			try {
				const prefix = connector.cf_r2_prefix ?? "pending/";
				const url = new URL(
					`https://${connector.cf_r2_account_id}.r2.cloudflarestorage.com/${connector.cf_r2_bucket_name}`,
				);
				url.searchParams.set("list-type", "2");
				url.searchParams.set("prefix", prefix);
				url.searchParams.set("max-keys", "1");
				const headers = signR2Request({
					method: "GET",
					url,
					accessKeyId: connector.cf_r2_access_key_id,
					secretAccessKey: connector.cf_r2_secret_access_key,
				});
				const res = await fetch(url.toString(), { method: "GET", headers });
				if (!res.ok) {
					const body = await res.text().catch(() => "");
					return c.json({ ok: false, error: `R2 returned ${res.status}: ${body}` });
				}
				return c.json({ ok: true, details: { mode: "queue/poll", prefix } });
			} catch (err) {
				return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
			}
		}
		return c.json({ ok: false, error: "Unknown connector type" });
	});

	api.get("/inbound/:connectorId/sync-status", (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const status = getScheduler().getStatus().get(connectorId);
		if (!status) return c.json({ error: "Connector not registered in scheduler" }, 404);
		return c.json(status);
	});

	api.post("/inbound/:connectorId/sync", async (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;
		try {
			const result = await getScheduler().syncNow(connectorId);
			return c.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
	});

	api.get("/inbound/:connectorId/folders", (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const folders = getDb()
			.prepare(
				`SELECT id, path, name, special_use, message_count, unread_count, last_synced_at
				FROM folders
				WHERE inbound_connector_id = ?
				ORDER BY name`,
			)
			.all(connectorId);
		return c.json(folders);
	});

	api.get("/inbound/:connectorId/folders/:folderId/messages", (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;
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
				WHERE folder_id = ? AND inbound_connector_id = ?
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(folderId, connectorId, limit, offset);

		return c.json(messages);
	});

	// ── Outbound Connectors ───────────────────────────────────────────────────

	api.get("/outbound", (c) => {
		const connectors = getDb()
			.prepare(
				`SELECT id, name, type, smtp_host, smtp_port, smtp_tls, smtp_user,
					ses_region, ses_access_key_id, created_at, updated_at
				FROM outbound_connectors ORDER BY name`,
			)
			.all();
		return c.json(connectors);
	});

	api.post("/outbound", async (c) => {
		const db = getDb();
		const body = await c.req.json();

		const type: SendConnectorType = body.type ?? "smtp";
		if (!VALID_SEND_TYPES.includes(type)) {
			return c.json({ error: `Invalid type: ${type}` }, 400);
		}
		if (!body.name) {
			return c.json({ error: "name is required" }, 400);
		}

		if (type === "smtp") {
			if (!body.smtp_host || !body.smtp_user || !body.smtp_pass) {
				return c.json(
					{ error: "Missing required SMTP fields: smtp_host, smtp_user, smtp_pass" },
					400,
				);
			}
			if (body.smtp_port != null) {
				const port = body.smtp_port;
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					return c.json({ error: "smtp_port must be between 1 and 65535" }, 400);
				}
			}
		} else if (type === "ses") {
			if (!body.ses_region) {
				return c.json({ error: "ses_region is required" }, 400);
			}
		}

		const result = db
			.prepare(
				`INSERT INTO outbound_connectors
					(name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass,
					ses_region, ses_access_key_id, ses_secret_access_key)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				body.name,
				type,
				body.smtp_host ?? null,
				body.smtp_port ?? 587,
				body.smtp_tls ?? 1,
				body.smtp_user ?? null,
				body.smtp_pass ?? null,
				body.ses_region ?? null,
				body.ses_access_key_id ?? null,
				body.ses_secret_access_key ?? null,
			);

		return c.json({ id: Number(result.lastInsertRowid) }, 201);
	});

	api.get("/outbound/:connectorId", (c) => {
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const connector = getDb()
			.prepare(
				`SELECT id, name, type, smtp_host, smtp_port, smtp_tls, smtp_user,
					ses_region, ses_access_key_id, created_at, updated_at
				FROM outbound_connectors WHERE id = ?`,
			)
			.get(connectorId);

		if (!connector) return c.json({ error: "Outbound connector not found" }, 404);
		return c.json(connector);
	});

	api.put("/outbound/:connectorId", async (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;
		const body = await c.req.json();

		const existing = db.prepare("SELECT id FROM outbound_connectors WHERE id = ?").get(connectorId);
		if (!existing) return c.json({ error: "Outbound connector not found" }, 404);

		if (body.type != null && !VALID_SEND_TYPES.includes(body.type)) {
			return c.json({ error: `Invalid type: ${body.type}` }, 400);
		}
		if (body.smtp_port != null) {
			const port = body.smtp_port;
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				return c.json({ error: "smtp_port must be between 1 and 65535" }, 400);
			}
		}

		const allowedFields = [
			"name",
			"type",
			"smtp_host",
			"smtp_port",
			"smtp_tls",
			"smtp_user",
			"smtp_pass",
			"ses_region",
			"ses_access_key_id",
			"ses_secret_access_key",
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
		values.push(connectorId);
		db.prepare(`UPDATE outbound_connectors SET ${sets.join(", ")} WHERE id = ?`).run(
			...(values as [string | number | null, ...Array<string | number | null>]),
		);

		return c.json({ ok: true });
	});

	api.delete("/outbound/:connectorId", (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		// Block deletion if any identity references this connector
		const inUse = db
			.prepare("SELECT COUNT(*) as n FROM identities WHERE outbound_connector_id = ?")
			.get(connectorId) as { n: number };
		if (inUse.n > 0) {
			return c.json(
				{
					error: `Cannot delete: ${inUse.n} identity/identities still reference this outbound connector`,
				},
				409,
			);
		}

		const result = db.prepare("DELETE FROM outbound_connectors WHERE id = ?").run(connectorId);
		if (result.changes === 0) return c.json({ error: "Outbound connector not found" }, 404);
		return c.json({ ok: true });
	});

	api.post("/outbound/:connectorId/test", async (c) => {
		const db = getDb();
		const connectorId = parseIntParam(c, "connectorId", c.req.param("connectorId"));
		if (connectorId instanceof Response) return connectorId;

		const connector = db
			.prepare(
				`SELECT type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass,
					ses_region, ses_access_key_id, ses_secret_access_key
				FROM outbound_connectors WHERE id = ?`,
			)
			.get(connectorId) as OutboundConnectorRow | undefined;
		if (!connector) return c.json({ error: "Outbound connector not found" }, 404);

		if (connector.type === "smtp") {
			if (!connector.smtp_host || !connector.smtp_user || !connector.smtp_pass) {
				return c.json({ ok: false, error: "SMTP connector is not fully configured" });
			}
			try {
				const send = createSendConnector({
					type: "smtp",
					smtp: {
						host: connector.smtp_host,
						port: connector.smtp_port,
						secure: connector.smtp_tls === 1,
						auth: { user: connector.smtp_user, pass: connector.smtp_pass },
					},
				});
				const ok = await send.verify();
				return c.json({ ok, error: ok ? undefined : "SMTP verification failed" });
			} catch (err) {
				return c.json({
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		} else if (connector.type === "ses") {
			if (!connector.ses_region) {
				return c.json({ ok: false, error: "SES connector is not fully configured" });
			}
			try {
				const send = createSendConnector({
					type: "ses",
					ses: {
						region: connector.ses_region,
						credentials:
							connector.ses_access_key_id && connector.ses_secret_access_key
								? {
										accessKeyId: connector.ses_access_key_id,
										secretAccessKey: connector.ses_secret_access_key,
									}
								: undefined,
					},
				});
				const ok = await send.verify();
				return c.json({ ok, error: ok ? undefined : "SES verification failed" });
			} catch (err) {
				return c.json({
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return c.json({ ok: false, error: "Unknown connector type" });
	});

	return api;
}

/** Reload an R2 connector in the poller after its credentials change. */
function _reloadR2Connector(db: Database.Database, poller: R2Poller, connectorId: number): void {
	const row = db
		.prepare(
			`SELECT id, cf_r2_account_id, cf_r2_bucket_name,
				cf_r2_access_key_id, cf_r2_secret_access_key,
				cf_r2_prefix, cf_r2_poll_interval_ms
			FROM inbound_connectors
			WHERE id = ? AND type = 'cloudflare-r2'
				AND cf_r2_account_id IS NOT NULL
				AND cf_r2_bucket_name IS NOT NULL
				AND cf_r2_access_key_id IS NOT NULL
				AND cf_r2_secret_access_key IS NOT NULL`,
		)
		.get(connectorId) as
		| {
				id: number;
				cf_r2_account_id: string;
				cf_r2_bucket_name: string;
				cf_r2_access_key_id: string;
				cf_r2_secret_access_key: string;
				cf_r2_prefix: string;
				cf_r2_poll_interval_ms: number | null;
		  }
		| undefined;

	if (row) {
		poller.addConnector(row);
	} else {
		// Credentials were cleared or connector is incomplete — stop polling it
		poller.removeConnector(connectorId);
	}
}

/** Reload an IMAP inbound connector in the scheduler after its credentials change. */
function _reloadConnector(
	db: Database.Database,
	scheduler: SyncScheduler,
	connectorId: number,
): void {
	const row = db
		.prepare(
			`SELECT id, imap_host, imap_port, imap_tls, imap_user, imap_pass
			FROM inbound_connectors
			WHERE id = ? AND type = 'imap'`,
		)
		.get(connectorId) as
		| {
				id: number;
				imap_host: string | null;
				imap_port: number;
				imap_tls: number;
				imap_user: string | null;
				imap_pass: string | null;
		  }
		| undefined;

	try {
		scheduler.removeConnector(connectorId);
	} catch {
		/* not registered */
	}

	if (row?.imap_host && row.imap_user && row.imap_pass) {
		try {
			scheduler.addConnector({
				inboundConnectorId: connectorId,
				imapConfig: {
					host: row.imap_host,
					port: row.imap_port,
					secure: row.imap_tls === 1,
					auth: { user: row.imap_user, pass: row.imap_pass },
				},
			});
		} catch {
			/* scheduler not started */
		}
	}
}
