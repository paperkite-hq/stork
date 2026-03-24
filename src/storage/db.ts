import { join } from "node:path";
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
			db.exec(MIGRATIONS[i]);
		}
		db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
	}
}

export type { Database };
export default Database;
