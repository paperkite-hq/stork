/**
 * Demo mode lifecycle — boots Stork with an unencrypted, pre-seeded database
 * and read-only middleware. Used for the hosted public demo.
 *
 * Activated by STORK_DEMO_MODE=1 environment variable.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3-multiple-ciphers";
import { openDatabase } from "../storage/db.js";
import { seedDemoData } from "./seed.js";

export function isDemoMode(): boolean {
	return process.env.STORK_DEMO_MODE === "1";
}

/**
 * Boot a demo database: unencrypted, pre-seeded with sample data.
 * Returns the open database handle.
 */
export function bootDemoDatabase(dataDir: string): Database.Database {
	const dbPath = join(dataDir, "stork.db");
	const needsSeed = !existsSync(dbPath);

	// Open unencrypted (no vault key)
	const db = openDatabase("stork.db", dataDir);

	if (needsSeed) {
		seedDemoData(db);
		console.log("  Demo data seeded: 19 messages, 12 labels, 2 accounts (Vault mode)");
	}

	return db;
}
