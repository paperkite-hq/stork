import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { parseIntParam } from "../validation.js";

/** Routes for managing image trusted senders (global — not identity-scoped).
 *  Trusted senders have their remote images loaded automatically —
 *  tracking pixels are still stripped regardless of trust status. */
export function trustedSenderRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	// List all trusted senders
	api.get("/trusted-senders", (c) => {
		const rows = getDb()
			.prepare(
				"SELECT id, sender_address, created_at FROM image_trusted_senders ORDER BY sender_address",
			)
			.all();
		return c.json(rows);
	});

	// Check if a specific sender is trusted
	api.get("/trusted-senders/check", (c) => {
		const sender = c.req.query("sender");
		if (!sender) return c.json({ error: "sender query param required" }, 400);

		const normalized = sender.toLowerCase().trim();
		const row = getDb()
			.prepare("SELECT id FROM image_trusted_senders WHERE sender_address = ?")
			.get(normalized);
		return c.json({ trusted: !!row });
	});

	// Add a trusted sender
	api.post("/trusted-senders", async (c) => {
		const db = getDb();
		const body = await c.req.json();
		if (!body.sender_address) return c.json({ error: "sender_address is required" }, 400);

		const normalized = String(body.sender_address).toLowerCase().trim();
		if (!normalized.includes("@")) return c.json({ error: "Invalid email address" }, 400);

		try {
			const result = db
				.prepare("INSERT INTO image_trusted_senders (sender_address) VALUES (?)")
				.run(normalized);
			return c.json({ id: Number(result.lastInsertRowid) }, 201);
		} catch (err) {
			if (String(err).includes("UNIQUE constraint")) {
				return c.json({ error: "Sender already trusted" }, 409);
			}
			throw err;
		}
	});

	// Remove a trusted sender by ID
	api.delete("/trusted-senders/:id", (c) => {
		const id = parseIntParam(c, "id", c.req.param("id"));
		if (id instanceof Response) return id;
		const result = getDb().prepare("DELETE FROM image_trusted_senders WHERE id = ?").run(id);
		if (result.changes === 0) return c.json({ error: "Trusted sender not found" }, 404);
		return c.json({ ok: true });
	});

	return api;
}
