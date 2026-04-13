import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import Database from "better-sqlite3-multiple-ciphers";
import { htmlToText } from "./html-to-text.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

const DATA_DIR = process.env.STORK_DATA_DIR || "./data";

export function attachBlobsDb(db: Database.Database, blobsPath: string, vaultKey?: Buffer): void {
	const escapedPath = blobsPath.replace(/'/g, "''");
	if (vaultKey) {
		db.exec(`ATTACH DATABASE '${escapedPath}' AS blobs KEY "x'${vaultKey.toString("hex")}'"`);
	} else {
		db.exec(`ATTACH DATABASE '${escapedPath}' AS blobs`);
	}
	// Ensure the blobs table exists in the attached DB (idempotent)
	db.exec(
		`CREATE TABLE IF NOT EXISTS blobs.attachment_blobs (content_hash TEXT PRIMARY KEY, data BLOB NOT NULL)`,
	);
}

export function openDatabase(
	filename = "stork.db",
	dataDir = DATA_DIR,
	vaultKey?: Buffer,
): Database.Database {
	const dbPath = join(dataDir, filename);
	const db = new Database(dbPath);

	if (vaultKey) {
		// Supply raw 32-byte vault key as hex to SQLCipher (bypasses SQLCipher's PBKDF2)
		db.exec(`PRAGMA key = "x'${vaultKey.toString("hex")}'";`);
	}

	// Scale mmap_size based on DB file size and available RAM.
	// Cap at 50% of total system RAM so we don't crowd out other processes,
	// but don't exceed the file size (mapping more than the file wastes VA space).
	// Minimum 256 MB for small DBs. On a machine with 32 GB RAM and a 16 GB DB,
	// this maps the entire file; on a machine with 8 GB RAM it maps up to 4 GB
	// (25% of the DB — still far better than the old fixed 256 MB / 1.5%).
	let mmapSize = 268435456; // 256 MB default
	try {
		const fileSize = statSync(dbPath).size;
		const ramCap = Math.floor(totalmem() / 2);
		mmapSize = Math.min(fileSize, ramCap);
		// Floor at 256 MB for small DBs
		if (mmapSize < 268435456) mmapSize = 268435456;
	} catch {
		// File may not exist yet (first run)
	}

	// Scale page cache to DB size: 64 MB baseline, up to 512 MB for large DBs.
	// For a 16 GB DB, 512 MB cache keeps ~3% of pages resident (vs 0.4% at 64 MB).
	// Combined with mmap, this ensures indices and recent message pages stay hot.
	let cacheSizeKB = 65536; // 64 MB
	try {
		const fileSize = statSync(dbPath).size;
		if (fileSize > 2 * 1024 * 1024 * 1024)
			cacheSizeKB = 524288; // 512 MB for >2 GB DBs
		else if (fileSize > 512 * 1024 * 1024)
			cacheSizeKB = 262144; // 256 MB for >512 MB DBs
		else if (fileSize > 128 * 1024 * 1024) cacheSizeKB = 131072; // 128 MB for >128 MB DBs
	} catch {
		// First run — use default
	}

	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA busy_timeout = 30000");
	db.exec(`PRAGMA cache_size = -${cacheSizeKB}`);
	db.exec("PRAGMA temp_store = MEMORY");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec(`PRAGMA mmap_size = ${mmapSize}`);

	// Checkpoint and truncate the WAL before anything else. After a crash
	// the WAL can be very large (GBs for a big mailbox); leaving it un-
	// checkpointed means the first writer races against readers and both
	// suffer. TRUNCATE mode resets the WAL file to zero bytes.
	try {
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} catch {
		// Checkpoint can fail if another connection holds a read lock — safe to skip
	}

	// Let SQLite analyse tables and pick better query plans for the current data
	db.exec("PRAGMA optimize");

	const blobsPath = join(dataDir, `${filename.replace(/\.db$/, "")}-blobs.db`);
	attachBlobsDb(db, blobsPath, vaultKey);

	ensureSchema(db);
	return db;
}

export function ensureSchema(db: Database.Database): void {
	const hasTable = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
		.get();

	if (!hasTable) {
		db.exec(MIGRATIONS[0]);
	}

	const row = db.prepare("SELECT version FROM schema_version").get() as
		| { version: number }
		| undefined;
	const currentVersion = row?.version ?? 0;

	if (currentVersion < SCHEMA_VERSION) {
		for (let i = currentVersion; i < SCHEMA_VERSION; i++) {
			const hook = PRE_MIGRATION_HOOKS[i + 1];
			if (hook) hook(db);
			db.exec(MIGRATIONS[i]);
		}
		db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
	}
}

/**
 * Pre-migration hooks: JS code that must run before a specific migration's SQL.
 * Keyed by target schema version (1-indexed, matching SCHEMA_VERSION).
 */
const PRE_MIGRATION_HOOKS: Record<number, (db: Database.Database) => void> = {
	// v21: Hash existing inline attachment data into attachment_blobs before the
	// SQL migration drops the data column from attachments.  Note: array index
	// aligns with target schema version (1-indexed).
	21: (db) => {
		const rows = db
			.prepare("SELECT id, data FROM attachments WHERE data IS NOT NULL AND content_hash IS NULL")
			.all() as Array<{ id: number; data: Buffer }>;
		if (rows.length === 0) return;
		const insertBlob = db.prepare(
			"INSERT OR IGNORE INTO attachment_blobs (content_hash, data) VALUES (?, ?)",
		);
		const setHash = db.prepare("UPDATE attachments SET content_hash = ? WHERE id = ?");
		for (const row of rows) {
			const hash = createHash("sha256").update(row.data).digest("hex");
			insertBlob.run(hash, row.data);
			setHash.run(hash, row.id);
		}
	},

	// v23: Batch-compress existing html_body, raw_headers, and attachment blobs.
	23: (db) => {
		const BATCH_SIZE = 500;
		const compressOpts = { level: 6 };

		// Compress html_body — only rows where it's a non-null TEXT (typeof string)
		const htmlRows = db
			.prepare("SELECT id, html_body FROM messages WHERE html_body IS NOT NULL")
			.all() as Array<{ id: number; html_body: string | Buffer }>;
		if (htmlRows.length > 0) {
			const updateHtml = db.prepare("UPDATE messages SET html_body = ? WHERE id = ?");
			const htmlTxn = db.transaction((batch: typeof htmlRows) => {
				for (const row of batch) {
					if (typeof row.html_body !== "string") continue; // already compressed
					updateHtml.run(deflateSync(Buffer.from(row.html_body, "utf-8"), compressOpts), row.id);
				}
			});
			for (let i = 0; i < htmlRows.length; i += BATCH_SIZE) {
				htmlTxn(htmlRows.slice(i, i + BATCH_SIZE));
			}
		}

		// Compress raw_headers
		const headerRows = db
			.prepare("SELECT id, raw_headers FROM messages WHERE raw_headers IS NOT NULL")
			.all() as Array<{ id: number; raw_headers: string | Buffer }>;
		if (headerRows.length > 0) {
			const updateHeaders = db.prepare("UPDATE messages SET raw_headers = ? WHERE id = ?");
			const headerTxn = db.transaction((batch: typeof headerRows) => {
				for (const row of batch) {
					if (typeof row.raw_headers !== "string") continue;
					updateHeaders.run(
						deflateSync(Buffer.from(row.raw_headers, "utf-8"), compressOpts),
						row.id,
					);
				}
			});
			for (let i = 0; i < headerRows.length; i += BATCH_SIZE) {
				headerTxn(headerRows.slice(i, i + BATCH_SIZE));
			}
		}

		// Compress attachment blobs
		const blobRows = db.prepare("SELECT content_hash, data FROM attachment_blobs").all() as Array<{
			content_hash: string;
			data: Buffer;
		}>;
		if (blobRows.length > 0) {
			const updateBlob = db.prepare("UPDATE attachment_blobs SET data = ? WHERE content_hash = ?");
			const blobTxn = db.transaction((batch: typeof blobRows) => {
				for (const row of batch) {
					// Skip if already compressed (starts with zlib header 0x78)
					if (row.data.length >= 2 && row.data[0] === 0x78) continue;
					updateBlob.run(deflateSync(row.data, compressOpts), row.content_hash);
				}
			});
			for (let i = 0; i < blobRows.length; i += BATCH_SIZE) {
				blobTxn(blobRows.slice(i, i + BATCH_SIZE));
			}
		}
	},

	// v24: Backfill text_body for HTML-only messages (html_body present, text_body NULL).
	// Decompresses html_body, strips HTML to plain text, and stores in text_body for FTS5 indexing.
	24: (db) => {
		const BATCH_SIZE = 500;

		const rows = db
			.prepare(
				"SELECT id, html_body FROM messages WHERE text_body IS NULL AND html_body IS NOT NULL",
			)
			.all() as Array<{ id: number; html_body: string | Buffer }>;

		if (rows.length === 0) return;

		const updateText = db.prepare("UPDATE messages SET text_body = ? WHERE id = ?");

		const txn = db.transaction((batch: typeof rows) => {
			for (const row of batch) {
				// Decompress html_body if it's a Buffer (compressed), otherwise use string directly
				const html =
					typeof row.html_body === "string"
						? row.html_body
						: inflateSync(row.html_body).toString("utf-8");
				const text = htmlToText(html);
				if (text) {
					updateText.run(text, row.id);
				}
			}
		});

		for (let i = 0; i < rows.length; i += BATCH_SIZE) {
			txn(rows.slice(i, i + BATCH_SIZE));
		}
	},

	// v25: Add html_text_body column and backfill from html_body.
	// This gives every message with HTML a dedicated searchable text extraction,
	// separate from text_body (the original plain-text MIME part).
	25: (db) => {
		db.exec("ALTER TABLE messages ADD COLUMN html_text_body TEXT");

		const BATCH_SIZE = 500;

		const rows = db
			.prepare("SELECT id, html_body FROM messages WHERE html_body IS NOT NULL")
			.all() as Array<{ id: number; html_body: string | Buffer }>;

		if (rows.length === 0) return;

		const updateHtmlText = db.prepare("UPDATE messages SET html_text_body = ? WHERE id = ?");

		const txn = db.transaction((batch: typeof rows) => {
			for (const row of batch) {
				const html =
					typeof row.html_body === "string"
						? row.html_body
						: inflateSync(row.html_body).toString("utf-8");
				const text = htmlToText(html);
				if (text) {
					updateHtmlText.run(text, row.id);
				}
			}
		});

		for (let i = 0; i < rows.length; i += BATCH_SIZE) {
			txn(rows.slice(i, i + BATCH_SIZE));
		}
	},

	// v27: Move attachment_blobs from main DB to the attached blobs DB.
	27: (db) => {
		const hasTable = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attachment_blobs'")
			.get();
		if (!hasTable) return;
		const rows = db.prepare("SELECT content_hash, data FROM attachment_blobs").all() as Array<{
			content_hash: string;
			data: Buffer;
		}>;
		if (rows.length === 0) return;
		const insert = db.prepare(
			"INSERT OR IGNORE INTO blobs.attachment_blobs (content_hash, data) VALUES (?, ?)",
		);
		const txn = db.transaction(() => {
			for (const row of rows) {
				insert.run(row.content_hash, row.data);
			}
		});
		txn();
	},

	// v26: Rename IMAP-sourced labels from folder leaf name to full folder path.
	// Multiple folders can share a leaf name (e.g., "Archive/Old/INBOX" and "INBOX"
	// both have name="INBOX"). This migration creates path-based labels and re-links
	// message_labels so each message points to its folder's full-path label.
	26: (db) => {
		const folders = db.prepare("SELECT id, path, name FROM folders").all() as Array<{
			id: number;
			path: string;
			name: string;
		}>;

		if (folders.length === 0) return;

		const upsertLabel = db.prepare(
			"INSERT INTO labels (name, source) VALUES (?, 'imap') ON CONFLICT(name) DO NOTHING",
		);
		const getLabelId = db.prepare("SELECT id FROM labels WHERE name = ?");

		const txn = db.transaction(() => {
			for (const folder of folders) {
				if (folder.path === folder.name) continue;
				upsertLabel.run(folder.path);
			}

			for (const folder of folders) {
				if (folder.path === folder.name) continue;

				const oldLabel = getLabelId.get(folder.name) as { id: number } | undefined;
				const newLabel = getLabelId.get(folder.path) as { id: number } | undefined;
				if (!oldLabel || !newLabel) continue;

				db.prepare(`
					UPDATE OR IGNORE message_labels
					SET label_id = ?
					WHERE label_id = ? AND message_id IN (
						SELECT id FROM messages WHERE folder_id = ?
					)
				`).run(newLabel.id, oldLabel.id, folder.id);
			}

			db.exec(`
				DELETE FROM labels WHERE source = 'imap'
				AND id NOT IN (SELECT DISTINCT label_id FROM message_labels)
				AND name NOT IN (SELECT path FROM folders)
			`);
		});
		txn();
	},
};

export type { Database };
export default Database;
