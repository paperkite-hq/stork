import type Database from "@signalapp/better-sqlite3";
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
		for (const [accountId, s] of status) {
			entries[String(accountId)] = s;
		}
		return c.json(entries);
	});

	/**
	 * GET /api/sync/errors?account_id=1&resolved=0&limit=100
	 *
	 * Returns recent sync errors, newest first.
	 * - account_id: filter by account (optional)
	 * - resolved: 0 for unresolved only, 1 for resolved only, omit for all
	 * - limit: max rows (default 100)
	 */
	api.get("/errors", (c) => {
		const db = getDb();
		const accountId = c.req.query("account_id");
		const resolved = c.req.query("resolved");
		const limit = Math.min(Number(c.req.query("limit")) || 100, 1000);

		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (accountId) {
			conditions.push("account_id = ?");
			params.push(Number(accountId));
		}
		if (resolved !== undefined && resolved !== "") {
			conditions.push("resolved = ?");
			params.push(Number(resolved));
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		params.push(limit);

		const rows = db
			.prepare(
				`SELECT id, account_id, folder_path, uid, error_type, message,
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
