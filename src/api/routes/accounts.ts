import type Database from "@signalapp/better-sqlite3";
import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import type { SyncScheduler } from "../../sync/sync-scheduler.js";

export function accountRoutes(
	getDb: () => Database.Database,
	getScheduler: () => SyncScheduler,
): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const accounts = getDb()
			.prepare(
				"SELECT id, name, email, imap_host, smtp_host, created_at FROM accounts ORDER BY name",
			)
			.all();
		return c.json(accounts);
	});

	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		if (!body.name || !body.email || !body.imap_host || !body.imap_user || !body.imap_pass) {
			return c.json(
				{ error: "Missing required fields: name, email, imap_host, imap_user, imap_pass" },
				400,
			);
		}
		// Validate email format
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
			return c.json({ error: "Invalid email address format" }, 400);
		}
		// Validate port ranges
		const imapPort = body.imap_port ?? 993;
		const smtpPort = body.smtp_port ?? 587;
		if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) {
			return c.json({ error: "IMAP port must be between 1 and 65535" }, 400);
		}
		if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
			return c.json({ error: "SMTP port must be between 1 and 65535" }, 400);
		}
		const result = db
			.prepare(`
			INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass,
				smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass, sync_delete_from_server)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
			.run(
				body.name,
				body.email,
				body.imap_host,
				body.imap_port ?? 993,
				body.imap_tls ?? 1,
				body.imap_user,
				body.imap_pass,
				body.smtp_host ?? null,
				body.smtp_port ?? 587,
				body.smtp_tls ?? 1,
				body.smtp_user ?? null,
				body.smtp_pass ?? null,
				body.sync_delete_from_server ?? 0,
			);
		const accountId = Number(result.lastInsertRowid);

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

		return c.json({ id: accountId }, 201);
	});

	api.get("/:accountId", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const account = getDb()
			.prepare(`
			SELECT id, name, email, imap_host, imap_port, imap_tls, imap_user,
				smtp_host, smtp_port, smtp_tls, smtp_user,
				sync_delete_from_server, created_at, updated_at
			FROM accounts WHERE id = ?
		`)
			.get(accountId);
		if (!account) return c.json({ error: "Account not found" }, 404);
		return c.json(account);
	});

	api.put("/:accountId", async (c) => {
		const db = getDb();
		const accountId = Number(c.req.param("accountId"));
		const body = await c.req.json();

		const allowedFields = [
			"name",
			"email",
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
			"sync_delete_from_server",
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
		const accountId = Number(c.req.param("accountId"));
		const result = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
		if (result.changes === 0) return c.json({ error: "Account not found" }, 404);
		return c.json({ ok: true });
	});

	api.get("/:accountId/sync-status", (c) => {
		const accountId = Number(c.req.param("accountId"));
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
		const accountId = Number(c.req.param("accountId"));
		const folders = getDb()
			.prepare(
				"SELECT id, path, name, special_use, message_count, unread_count, last_synced_at FROM folders WHERE account_id = ? ORDER BY path",
			)
			.all(accountId);
		return c.json(folders);
	});

	api.get("/:accountId/folders/:folderId/messages", (c) => {
		const folderId = Number(c.req.param("folderId"));
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);

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
		const accountId = Number(c.req.param("accountId"));
		const labels = getDb()
			.prepare(`
				SELECT l.id, l.name, l.color, l.source, l.created_at,
					COUNT(ml.message_id) as message_count,
					(SELECT COUNT(*) FROM message_labels ml2
						JOIN messages m ON m.id = ml2.message_id
						WHERE ml2.label_id = l.id
						AND m.flags NOT LIKE '%Seen%') as unread_count
				FROM labels l
				LEFT JOIN message_labels ml ON ml.label_id = l.id
				WHERE l.account_id = ?
				GROUP BY l.id
				ORDER BY l.name
			`)
			.all(accountId);
		return c.json(labels);
	});

	api.post("/:accountId/labels", async (c) => {
		const db = getDb();
		const accountId = Number(c.req.param("accountId"));
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
		const accountId = Number(c.req.param("accountId"));
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);
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

	// Total message count for an account (for "All Mail" badge)
	api.get("/:accountId/all-messages/count", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const db = getDb();

		const row = db
			.prepare(`
				SELECT COUNT(*) as total,
					(SELECT COUNT(*) FROM messages WHERE account_id = ? AND flags NOT LIKE '%Seen%') as unread
				FROM messages WHERE account_id = ?
			`)
			.get(accountId, accountId) as { total: number; unread: number };

		return c.json(row);
	});

	api.post("/:accountId/sync", async (c) => {
		const accountId = Number(c.req.param("accountId"));
		try {
			const result = await getScheduler().syncNow(accountId);
			return c.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
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
