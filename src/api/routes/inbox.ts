import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { parsePagination } from "../validation.js";

/**
 * Inbox routes — cross-identity unified views.
 * Mounted at /api/inbox in server.ts.
 */
export function inboxRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	// Unified inbox: inbox messages across ALL inbound connectors, sorted by date DESC.
	// Joins through message_labels → labels to find messages with an "inbox" label
	// (case-insensitive). Returns inbound_connector_id so the UI can show per-connector badges.
	api.get("/unified", (c) => {
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const messages = getDb()
			.prepare(
				`SELECT m.id, m.uid, m.message_id, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview, m.inbound_connector_id
				FROM messages m
				JOIN message_labels ml ON ml.message_id = m.id
				JOIN labels l ON l.id = ml.label_id AND LOWER(l.name) = 'inbox'
				ORDER BY m.date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(limit, offset);

		return c.json(messages);
	});

	// Unified inbox count: total + unread across all identities' inboxes.
	// Used for the sidebar badge on the "All Inboxes" virtual view.
	api.get("/unified/count", (c) => {
		const row = getDb()
			.prepare(
				`SELECT
					COUNT(*) as total,
					SUM(CASE WHEN m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END) as unread
				FROM messages m
				JOIN message_labels ml ON ml.message_id = m.id
				JOIN labels l ON l.id = ml.label_id AND LOWER(l.name) = 'inbox'`,
			)
			.get() as { total: number; unread: number };

		return c.json({ total: row.total ?? 0, unread: row.unread ?? 0 });
	});

	// Cross-identity all-messages: every message across ALL identities, sorted by date DESC.
	// Equivalent to "All Mail" but spanning identities — useful in multi-identity setups.
	api.get("/all-messages", (c) => {
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const messages = getDb()
			.prepare(
				`SELECT m.id, m.uid, m.message_id, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview, m.inbound_connector_id
				FROM messages m
				ORDER BY m.date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(limit, offset);

		return c.json(messages);
	});

	// Cross-identity all-messages count: total + unread across ALL identities.
	api.get("/all-messages/count", (c) => {
		const row = getDb()
			.prepare(
				`SELECT
					COUNT(*) as total,
					SUM(CASE WHEN flags IS NULL OR flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END) as unread
				FROM messages`,
			)
			.get() as { total: number; unread: number };

		return c.json({ total: row.total ?? 0, unread: row.unread ?? 0 });
	});

	// Cross-identity unread messages: all unread messages across ALL identities, sorted by date DESC.
	// Equivalent to "Unread" but spanning identities — useful in multi-identity setups.
	api.get("/unread-messages", (c) => {
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		const { limit, offset } = pagination;

		const messages = getDb()
			.prepare(
				`SELECT m.id, m.uid, m.message_id, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview, m.inbound_connector_id
				FROM messages m
				WHERE (m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%')
				ORDER BY m.date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(limit, offset);

		return c.json(messages);
	});

	// Cross-identity unread count: total unread across ALL identities.
	api.get("/unread-messages/count", (c) => {
		const row = getDb()
			.prepare(
				`SELECT COUNT(*) as total
				FROM messages
				WHERE (flags IS NULL OR flags NOT LIKE '%\\Seen%')`,
			)
			.get() as { total: number };

		return c.json({ total: row.total ?? 0 });
	});

	return api;
}
