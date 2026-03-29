import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { parseIntParam, parsePagination } from "../validation.js";

export function labelRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	// Standalone list — all labels, no account filter (labels are instance-level)
	api.get("/", (c) => {
		const labels = getDb()
			.prepare(
				"SELECT id, name, color, source, created_at, message_count, unread_count FROM labels ORDER BY name",
			)
			.all();
		return c.json(labels);
	});

	// Standalone create — no account context needed
	api.post("/", async (c) => {
		const body = await c.req.json();
		if (!body.name) return c.json({ error: "name is required" }, 400);
		try {
			const result = getDb()
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

	api.put("/:labelId", async (c) => {
		const db = getDb();
		const labelId = parseIntParam(c, "labelId", c.req.param("labelId"));
		if (labelId instanceof Response) return labelId;
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

	api.delete("/:labelId", (c) => {
		const labelId = parseIntParam(c, "labelId", c.req.param("labelId"));
		if (labelId instanceof Response) return labelId;
		const result = getDb().prepare("DELETE FROM labels WHERE id = ?").run(labelId);
		if (result.changes === 0) return c.json({ error: "Label not found" }, 404);
		return c.json({ ok: true });
	});

	// Multi-label filter: returns messages matching ALL specified label IDs (intersection).
	// Usage: GET /api/labels/filter?ids=1,2,3&limit=50&offset=0
	api.get("/filter", (c) => {
		const idsParam = c.req.query("ids");
		if (!idsParam) return c.json({ error: "ids query parameter is required" }, 400);
		const ids = idsParam
			.split(",")
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isInteger(n) && n > 0);
		if (ids.length === 0) return c.json({ error: "At least one valid label ID is required" }, 400);

		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const placeholders = ids.map(() => "?").join(",");
		const messages = getDb()
			.prepare(`
				SELECT m.id, m.uid, m.message_id, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview, m.account_id
				FROM messages m
				WHERE (
					SELECT COUNT(DISTINCT ml.label_id)
					FROM message_labels ml
					WHERE ml.message_id = m.id AND ml.label_id IN (${placeholders})
				) = ?
				ORDER BY m.date DESC
				LIMIT ? OFFSET ?
			`)
			.all(...ids, ids.length, limit, offset);

		return c.json(messages);
	});

	// Multi-label filter count
	api.get("/filter/count", (c) => {
		const idsParam = c.req.query("ids");
		if (!idsParam) return c.json({ error: "ids query parameter is required" }, 400);
		const ids = idsParam
			.split(",")
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isInteger(n) && n > 0);
		if (ids.length === 0) return c.json({ error: "At least one valid label ID is required" }, 400);

		const placeholders = ids.map(() => "?").join(",");
		const row = getDb()
			.prepare(`
				SELECT
					COUNT(*) as total,
					SUM(CASE WHEN m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END) as unread
				FROM messages m
				WHERE (
					SELECT COUNT(DISTINCT ml.label_id)
					FROM message_labels ml
					WHERE ml.message_id = m.id AND ml.label_id IN (${placeholders})
				) = ?
			`)
			.all(...ids, ids.length) as Array<{ total: number; unread: number }>;

		const result = row[0] ?? { total: 0, unread: 0 };
		return c.json({ total: result.total ?? 0, unread: result.unread ?? 0 });
	});

	api.get("/:labelId/messages", (c) => {
		const labelId = parseIntParam(c, "labelId", c.req.param("labelId"));
		if (labelId instanceof Response) return labelId;
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

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

	return api;
}
