import type Database from "better-sqlite3-multiple-ciphers";

export interface SearchResult {
	id: number;
	subject: string;
	from_address: string;
	from_name: string;
	date: string;
	snippet: string;
	folder_path: string;
	rank: number;
}

export interface SearchOptions {
	inboundConnectorId?: number;
	folderId?: number;
	limit?: number;
	offset?: number;
}

interface ParsedQuery {
	ftsQuery: string;
	filters: SearchFilter[];
}

interface SearchFilter {
	type: "from" | "to" | "subject" | "has" | "is" | "before" | "after" | "label";
	value: string;
}

/**
 * Parse Gmail-style search operators from a query string.
 *
 * Supported operators:
 *   from:user@example.com   — match sender address or name
 *   to:user@example.com     — match recipient address
 *   subject:hello           — match subject (use quotes for phrases: subject:"hello world")
 *   has:attachment           — messages with attachments
 *   is:unread               — unread messages
 *   is:starred              — starred/flagged messages
 *   is:read                 — read messages
 *   before:2024-01-15       — messages before a date (YYYY-MM-DD)
 *   after:2024-01-15        — messages after a date (YYYY-MM-DD)
 *   label:inbox             — messages with a specific label
 *
 * Remaining text after operator extraction is passed to FTS5.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
	const filters: SearchFilter[] = [];
	// Match operator:value or operator:"quoted value"
	const operatorRegex = /\b(from|to|subject|has|is|before|after|label):((?:"[^"]*")|(?:\S+))/gi;

	const ftsQuery = raw
		.replace(operatorRegex, (_, op: string, val: string) => {
			const cleanVal = val.replace(/^"|"$/g, "");
			const type = op.toLowerCase() as SearchFilter["type"];
			filters.push({ type, value: cleanVal });
			return "";
		})
		.replace(/\s+/g, " ")
		.trim();

	return { ftsQuery, filters };
}

/**
 * Full-text search across synced messages using SQLite FTS5.
 */
export class MessageSearch {
	private db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
	}

	/**
	 * Search messages by query string.
	 * Supports FTS5 query syntax (AND, OR, NOT, phrase matching with quotes)
	 * and Gmail-style operators (from:, to:, subject:, has:, is:, before:, after:, label:).
	 */
	search(query: string, options: SearchOptions = {}): SearchResult[] {
		const { inboundConnectorId, folderId, limit = 50, offset = 0 } = options;
		const { ftsQuery, filters } = parseSearchQuery(query);

		const conditions: string[] = [];
		const params: (string | number)[] = [];
		const joins: string[] = [];
		let useFts = false;

		// Only MATCH on FTS if there's remaining text
		if (ftsQuery) {
			useFts = true;
			params.push(ftsQuery);
		}

		if (inboundConnectorId) {
			conditions.push("m.inbound_connector_id = ?");
			params.push(inboundConnectorId);
		}
		if (folderId) {
			conditions.push("m.folder_id = ?");
			params.push(folderId);
		}

		for (const filter of filters) {
			switch (filter.type) {
				case "from":
					conditions.push(
						"(m.from_address LIKE ? COLLATE NOCASE OR m.from_name LIKE ? COLLATE NOCASE)",
					);
					params.push(`%${filter.value}%`, `%${filter.value}%`);
					break;
				case "to":
					conditions.push(
						"(m.to_addresses LIKE ? COLLATE NOCASE OR m.cc_addresses LIKE ? COLLATE NOCASE)",
					);
					params.push(`%${filter.value}%`, `%${filter.value}%`);
					break;
				case "subject":
					conditions.push("m.subject LIKE ? COLLATE NOCASE");
					params.push(`%${filter.value}%`);
					break;
				case "has":
					if (filter.value.toLowerCase() === "attachment") {
						conditions.push("m.has_attachments > 0");
					}
					break;
				case "is":
					switch (filter.value.toLowerCase()) {
						case "unread":
							conditions.push("(m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%')");
							break;
						case "read":
							conditions.push("m.flags LIKE '%\\Seen%'");
							break;
						case "starred":
							conditions.push("m.flags LIKE '%\\Flagged%'");
							break;
					}
					break;
				case "before":
					conditions.push("m.date < ?");
					params.push(filter.value);
					break;
				case "after":
					conditions.push("m.date > ?");
					params.push(filter.value);
					break;
				case "label":
					joins.push(
						"JOIN message_labels ml_filter ON ml_filter.message_id = m.id JOIN labels l_filter ON l_filter.id = ml_filter.label_id AND l_filter.name LIKE ? COLLATE NOCASE",
					);
					params.push(filter.value);
					break;
			}
		}

		params.push(limit, offset);

		if (useFts) {
			// FTS query with optional filters
			const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
			const joinClause = joins.join(" ");

			const stmt = this.db.prepare(`
				SELECT
					m.id,
					m.subject,
					m.from_address,
					m.from_name,
					m.date,
					snippet(messages_fts, 4, '<mark>', '</mark>', '...', 40) as snippet,
					f.path as folder_path,
					rank
				FROM messages_fts
				JOIN messages m ON m.id = messages_fts.rowid
				JOIN folders f ON f.id = m.folder_id
				${joinClause}
				WHERE messages_fts MATCH ?
				${whereClause}
				ORDER BY rank
				LIMIT ? OFFSET ?
			`);

			return stmt.all(...params) as SearchResult[];
		}

		// Filter-only query (no FTS text) — search by conditions only
		if (conditions.length === 0 && joins.length === 0) {
			return [];
		}

		const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
		const joinClause = joins.join(" ");

		const stmt = this.db.prepare(`
			SELECT
				m.id,
				m.subject,
				m.from_address,
				m.from_name,
				m.date,
				SUBSTR(m.text_body, 1, 200) as snippet,
				f.path as folder_path,
				0 as rank
			FROM messages m
			JOIN folders f ON f.id = m.folder_id
			${joinClause}
			WHERE ${whereClause}
			ORDER BY m.date DESC
			LIMIT ? OFFSET ?
		`);

		return stmt.all(...params) as SearchResult[];
	}

	/**
	 * Rebuild the FTS index from scratch.
	 * Useful after bulk imports or schema changes.
	 */
	rebuildIndex(): void {
		this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')");
	}
}
