import { createHash } from "node:crypto";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import Database from "better-sqlite3-multiple-ciphers";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

const DATA_DIR = process.env.STORK_DATA_DIR || "./data";

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

	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA cache_size = -65536"); // 64 MB page cache (default is 2 MB)
	db.exec("PRAGMA temp_store = MEMORY"); // Use RAM for temp tables during sorts/joins
	db.exec("PRAGMA synchronous = NORMAL"); // Safe with WAL; avoids fsync on every commit
	db.exec("PRAGMA mmap_size = 268435456"); // 256 MB memory-mapped I/O

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
};

export type { Database };
export default Database;
