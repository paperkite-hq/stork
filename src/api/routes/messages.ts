import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { ImapIngestConnector } from "../../connectors/imap.js";
import { parseIntParam } from "../validation.js";

interface ImapAccountInfo {
	uid: number;
	folder_path: string;
	imap_host: string;
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	imap_pass: string;
}

/** Deletes messages from an IMAP server. Injectable for testing. */
export type ImapDeleteFn = (info: ImapAccountInfo, uids: number[]) => Promise<void>;

async function defaultImapDelete(info: ImapAccountInfo, uids: number[]): Promise<void> {
	const connector = new ImapIngestConnector({
		host: info.imap_host,
		port: info.imap_port,
		secure: info.imap_tls === 1,
		auth: { user: info.imap_user, pass: info.imap_pass },
	});
	await connector.connect();
	try {
		await connector.deleteMessages(info.folder_path, uids);
	} finally {
		await connector.disconnect();
	}
}

export function messageRoutes(
	getDb: () => Database.Database,
	imapDelete: ImapDeleteFn = defaultImapDelete,
): Hono {
	const api = new Hono();

	api.get("/:messageId", (c) => {
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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

	api.get("/:messageId/thread", (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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
			// IMAP sync stores references as JSON array, send route stores space-separated
			let refs: string[];
			const trimmed = message.references.trim();
			if (trimmed.startsWith("[")) {
				try {
					const parsed = JSON.parse(trimmed);
					refs = Array.isArray(parsed) ? parsed : [trimmed];
				} catch {
					refs = trimmed.split(/\s+/);
				}
			} else {
				refs = trimmed.split(/\s+/);
			}
			for (const ref of refs) {
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
				SELECT DISTINCT m.*, f.path as folder_path, f.name as folder_name
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

	api.patch("/:messageId/flags", async (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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

	api.post("/:messageId/move", async (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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

	api.delete("/:messageId", async (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;

		// Fetch message with folder and account info for optional server-side deletion
		const message = db
			.prepare(
				`SELECT m.uid, f.path AS folder_path,
				        a.ingest_connector_type, a.sync_delete_from_server,
				        a.imap_host, a.imap_port, a.imap_tls, a.imap_user, a.imap_pass
				 FROM messages m
				 JOIN folders f ON f.id = m.folder_id
				 JOIN accounts a ON a.id = m.account_id
				 WHERE m.id = ?`,
			)
			.get(messageId) as
			| (ImapAccountInfo & {
					ingest_connector_type: string;
					sync_delete_from_server: number;
			  })
			| undefined;

		if (!message) return c.json({ error: "Message not found" }, 404);

		// Delete from IMAP server when the account is IMAP and sync deletions is enabled
		if (message.ingest_connector_type === "imap" && message.sync_delete_from_server === 1) {
			try {
				await imapDelete(message, [message.uid]);
			} catch (err) {
				console.error("Failed to delete message from IMAP server:", err);
				// Fall through — delete locally even if server delete fails
			}
		}

		const result = db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
		if (result.changes === 0) return c.json({ error: "Message not found" }, 404);
		return c.json({ ok: true });
	});

	api.post("/bulk", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		const { ids, action, add, remove, folder_id, label_id } = body as {
			ids: number[];
			action: "delete" | "flag" | "move" | "remove_label";
			add?: string[];
			remove?: string[];
			folder_id?: number;
			label_id?: number;
		};

		if (!Array.isArray(ids) || ids.length === 0)
			return c.json({ error: "ids must be a non-empty array" }, 400);
		if (!ids.every((id) => typeof id === "number" && Number.isFinite(id) && id > 0))
			return c.json({ error: "ids must contain only positive integers" }, 400);
		if (!["delete", "flag", "move", "remove_label"].includes(action))
			return c.json({ error: "action must be delete, flag, move, or remove_label" }, 400);

		const placeholders = ids.map(() => "?").join(",");

		if (action === "delete") {
			// Fetch messages with folder/account info for server-side deletion
			const toDelete = db
				.prepare(
					`SELECT m.id, m.uid, f.path AS folder_path,
					        a.ingest_connector_type, a.sync_delete_from_server,
					        a.imap_host, a.imap_port, a.imap_tls, a.imap_user, a.imap_pass
					 FROM messages m
					 JOIN folders f ON f.id = m.folder_id
					 JOIN accounts a ON a.id = m.account_id
					 WHERE m.id IN (${placeholders})`,
				)
				.all(...ids) as (ImapAccountInfo & {
				id: number;
				ingest_connector_type: string;
				sync_delete_from_server: number;
			})[];

			// Group IMAP messages by folder for efficient server-side deletion
			const imapByFolder = new Map<string, ImapAccountInfo & { folderKey: string }[]>();
			for (const msg of toDelete) {
				if (msg.ingest_connector_type === "imap" && msg.sync_delete_from_server === 1) {
					const key = `${msg.imap_host}:${msg.imap_port}:${msg.imap_user}:${msg.folder_path}`;
					if (!imapByFolder.has(key)) imapByFolder.set(key, []);
					imapByFolder.get(key)?.push({ ...msg, folderKey: key });
				}
			}

			// Delete from IMAP server (best-effort — failures don't block local delete)
			for (const group of imapByFolder.values()) {
				const first = group[0];
				const uids = group.map((m) => m.uid);
				try {
					await imapDelete(first, uids);
				} catch (err) {
					console.error("Failed to bulk-delete messages from IMAP server:", err);
				}
			}

			db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
			return c.json({ ok: true, count: toDelete.length });
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

		if (action === "remove_label") {
			if (!label_id) return c.json({ error: "label_id is required for remove_label" }, 400);
			const result = db
				.prepare(
					`DELETE FROM message_labels WHERE label_id = ? AND message_id IN (${placeholders})`,
				)
				.run(label_id, ...ids);
			return c.json({ ok: true, count: result.changes });
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

	api.get("/:messageId/attachments", (c) => {
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
		const attachments = getDb()
			.prepare(
				"SELECT id, filename, content_type, size, content_id FROM attachments WHERE message_id = ? ORDER BY id",
			)
			.all(messageId);
		return c.json(attachments);
	});

	api.get("/:messageId/labels", (c) => {
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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

	api.post("/:messageId/labels", async (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
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

	api.delete("/:messageId/labels/:labelId", (c) => {
		const db = getDb();
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
		const labelId = parseIntParam(c, "labelId", c.req.param("labelId"));
		if (labelId instanceof Response) return labelId;
		db.prepare("DELETE FROM message_labels WHERE message_id = ? AND label_id = ?").run(
			messageId,
			labelId,
		);
		return c.json({ ok: true });
	});

	return api;
}
