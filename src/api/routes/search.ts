import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { MessageSearch } from "../../search/search.js";
import { parsePagination } from "../validation.js";

export function searchRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/", (c) => {
		const query = c.req.query("q");
		if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

		const rawConnectorId = c.req.query("inbound_connector_id");
		let inboundConnectorId: number | undefined;
		if (rawConnectorId !== undefined) {
			inboundConnectorId = Number(rawConnectorId);
			if (!Number.isFinite(inboundConnectorId) || inboundConnectorId < 1) {
				return c.json({ error: "Invalid inbound_connector_id: must be a positive integer" }, 400);
			}
		}
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const search = new MessageSearch(getDb());
		const results = search.search(query, { inboundConnectorId, limit, offset });
		return c.json(results);
	});

	return api;
}
