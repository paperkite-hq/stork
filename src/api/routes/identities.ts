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

export function identityRoutes(
	getDb: () => Database.Database,
	getScheduler: () => SyncScheduler,
): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		// Join with connector tables so callers see connector type without having to
		// fetch each connector separately. Credentials are never returned in list view.
		const identities = getDb()
			.prepare(
				`SELECT i.id, i.name, i.email,
					ic.type AS ingest_connector_type,
					oc.type AS send_connector_type,
					ic.imap_host,
					oc.smtp_host,
					i.inbound_connector_id, i.outbound_connector_id,
					i.default_view, i.created_at
				FROM identities i
				LEFT JOIN inbound_connectors ic ON ic.id = i.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = i.outbound_connector_id
				ORDER BY i.name`,
			)
			.all();
		return c.json(identities);
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

		const inboundConnectorId: number | null = body.inbound_connector_id ?? null;
		const outboundConnectorId: number | null = body.outbound_connector_id ?? null;

		if (inboundConnectorId === null) {
			return c.json({ error: "inbound_connector_id is required" }, 400);
		}
		// outbound_connector_id is optional (receive-only identities are allowed)

		// Verify the referenced connectors exist
		const icExists = db
			.prepare("SELECT id FROM inbound_connectors WHERE id = ?")
			.get(inboundConnectorId);
		if (!icExists) {
			return c.json({ error: `Inbound connector ${inboundConnectorId} not found` }, 400);
		}
		if (outboundConnectorId !== null) {
			const ocExists = db
				.prepare("SELECT id FROM outbound_connectors WHERE id = ?")
				.get(outboundConnectorId);
			if (!ocExists) {
				return c.json({ error: `Outbound connector ${outboundConnectorId} not found` }, 400);
			}
		}

		const result = db
			.prepare(
				`INSERT INTO identities
					(name, email, inbound_connector_id, outbound_connector_id, default_view)
				VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				body.name,
				body.email,
				inboundConnectorId,
				outboundConnectorId,
				body.default_view ?? "inbox",
			);
		const identityId = Number(result.lastInsertRowid);

		// Register IMAP identities with the sync scheduler
		const ic = db
			.prepare(
				"SELECT type, imap_host, imap_port, imap_tls, imap_user, imap_pass FROM inbound_connectors WHERE id = ?",
			)
			.get(inboundConnectorId) as {
			type: string;
			imap_host: string | null;
			imap_port: number;
			imap_tls: number;
			imap_user: string | null;
			imap_pass: string | null;
		};
		if (ic.type === "imap" && ic.imap_host && ic.imap_user && ic.imap_pass) {
			getScheduler().addIdentity({
				identityId: identityId,
				imapConfig: {
					host: ic.imap_host,
					port: ic.imap_port,
					secure: ic.imap_tls === 1,
					auth: { user: ic.imap_user, pass: ic.imap_pass },
				},
			});
		}

		return c.json({ id: identityId }, 201);
	});

	api.get("/:identityId", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;

		const identity = getDb()
			.prepare(
				`SELECT
					i.id, i.name, i.email,
					i.inbound_connector_id, i.outbound_connector_id,
					ic.type AS ingest_connector_type,
					oc.type AS send_connector_type,
					ic.name AS inbound_connector_name,
					ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user,
					ic.cf_email_webhook_secret,
					oc.name AS outbound_connector_name,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user,
					oc.ses_region, oc.ses_access_key_id,
					i.default_view, i.created_at, i.updated_at
				FROM identities i
				LEFT JOIN inbound_connectors ic ON ic.id = i.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = i.outbound_connector_id
				WHERE i.id = ?`,
			)
			.get(identityId);

		if (!identity) return c.json({ error: "Identity not found" }, 404);
		return c.json(identity);
	});

	api.put("/:identityId", async (c) => {
		const db = getDb();
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
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

		const allowedFields = [
			"name",
			"email",
			"inbound_connector_id",
			"outbound_connector_id",
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
		values.push(identityId);
		db.prepare(`UPDATE identities SET ${sets.join(", ")} WHERE id = ?`).run(
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

			getScheduler().removeIdentity(identityId);
			if (imap?.type === "imap" && imap.imap_host && imap.imap_user && imap.imap_pass) {
				getScheduler().addIdentity({
					identityId: identityId,
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

	api.delete("/:identityId", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const result = getDb().prepare("DELETE FROM identities WHERE id = ?").run(identityId);
		if (result.changes === 0) return c.json({ error: "Identity not found" }, 404);
		getScheduler().removeIdentity(identityId);
		return c.json({ ok: true });
	});

	api.get("/:identityId/sync-status", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const folders = getDb()
			.prepare(
				`SELECT f.id, f.name, f.path, f.message_count, f.unread_count, f.last_synced_at,
					ss.last_uid
				FROM folders f
				LEFT JOIN sync_state ss ON ss.folder_id = f.id AND ss.identity_id = f.identity_id
				WHERE f.identity_id = ?
				ORDER BY f.path`,
			)
			.all(identityId);
		return c.json(folders);
	});

	api.get("/:identityId/folders", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const folders = getDb()
			.prepare(
				"SELECT id, path, name, special_use, message_count, unread_count, last_synced_at FROM folders WHERE identity_id = ? ORDER BY path",
			)
			.all(identityId);
		return c.json(folders);
	});

	api.get("/:identityId/folders/:folderId/messages", (c) => {
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

	// Labels are instance-level (no identity scoping). The identityId param is
	// accepted for backward compatibility but ignored — all identities share one label set.
	api.get("/:identityId/labels", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		void identityId; // accepted but unused — labels are global
		const labels = getDb()
			.prepare(
				"SELECT id, name, color, source, created_at, message_count, unread_count FROM labels ORDER BY name",
			)
			.all();
		return c.json(labels);
	});

	api.post("/:identityId/labels", async (c) => {
		const db = getDb();
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		void identityId; // accepted but unused — labels are global
		const body = await c.req.json();
		if (!body.name) return c.json({ error: "name is required" }, 400);

		try {
			const result = db
				.prepare("INSERT INTO labels (name, color, source) VALUES (?, ?, ?)")
				.run(body.name, body.color ?? null, body.source ?? "user");
			return c.json({ id: Number(result.lastInsertRowid) }, 201);
		} catch (err) {
			if (String(err).includes("UNIQUE constraint")) {
				return c.json({ error: "Label already exists" }, 409);
			}
			throw err;
		}
	});

	// All messages for an identity (regardless of labels) — used by "All Mail" view
	api.get("/:identityId/all-messages", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
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
				WHERE identity_id = ?
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(identityId, limit, offset);

		return c.json(messages);
	});

	// Unread messages for an identity (messages without \Seen flag) — used by "Unread" view
	api.get("/:identityId/unread-messages", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
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
				WHERE identity_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
				ORDER BY date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(identityId, limit, offset);

		return c.json(messages);
	});

	// Count of unread messages for an identity (live query).
	api.get("/:identityId/unread-messages/count", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const db = getDb();

		const row = db
			.prepare(
				`SELECT COUNT(*) as total
				FROM messages WHERE identity_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')`,
			)
			.get(identityId) as { total: number };
		return c.json(row);
	});

	// Total message count for an identity (live query).
	api.get("/:identityId/all-messages/count", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const db = getDb();

		const row = db
			.prepare(
				`SELECT
					COUNT(*) as total,
					COALESCE(SUM(CASE WHEN flags IS NULL OR flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END), 0) as unread
				FROM messages
				WHERE identity_id = ?`,
			)
			.get(identityId) as { total: number; unread: number };
		return c.json(row);
	});

	api.post("/:identityId/sync", async (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		try {
			const result = await getScheduler().syncNow(identityId);
			return c.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
	});

	api.get("/:identityId/connector-health", async (c) => {
		const db = getDb();
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;

		// Fetch identity + joined connector rows
		const identity = db
			.prepare(
				`SELECT
					i.id,
					ic.type AS ingest_type,
					ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user, ic.imap_pass,
					ic.cf_email_webhook_secret,
					oc.type AS send_type,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user, oc.smtp_pass,
					oc.ses_region, oc.ses_access_key_id, oc.ses_secret_access_key
				FROM identities i
				LEFT JOIN inbound_connectors ic ON ic.id = i.inbound_connector_id
				LEFT JOIN outbound_connectors oc ON oc.id = i.outbound_connector_id
				WHERE i.id = ?`,
			)
			.get(identityId) as
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

		if (!identity) return c.json({ error: "Identity not found" }, 404);

		const ingestType = identity.ingest_type ?? "imap";
		const sendType = identity.send_type ?? "smtp";

		const health: {
			ingest: { type: string; ok: boolean; error?: string; details?: Record<string, unknown> };
			send: { type: string; ok: boolean; error?: string };
		} = {
			ingest: { type: ingestType, ok: false },
			send: { type: sendType, ok: false },
		};

		// Check ingest connector health
		if (ingestType === "imap" && identity.imap_host && identity.imap_user && identity.imap_pass) {
			try {
				const connector = createIngestConnector({
					type: "imap",
					imap: {
						host: identity.imap_host,
						port: identity.imap_port,
						secure: identity.imap_tls === 1,
						auth: { user: identity.imap_user, pass: identity.imap_pass },
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
				ok: !!identity.cf_email_webhook_secret,
				error: identity.cf_email_webhook_secret ? undefined : "Webhook secret not configured",
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
		if (sendType === "smtp" && identity.smtp_host && identity.smtp_user && identity.smtp_pass) {
			try {
				const connector = createSendConnector({
					type: "smtp",
					smtp: {
						host: identity.smtp_host,
						port: identity.smtp_port,
						secure: identity.smtp_tls === 1,
						auth: { user: identity.smtp_user, pass: identity.smtp_pass },
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
		} else if (sendType === "ses" && identity.ses_region) {
			try {
				const connector = createSendConnector({
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

		// Include sync status for IMAP identities
		const syncStatus = getScheduler().getStatus().get(identityId);
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
