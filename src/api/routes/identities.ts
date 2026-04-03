import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import { parseIntParam, parsePagination } from "../validation.js";

export function identityRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		// Identities are now send-only: name, email, outbound connector.
		const identities = getDb()
			.prepare(
				`SELECT i.id, i.name, i.email,
					oc.type AS send_connector_type,
					oc.smtp_host,
					i.outbound_connector_id,
					i.default_view, i.created_at
				FROM identities i
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

		if (!body.outbound_connector_id) {
			return c.json({ error: "Missing required field: outbound_connector_id" }, 400);
		}
		const outboundConnectorId: number = body.outbound_connector_id;

		const ocExists = db
			.prepare("SELECT id FROM outbound_connectors WHERE id = ?")
			.get(outboundConnectorId);
		if (!ocExists) {
			return c.json({ error: `Outbound connector ${outboundConnectorId} not found` }, 400);
		}

		const result = db
			.prepare(
				`INSERT INTO identities
					(name, email, outbound_connector_id, default_view)
				VALUES (?, ?, ?, ?)`,
			)
			.run(body.name, body.email, outboundConnectorId, body.default_view ?? "inbox");
		const identityId = Number(result.lastInsertRowid);

		return c.json({ id: identityId }, 201);
	});

	api.get("/:identityId", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;

		const identity = getDb()
			.prepare(
				`SELECT
					i.id, i.name, i.email,
					i.outbound_connector_id,
					oc.type AS send_connector_type,
					oc.name AS outbound_connector_name,
					oc.smtp_host, oc.smtp_port, oc.smtp_tls, oc.smtp_user,
					oc.ses_region, oc.ses_access_key_id,
					i.default_view, i.created_at, i.updated_at
				FROM identities i
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

		// Validate outbound connector reference if provided
		if (body.outbound_connector_id != null) {
			const exists = db
				.prepare("SELECT id FROM outbound_connectors WHERE id = ?")
				.get(body.outbound_connector_id);
			if (!exists) {
				return c.json({ error: `Outbound connector ${body.outbound_connector_id} not found` }, 400);
			}
		}

		const allowedFields = ["name", "email", "outbound_connector_id", "default_view"];
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

		return c.json({ ok: true });
	});

	api.delete("/:identityId", (c) => {
		const identityId = parseIntParam(c, "identityId", c.req.param("identityId"));
		if (identityId instanceof Response) return identityId;
		const result = getDb().prepare("DELETE FROM identities WHERE id = ?").run(identityId);
		if (result.changes === 0) return c.json({ error: "Identity not found" }, 404);
		return c.json({ ok: true });
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
