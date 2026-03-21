import type Database from "@signalapp/better-sqlite3";

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
	accountId?: number;
	folderId?: number;
	limit?: number;
	offset?: number;
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
	 * Supports FTS5 query syntax (AND, OR, NOT, phrase matching with quotes).
	 */
	search(query: string, options: SearchOptions = {}): SearchResult[] {
		const { accountId, folderId, limit = 50, offset = 0 } = options;

		const conditions: string[] = [];
		const params: (string | number)[] = [query];

		if (accountId) {
			conditions.push("m.account_id = ?");
			params.push(accountId);
		}
		if (folderId) {
			conditions.push("m.folder_id = ?");
			params.push(folderId);
		}

		const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

		params.push(limit, offset);

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
			WHERE messages_fts MATCH ?
			${whereClause}
			ORDER BY rank
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
