import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import type { SyncScheduler } from "../../sync/sync-scheduler.js";

export function syncRoutes(
	getScheduler: () => SyncScheduler,
	getDb: () => Database.Database,
): Hono {
	const api = new Hono();

	api.get("/status", (c) => {
		const status = getScheduler().getStatus();
		const entries: Record<string, unknown> = {};
		for (const [identityId, s] of status) {
			entries[String(identityId)] = s;
		}
		return c.json(entries);
	});

	/**
	 * GET /api/sync/errors?identity_id=1&resolved=0&limit=100
	 *
	 * Returns recent sync errors, newest first.
	 * - identity_id: filter by identity (optional)
	 * - resolved: 0 for unresolved only, 1 for resolved only, omit for all
	 * - limit: max rows (default 100)
	 */
	api.get("/errors", (c) => {
		const db = getDb();
		const identityId = c.req.query("identity_id");
		const resolved = c.req.query("resolved");
		const limit = Math.min(Number(c.req.query("limit")) || 100, 1000);

		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (identityId) {
			conditions.push("identity_id = ?");
			params.push(Number(identityId));
		}
		if (resolved !== undefined && resolved !== "") {
			conditions.push("resolved = ?");
			params.push(Number(resolved));
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		params.push(limit);

		const rows = db
			.prepare(
				`SELECT id, identity_id, folder_path, uid, error_type, message,
				        retriable, resolved, retry_count, created_at, resolved_at
				 FROM sync_errors ${where}
				 ORDER BY created_at DESC
				 LIMIT ?`,
			)
			.all(...params);

		return c.json(rows);
	});

	return api;
}
