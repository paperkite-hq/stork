import { Hono } from "hono";
import type { SyncScheduler } from "../../sync/sync-scheduler.js";

export function syncRoutes(getScheduler: () => SyncScheduler): Hono {
	const api = new Hono();

	api.get("/status", (c) => {
		const status = getScheduler().getStatus();
		const entries: Record<string, unknown> = {};
		for (const [accountId, s] of status) {
			entries[String(accountId)] = s;
		}
		return c.json(entries);
	});

	return api;
}
