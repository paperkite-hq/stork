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

		// Resolve the inbox label_id once (labels table is tiny).
		// Then JOIN using the covering index (label_id, date DESC) on message_labels
		// so SQLite can return rows in date order without a sort step — O(LIMIT) I/Os
		// instead of O(inbox size) for the materialise-and-sort approach.
		const db = getDb();
		const inboxLabel = db
			.prepare("SELECT id FROM labels WHERE LOWER(name) = 'inbox' LIMIT 1")
			.get() as { id: number } | undefined;

		if (!inboxLabel) return c.json([]);

		const messages = db
			.prepare(
				`SELECT m.id, m.uid, m.message_id, m.in_reply_to, m.subject, m.from_address, m.from_name,
					m.to_addresses, m.date, m.flags, m.size, m.has_attachments,
					SUBSTR(m.text_body, 1, 200) as preview, m.inbound_connector_id
				FROM message_labels ml
				JOIN messages m ON m.id = ml.message_id
				WHERE ml.label_id = ?
				ORDER BY ml.date DESC
				LIMIT ? OFFSET ?`,
			)
			.all(inboxLabel.id, limit, offset);

		return c.json(messages);
	});

	// Unified inbox count: total + unread across all identities' inboxes.
	// Used for the sidebar badge on the "All Inboxes" virtual view.
	// Uses cached message_count / unread_count from the labels table (O(1) lookup)
	// instead of a full JOIN across message_labels × messages (O(inbox size)).
	// Falls back to a live count if the cache is 0 and may be uninitialized
	// (before the first sync cycle populates the cache).
	api.get("/unified/count", (c) => {
		const db = getDb();
		const cached = db
			.prepare(
				`SELECT
					COALESCE(SUM(message_count), 0) as total,
					COALESCE(SUM(unread_count), 0) as unread
				FROM labels
				WHERE LOWER(name) = 'inbox'`,
			)
			.get() as { total: number; unread: number };

		if (cached.total > 0) {
			return c.json({ total: cached.total, unread: cached.unread ?? 0 });
		}

		// Cache shows 0 — could be empty inbox or uninitialized cache (pre-first-sync).
		// Do a live count; on an empty inbox this is instant, on a large inbox this
		// only happens before refreshLabelCounts() has run for the first time.
		const inboxLabel = db
			.prepare("SELECT id FROM labels WHERE LOWER(name) = 'inbox' LIMIT 1")
			.get() as { id: number } | undefined;
		if (!inboxLabel) return c.json({ total: 0, unread: 0 });

		const row = db
			.prepare(
				`SELECT
					COUNT(*) as total,
					SUM(CASE WHEN m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END) as unread
				FROM message_labels ml
				JOIN messages m ON m.id = ml.message_id
				WHERE ml.label_id = ?`,
			)
			.get(inboxLabel.id) as { total: number; unread: number };

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
				`SELECT m.id, m.uid, m.message_id, m.in_reply_to, m.subject, m.from_address, m.from_name,
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
	// Uses cached per-connector counts (O(connectors)) when available; falls back
	// to a live full-table scan on first run before any sync cycle has completed.
	api.get("/all-messages/count", (c) => {
		const db = getDb();

		// Check if cached counts are populated (NULL means no sync has run yet)
		const cacheRow = db
			.prepare(
				`SELECT
					SUM(cached_message_count) as total,
					SUM(cached_unread_count) as unread
				FROM inbound_connectors
				WHERE cached_message_count IS NOT NULL`,
			)
			.get() as { total: number | null; unread: number | null };

		if (cacheRow.total !== null) {
			return c.json({ total: cacheRow.total ?? 0, unread: cacheRow.unread ?? 0 });
		}

		// Fallback: live count (slow on large DBs, but only until first sync completes)
		const row = db
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
				`SELECT m.id, m.uid, m.message_id, m.in_reply_to, m.subject, m.from_address, m.from_name,
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
	// Uses cached per-connector unread_count (O(connectors)) when available.
	api.get("/unread-messages/count", (c) => {
		const db = getDb();

		const cacheRow = db
			.prepare(
				`SELECT SUM(cached_unread_count) as total
				FROM inbound_connectors
				WHERE cached_unread_count IS NOT NULL`,
			)
			.get() as { total: number | null };

		if (cacheRow.total !== null) {
			return c.json({ total: cacheRow.total ?? 0 });
		}

		// Fallback: live count (slow on large DBs, only until first sync completes)
		const row = db
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
