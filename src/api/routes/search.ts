import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { MessageSearch } from "../../search/search.js";
import { parsePagination } from "../validation.js";

export function searchRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const query = c.req.query("q");
		if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

		const rawIdentityId = c.req.query("identity_id");
		let identityId: number | undefined;
		if (rawIdentityId !== undefined) {
			identityId = Number(rawIdentityId);
			if (!Number.isFinite(identityId) || identityId < 1) {
				return c.json({ error: "Invalid identity_id: must be a positive integer" }, 400);
			}
		}
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const search = new MessageSearch(getDb());
		const results = search.search(query, { identityId: identityId, limit, offset });
		return c.json(results);
	});

	return api;
}
