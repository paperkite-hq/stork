import type Database from "@signalapp/better-sqlite3";
import { Hono } from "hono";
import { MessageSearch } from "../../search/search.js";

export function searchRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const query = c.req.query("q");
		if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

		const accountId = c.req.query("account_id") ? Number(c.req.query("account_id")) : undefined;
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);

		const search = new MessageSearch(getDb());
		const results = search.search(query, { accountId, limit, offset });
		return c.json(results);
	});

	return api;
}
