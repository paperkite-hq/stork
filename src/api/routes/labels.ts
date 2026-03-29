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
