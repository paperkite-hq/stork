import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { MessageSearch } from "../../search/search.js";
import { parsePagination } from "../validation.js";

export function searchRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const query = c.req.query("q");
		if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

		const rawAccountId = c.req.query("account_id");
		let accountId: number | undefined;
		if (rawAccountId !== undefined) {
			accountId = Number(rawAccountId);
			if (!Number.isFinite(accountId) || accountId < 1) {
				return c.json({ error: "Invalid account_id: must be a positive integer" }, 400);
			}
		}
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const search = new MessageSearch(getDb());
		const results = search.search(query, { accountId, limit, offset });
		return c.json(results);
	});

	return api;
}
