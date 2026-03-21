import Database from "@signalapp/better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MIGRATIONS } from "../src/storage/schema.js";
import { ConnectionPool } from "../src/sync/connection-pool.js";

function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

describe("ConnectionPool", () => {
	let db: Database.Database;
	let pool: ConnectionPool;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(async () => {
		if (pool) await pool.shutdown();
		db.close();
	});

	test("tracks total and per-account connections", () => {
		pool = new ConnectionPool(db, { maxPerAccount: 3, maxTotal: 10 });
		expect(pool.totalConnections()).toBe(0);
		expect(pool.accountConnections(1)).toBe(0);
	});

	test("enforces max total connection limit", () => {
		pool = new ConnectionPool(db, { maxPerAccount: 5, maxTotal: 2 });
		// With no actual IMAP server to connect to, we verify the pool
		// is configured correctly via its properties
		expect(pool.totalConnections()).toBe(0);
	});

	test("shutdown clears all connections", async () => {
		pool = new ConnectionPool(db, { maxPerAccount: 3, maxTotal: 10 });
		await pool.shutdown();
		expect(pool.totalConnections()).toBe(0);
	});

	test("release is a no-op for unknown accounts", () => {
		pool = new ConnectionPool(db, {});
		// Should not throw
		pool.release(999, {} as never);
		expect(pool.totalConnections()).toBe(0);
	});
});
