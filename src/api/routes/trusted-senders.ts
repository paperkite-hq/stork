import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";

/** Routes for managing per-account image trusted senders.
 *  Trusted senders have their remote images loaded automatically —
 *  tracking pixels are still stripped regardless of trust status. */
export function trustedSenderRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	// List trusted senders for an account
	api.get("/accounts/:accountId/trusted-senders", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const rows = getDb()
			.prepare(
				"SELECT id, sender_address, created_at FROM image_trusted_senders WHERE account_id = ? ORDER BY sender_address",
			)
			.all(accountId);
		return c.json(rows);
	});

	// Check if a specific sender is trusted for an account
	api.get("/accounts/:accountId/trusted-senders/check", (c) => {
		const accountId = Number(c.req.param("accountId"));
		const sender = c.req.query("sender");
		if (!sender) return c.json({ error: "sender query param required" }, 400);

		const normalized = sender.toLowerCase().trim();
		const row = getDb()
			.prepare("SELECT id FROM image_trusted_senders WHERE account_id = ? AND sender_address = ?")
			.get(accountId, normalized);
		return c.json({ trusted: !!row });
	});

	// Add a trusted sender
	api.post("/accounts/:accountId/trusted-senders", async (c) => {
		const db = getDb();
		const accountId = Number(c.req.param("accountId"));
		const body = await c.req.json();
		if (!body.sender_address) return c.json({ error: "sender_address is required" }, 400);

		const normalized = String(body.sender_address).toLowerCase().trim();
		if (!normalized.includes("@")) return c.json({ error: "Invalid email address" }, 400);

		try {
			const result = db
				.prepare("INSERT INTO image_trusted_senders (account_id, sender_address) VALUES (?, ?)")
				.run(accountId, normalized);
			return c.json({ id: Number(result.lastInsertRowid) }, 201);
		} catch (err) {
			if (String(err).includes("UNIQUE constraint")) {
				return c.json({ error: "Sender already trusted" }, 409);
			}
			throw err;
		}
	});

	// Remove a trusted sender
	api.delete("/trusted-senders/:id", (c) => {
		const id = Number(c.req.param("id"));
		const result = getDb().prepare("DELETE FROM image_trusted_senders WHERE id = ?").run(id);
		if (result.changes === 0) return c.json({ error: "Trusted sender not found" }, 404);
		return c.json({ ok: true });
	});

	// Remove a trusted sender by address (convenience endpoint)
	api.delete("/accounts/:accountId/trusted-senders", async (c) => {
		const accountId = Number(c.req.param("accountId"));
		const body = await c.req.json();
		if (!body.sender_address) return c.json({ error: "sender_address is required" }, 400);

		const normalized = String(body.sender_address).toLowerCase().trim();
		const result = getDb()
			.prepare("DELETE FROM image_trusted_senders WHERE account_id = ? AND sender_address = ?")
			.run(accountId, normalized);
		if (result.changes === 0) return c.json({ error: "Sender not in trusted list" }, 404);
		return c.json({ ok: true });
	});

	return api;
}
