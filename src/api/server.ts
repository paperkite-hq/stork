import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "@signalapp/better-sqlite3";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
	changePassword,
	initializeEncryption,
	rotateRecoveryKey,
	unlockWithPassword,
	unlockWithRecovery,
} from "../crypto/keys.js";
import type { ContainerContext } from "../crypto/lifecycle.js";
import { transitionToUnlocked } from "../crypto/lifecycle.js";
import { MessageSearch } from "../search/search.js";

// Progressive rate limiting for failed unlock attempts (ms delays)
const UNLOCK_DELAYS = [0, 1000, 2000, 4000, 8000, 16000, 30000];
let failedUnlockAttempts = 0;
let lastFailedUnlockAt = 0;

function getUnlockDelay(): number {
	// Reset counter after 10 minutes of no attempts
	if (Date.now() - lastFailedUnlockAt > 600_000) failedUnlockAttempts = 0;
	return UNLOCK_DELAYS[Math.min(failedUnlockAttempts, UNLOCK_DELAYS.length - 1)];
}

export function createApp(context: ContainerContext): { app: Hono } {
	const app = new Hono();

	app.use("*", cors());

	// Serve frontend static files
	app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
	app.get("/stork.svg", serveStatic({ root: "./frontend/dist", path: "stork.svg" }));

	// API routes
	const api = new Hono();

	// ── Always-accessible endpoints ──────────────────────────────────────────

	api.get("/health", (c) => {
		return c.json({ status: "ok", version: "0.1.0" });
	});

	api.get("/status", (c) => {
		return c.json({ state: context.state });
	});

	// Setup endpoint — only accessible when no keys file exists
	api.post("/setup", async (c) => {
		if (context.state !== "setup") {
			return c.json({ error: "Already initialized" }, 409);
		}
		const body = await c.req.json();
		if (!body.password || typeof body.password !== "string") {
			return c.json({ error: "password is required" }, 400);
		}
		if (body.password.length < 12) {
			return c.json({ error: "Password must be at least 12 characters" }, 400);
		}
		const mnemonic = initializeEncryption(context.dataDir, body.password);
		const vaultKey = unlockWithPassword(context.dataDir, body.password);
		transitionToUnlocked(context, vaultKey);
		return c.json({ recoveryMnemonic: mnemonic }, 201);
	});

	// Unlock endpoint — only accessible in locked state
	api.post("/unlock", async (c) => {
		if (context.state === "setup") {
			return c.json({ error: "Not initialized — use /api/setup first" }, 409);
		}
		if (context.state === "unlocked") {
			return c.json({ ok: true, alreadyUnlocked: true });
		}

		const delay = getUnlockDelay();
		if (delay > 0) {
			await new Promise((r) => setTimeout(r, delay));
		}

		const body = await c.req.json();

		try {
			let vaultKey: Buffer;
			if (body.recoveryMnemonic) {
				vaultKey = unlockWithRecovery(context.dataDir, body.recoveryMnemonic);
				// If using recovery mnemonic, require a new password
				if (!body.newPassword || typeof body.newPassword !== "string") {
					return c.json({ error: "newPassword is required when using recovery mnemonic" }, 400);
				}
				changePassword(context.dataDir, body.newPassword, body.newPassword);
				// Re-unlock with the new password to get a fresh vault key
				vaultKey.fill(0);
				vaultKey = unlockWithPassword(context.dataDir, body.newPassword);
			} else if (body.password) {
				vaultKey = unlockWithPassword(context.dataDir, body.password);
			} else {
				return c.json({ error: "password or recoveryMnemonic is required" }, 400);
			}

			failedUnlockAttempts = 0;
			transitionToUnlocked(context, vaultKey);
			return c.json({ ok: true });
		} catch {
			failedUnlockAttempts++;
			lastFailedUnlockAt = Date.now();
			return c.json({ error: "Invalid password or recovery key" }, 401);
		}
	});

	// ── Lock middleware — blocks all data routes until unlocked ──────────────

	api.use("*", async (c, next) => {
		if (context.state !== "unlocked") {
			return c.json(
				{
					error: "Container is locked",
					state: context.state,
				},
				423,
			);
		}
		await next();
	});

	// ── Security endpoints (require unlocked) ────────────────────────────────

	api.post("/change-password", async (c) => {
		const body = await c.req.json();
		if (!body.currentPassword || !body.newPassword) {
			return c.json({ error: "currentPassword and newPassword are required" }, 400);
		}
		if (body.newPassword.length < 12) {
			return c.json({ error: "Password must be at least 12 characters" }, 400);
		}
		try {
			changePassword(context.dataDir, body.currentPassword, body.newPassword);
			return c.json({ ok: true });
		} catch {
			return c.json({ error: "Current password is incorrect" }, 401);
		}
	});

	api.post("/rotate-recovery-key", async (c) => {
		const body = await c.req.json();
		if (!body.password) {
			return c.json({ error: "password is required to authorize recovery key rotation" }, 400);
		}
		try {
			const newMnemonic = rotateRecoveryKey(context.dataDir, body.password);
			return c.json({ recoveryMnemonic: newMnemonic });
		} catch {
			return c.json({ error: "Password is incorrect" }, 401);
		}
	});

	// ── Data routes (all require unlocked state via middleware above) ─────────

	function getDb(): Database.Database {
		// Safe: middleware guarantees context.state === 'unlocked' before these run
		if (!context.db) throw new Error("db not available");
		return context.db;
	}

	function getScheduler() {
		if (!context.scheduler) throw new Error("scheduler not available");
		return context.scheduler;
	}

	function getSearch() {
		return new MessageSearch(getDb());
	}

	// List accounts
	api.get("/accounts", (c) => {
		const accounts = getDb()
			.prepare(
				"SELECT id, name, email, imap_host, smtp_host, created_at FROM accounts ORDER BY name",
			)
			.all();
		return c.json(accounts);
	});

	// Create account
	api.post("/accounts", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		if (!body.name || !body.email || !body.imap_host || !body.imap_user || !body.imap_pass) {
			return c.json(
				{ error: "Missing required fields: name, email, imap_host, imap_user, imap_pass" },
				400,
			);
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

	// Get single account (includes all fields except passwords)
	api.get("/accounts/:accountId", (c) => {
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

	// Update account
	api.put("/accounts/:accountId", async (c) => {
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

	// Delete account (cascades to folders, messages, etc.)
	api.delete("/accounts/:accountId", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const result = getDb().prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
		if (result.changes === 0) return c.json({ error: "Account not found" }, 404);
		return c.json({ ok: true });
	});

	// Get sync status for an account
	api.get("/accounts/:accountId/sync-status", (c) => {
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

	// List folders for an account
	api.get("/accounts/:accountId/folders", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const folders = getDb()
			.prepare(
				"SELECT id, path, name, special_use, message_count, unread_count, last_synced_at FROM folders WHERE account_id = ? ORDER BY path",
			)
			.all(accountId);
		return c.json(folders);
	});

	// List messages in a folder
	api.get("/accounts/:accountId/folders/:folderId/messages", (c) => {
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

	// Get a single message
	api.get("/messages/:messageId", (c) => {
		const messageId = Number(c.req.param("messageId"));
		const message = getDb()
			.prepare(`
			SELECT m.*, f.path as folder_path, f.name as folder_name
			FROM messages m
			JOIN folders f ON f.id = m.folder_id
			WHERE m.id = ?
		`)
			.get(messageId);

		if (!message) return c.json({ error: "Message not found" }, 404);
		return c.json(message);
	});

	// Get thread for a message
	api.get("/messages/:messageId/thread", (c) => {
		const db = getDb();
		const messageId = Number(c.req.param("messageId"));
		const message = db
			.prepare(
				'SELECT message_id, in_reply_to, "references", account_id FROM messages WHERE id = ?',
			)
			.get(messageId) as
			| {
					message_id: string | null;
					in_reply_to: string | null;
					references: string | null;
					account_id: number;
			  }
			| undefined;

		if (!message) return c.json({ error: "Message not found" }, 404);

		const threadIds = new Set<string>();
		if (message.message_id) threadIds.add(message.message_id);
		if (message.in_reply_to) threadIds.add(message.in_reply_to);
		if (message.references) {
			for (const ref of message.references.split(/\s+/)) {
				if (ref.trim()) threadIds.add(ref.trim());
			}
		}

		if (threadIds.size === 0) {
			const single = db
				.prepare(
					"SELECT m.*, f.path as folder_path, f.name as folder_name FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.id = ?",
				)
				.get(messageId);
			return c.json(single ? [single] : []);
		}

		const placeholders = [...threadIds].map(() => "?").join(",");
		const thread = db
			.prepare(`
				SELECT m.*, f.path as folder_path, f.name as folder_name
				FROM messages m
				JOIN folders f ON f.id = m.folder_id
				WHERE m.account_id = ?
				AND (m.message_id IN (${placeholders})
					OR m.in_reply_to IN (${placeholders})
					OR m.id = ?)
				ORDER BY m.date ASC
			`)
			.all(message.account_id, ...[...threadIds], ...[...threadIds], messageId);

		return c.json(thread);
	});

	// Update message flags
	api.patch("/messages/:messageId/flags", async (c) => {
		const db = getDb();
		const messageId = Number(c.req.param("messageId"));
		const body = await c.req.json();
		const { add, remove } = body as { add?: string[]; remove?: string[] };

		const message = db.prepare("SELECT flags FROM messages WHERE id = ?").get(messageId) as
			| { flags: string | null }
			| undefined;
		if (!message) return c.json({ error: "Message not found" }, 404);

		const flags = new Set((message.flags ?? "").split(",").filter(Boolean));
		if (add) for (const f of add) flags.add(f);
		if (remove) for (const f of remove) flags.delete(f);

		const newFlags = [...flags].join(",");
		db.prepare("UPDATE messages SET flags = ? WHERE id = ?").run(newFlags, messageId);
		return c.json({ ok: true, flags: newFlags });
	});

	// Move a message to a different folder
	api.post("/messages/:messageId/move", async (c) => {
		const db = getDb();
		const messageId = Number(c.req.param("messageId"));
		const body = await c.req.json();
		const folderId = body.folder_id;
		if (!folderId) return c.json({ error: "folder_id is required" }, 400);

		const message = db.prepare("SELECT id FROM messages WHERE id = ?").get(messageId);
		if (!message) return c.json({ error: "Message not found" }, 404);

		const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(folderId);
		if (!folder) return c.json({ error: "Folder not found" }, 404);

		db.prepare("UPDATE messages SET folder_id = ? WHERE id = ?").run(folderId, messageId);
		return c.json({ ok: true });
	});

	// Delete a message
	api.delete("/messages/:messageId", (c) => {
		const messageId = Number(c.req.param("messageId"));
		const result = getDb().prepare("DELETE FROM messages WHERE id = ?").run(messageId);
		if (result.changes === 0) return c.json({ error: "Message not found" }, 404);
		return c.json({ ok: true });
	});

	// Bulk operations on multiple messages
	api.post("/messages/bulk", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		const { ids, action, add, remove, folder_id } = body as {
			ids: number[];
			action: "delete" | "flag" | "move";
			add?: string[];
			remove?: string[];
			folder_id?: number;
		};

		if (!Array.isArray(ids) || ids.length === 0)
			return c.json({ error: "ids must be a non-empty array" }, 400);
		if (!["delete", "flag", "move"].includes(action))
			return c.json({ error: "action must be delete, flag, or move" }, 400);

		const placeholders = ids.map(() => "?").join(",");

		if (action === "delete") {
			const matched = (
				db
					.prepare(`SELECT COUNT(*) as n FROM messages WHERE id IN (${placeholders})`)
					.get(...ids) as { n: number }
			).n;
			db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
			return c.json({ ok: true, count: matched });
		}

		if (action === "flag") {
			if (!add && !remove) return c.json({ error: "add or remove flags required" }, 400);
			const updateFlag = db.transaction(() => {
				let changed = 0;
				const rows = db
					.prepare(`SELECT id, flags FROM messages WHERE id IN (${placeholders})`)
					.all(...ids) as { id: number; flags: string | null }[];
				for (const row of rows) {
					const flags = new Set((row.flags ?? "").split(",").filter(Boolean));
					if (add) for (const f of add) flags.add(f);
					if (remove) for (const f of remove) flags.delete(f);
					db.prepare("UPDATE messages SET flags = ? WHERE id = ?").run(
						[...flags].join(","),
						row.id,
					);
					changed++;
				}
				return changed;
			});
			const count = updateFlag();
			return c.json({ ok: true, count });
		}

		// action === "move"
		if (!folder_id) return c.json({ error: "folder_id is required for move" }, 400);
		const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(folder_id);
		if (!folder) return c.json({ error: "Folder not found" }, 404);
		const matched = (
			db
				.prepare(`SELECT COUNT(*) as n FROM messages WHERE id IN (${placeholders})`)
				.get(...ids) as { n: number }
		).n;
		db.prepare(`UPDATE messages SET folder_id = ? WHERE id IN (${placeholders})`).run(
			folder_id,
			...ids,
		);
		return c.json({ ok: true, count: matched });
	});

	// List attachments for a message
	api.get("/messages/:messageId/attachments", (c) => {
		const messageId = Number(c.req.param("messageId"));
		const attachments = getDb()
			.prepare(
				"SELECT id, filename, content_type, size, content_id FROM attachments WHERE message_id = ? ORDER BY id",
			)
			.all(messageId);
		return c.json(attachments);
	});

	// Download a single attachment
	api.get("/attachments/:attachmentId", (c) => {
		const attachmentId = Number(c.req.param("attachmentId"));
		const attachment = getDb()
			.prepare("SELECT filename, content_type, data FROM attachments WHERE id = ?")
			.get(attachmentId) as
			| { filename: string | null; content_type: string | null; data: Buffer | null }
			| undefined;
		if (!attachment) return c.json({ error: "Attachment not found" }, 404);

		const contentType = attachment.content_type ?? "application/octet-stream";
		const rawName = attachment.filename ?? "attachment";
		const safeName = rawName
			.replace(/[/\\]/g, "_")
			.replace(/["\r\n]/g, "")
			.replace(/[^\x20-\x7E]/g, "_");
		return new Response(attachment.data, {
			headers: {
				"Content-Type": contentType,
				"Content-Disposition": `attachment; filename="${safeName}"`,
			},
		});
	});

	// ─── Labels ─────────────────────────────────────────────────────────────

	api.get("/accounts/:accountId/labels", (c) => {
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

	api.post("/accounts/:accountId/labels", async (c) => {
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

	api.put("/labels/:labelId", async (c) => {
		const db = getDb();
		const labelId = Number(c.req.param("labelId"));
		const body = await c.req.json();

		const sets: string[] = [];
		const values: (string | null)[] = [];
		if ("name" in body) {
			sets.push("name = ?");
			values.push(body.name);
		}
		if ("color" in body) {
			sets.push("color = ?");
			values.push(body.color);
		}
		if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);

		values.push(String(labelId));
		const result = db
			.prepare(`UPDATE labels SET ${sets.join(", ")} WHERE id = ?`)
			.run(...(values as [string | null, ...Array<string | null>]));
		if (result.changes === 0) return c.json({ error: "Label not found" }, 404);
		return c.json({ ok: true });
	});

	api.delete("/labels/:labelId", (c) => {
		const labelId = Number(c.req.param("labelId"));
		const result = getDb().prepare("DELETE FROM labels WHERE id = ?").run(labelId);
		if (result.changes === 0) return c.json({ error: "Label not found" }, 404);
		return c.json({ ok: true });
	});

	api.get("/labels/:labelId/messages", (c) => {
		const labelId = Number(c.req.param("labelId"));
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);

		const messages = getDb()
			.prepare(`
				SELECT m.id, m.uid, m.message_id, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview
				FROM messages m
				JOIN message_labels ml ON ml.message_id = m.id
				WHERE ml.label_id = ?
				ORDER BY m.date DESC
				LIMIT ? OFFSET ?
			`)
			.all(labelId, limit, offset);

		return c.json(messages);
	});

	api.post("/messages/:messageId/labels", async (c) => {
		const db = getDb();
		const messageId = Number(c.req.param("messageId"));
		const body = await c.req.json();
		const labelIds = body.label_ids as number[];
		if (!Array.isArray(labelIds) || labelIds.length === 0) {
			return c.json({ error: "label_ids array is required" }, 400);
		}

		const message = db.prepare("SELECT id FROM messages WHERE id = ?").get(messageId);
		if (!message) return c.json({ error: "Message not found" }, 404);

		const insert = db.prepare(
			"INSERT OR IGNORE INTO message_labels (message_id, label_id) VALUES (?, ?)",
		);
		const insertMany = db.transaction(() => {
			for (const labelId of labelIds) {
				insert.run(messageId, labelId);
			}
		});
		insertMany();

		return c.json({ ok: true });
	});

	api.delete("/messages/:messageId/labels/:labelId", (c) => {
		const db = getDb();
		const messageId = Number(c.req.param("messageId"));
		const labelId = Number(c.req.param("labelId"));
		db.prepare("DELETE FROM message_labels WHERE message_id = ? AND label_id = ?").run(
			messageId,
			labelId,
		);
		return c.json({ ok: true });
	});

	api.get("/messages/:messageId/labels", (c) => {
		const messageId = Number(c.req.param("messageId"));
		const labels = getDb()
			.prepare(`
				SELECT l.id, l.name, l.color, l.source
				FROM labels l
				JOIN message_labels ml ON ml.label_id = l.id
				WHERE ml.message_id = ?
				ORDER BY l.name
			`)
			.all(messageId);
		return c.json(labels);
	});

	// Search messages
	api.get("/search", (c) => {
		const query = c.req.query("q");
		if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

		const accountId = c.req.query("account_id") ? Number(c.req.query("account_id")) : undefined;
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);

		const results = getSearch().search(query, { accountId, limit, offset });
		return c.json(results);
	});

	// Trigger sync for an account
	api.post("/accounts/:accountId/sync", async (c) => {
		const accountId = Number(c.req.param("accountId"));
		try {
			const result = await getScheduler().syncNow(accountId);
			return c.json(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: message }, 500);
		}
	});

	// Get sync status for all accounts
	api.get("/sync/status", (c) => {
		const status = getScheduler().getStatus();
		const entries: Record<string, unknown> = {};
		for (const [accountId, s] of status) {
			entries[String(accountId)] = s;
		}
		return c.json(entries);
	});

	app.route("/api", api);

	// SPA fallback — serve index.html for all non-API, non-asset routes
	app.get("*", serveStatic({ root: "./frontend/dist", path: "index.html" }));

	return { app };
}
