import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";

interface DraftRow {
	id: number;
	account_id: number;
	to_addresses: string | null;
	cc_addresses: string | null;
	bcc_addresses: string | null;
	subject: string | null;
	text_body: string | null;
	html_body: string | null;
	in_reply_to: string | null;
	references: string | null;
	original_message_id: number | null;
	compose_mode: string;
	created_at: string;
	updated_at: string;
}

export function draftRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	/** GET /drafts?account_id=N — list drafts for an account */
	api.get("/", (c) => {
		const accountId = Number(c.req.query("account_id"));
		if (!accountId) return c.json({ error: "account_id query parameter is required" }, 400);

		const drafts = getDb()
			.prepare(
				`SELECT id, account_id, to_addresses, cc_addresses, bcc_addresses,
					subject, SUBSTR(text_body, 1, 200) as preview,
					compose_mode, original_message_id, created_at, updated_at
				 FROM drafts WHERE account_id = ? ORDER BY updated_at DESC`,
			)
			.all(accountId);
		return c.json(drafts);
	});

	/** GET /drafts/:id — get a single draft */
	api.get("/:id", (c) => {
		const id = Number(c.req.param("id"));
		const draft = getDb().prepare("SELECT * FROM drafts WHERE id = ?").get(id) as
			| DraftRow
			| undefined;
		if (!draft) return c.json({ error: "Draft not found" }, 404);
		return c.json(draft);
	});

	/** POST /drafts — create a new draft */
	api.post("/", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		if (!body.account_id) return c.json({ error: "account_id is required" }, 400);

		const result = db
			.prepare(`
				INSERT INTO drafts (account_id, to_addresses, cc_addresses, bcc_addresses,
					subject, text_body, html_body, in_reply_to, "references",
					original_message_id, compose_mode)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				body.account_id,
				body.to_addresses ?? null,
				body.cc_addresses ?? null,
				body.bcc_addresses ?? null,
				body.subject ?? null,
				body.text_body ?? null,
				body.html_body ?? null,
				body.in_reply_to ?? null,
				body.references ?? null,
				body.original_message_id ?? null,
				body.compose_mode ?? "new",
			);
		return c.json({ id: Number(result.lastInsertRowid) }, 201);
	});

	/** PUT /drafts/:id — update an existing draft */
	api.put("/:id", async (c) => {
		const db = getDb();
		const id = Number(c.req.param("id"));
		const body = await c.req.json();

		const allowedFields = [
			"to_addresses",
			"cc_addresses",
			"bcc_addresses",
			"subject",
			"text_body",
			"html_body",
			"in_reply_to",
			"references",
			"original_message_id",
			"compose_mode",
		];
		const sets: string[] = [];
		const values: (string | number | null)[] = [];
		for (const field of allowedFields) {
			if (field in body) {
				sets.push(`${field === "references" ? '"references"' : field} = ?`);
				values.push(body[field] as string | number | null);
			}
		}
		if (sets.length === 0) return c.json({ error: "No fields to update" }, 400);

		sets.push("updated_at = datetime('now')");
		values.push(id);

		const result = db
			.prepare(`UPDATE drafts SET ${sets.join(", ")} WHERE id = ?`)
			.run(...(values as [string | number | null, ...Array<string | number | null>]));

		if (result.changes === 0) return c.json({ error: "Draft not found" }, 404);
		return c.json({ ok: true });
	});

	/** DELETE /drafts/:id — delete a draft */
	api.delete("/:id", (c) => {
		const id = Number(c.req.param("id"));
		const result = getDb().prepare("DELETE FROM drafts WHERE id = ?").run(id);
		if (result.changes === 0) return c.json({ error: "Draft not found" }, 404);
		return c.json({ ok: true });
	});

	return api;
}
