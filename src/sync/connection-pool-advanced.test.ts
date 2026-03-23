import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MIGRATIONS } from "../storage/schema.js";
import { ConnectionPool } from "./connection-pool.js";
import type { PooledConnection } from "./connection-pool.js";
import type { ImapSync } from "./imap-sync.js";

function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

// Mock ImapSync to avoid requiring a real IMAP server
function createMockSync(): ImapSync {
	return {
		connect: vi.fn(() => Promise.resolve()),
		disconnect: vi.fn(() => Promise.resolve()),
		forceClose: vi.fn(),
		syncFolders: vi.fn(() => Promise.resolve()),
		syncMessages: vi.fn(() => Promise.resolve()),
	} as unknown as ImapSync;
}

// Patch ConnectionPool to use mock connections
function createTestPool(
	db: Database.Database,
	options: { maxPerAccount?: number; maxTotal?: number; idleTimeoutMs?: number } = {},
): ConnectionPool {
	const pool = new ConnectionPool(db, options);

	// Override acquire to inject mock ImapSync instead of connecting to real IMAP
	pool.acquire = async (accountId, _config) => {
		// Directly manipulate the pool's internal state to add a mock connection
		const conns = (pool as unknown as { connections: Map<number, unknown[]> }).connections;
		const accountConns = conns.get(accountId) ?? [];

		// Check for idle connection to reuse
		const idle = (accountConns as { busy: boolean; sync: ImapSync; lastUsed: number }[]).find(
			(c) => !c.busy,
		);
		if (idle) {
			idle.busy = true;
			idle.lastUsed = Date.now();
			return idle.sync;
		}

		// Check per-account limit
		if (
			accountConns.length >= ((pool as unknown as { maxPerAccount: number }).maxPerAccount ?? 1)
		) {
			throw new Error(
				`Connection limit reached for account ${accountId} (max: ${(pool as unknown as { maxPerAccount: number }).maxPerAccount})`,
			);
		}

		// Check total limit
		if (pool.totalConnections() >= ((pool as unknown as { maxTotal: number }).maxTotal ?? 10)) {
			// Try to evict an idle connection
			const evicted = (pool as unknown as { evictOldestIdle: () => boolean }).evictOldestIdle();
			if (!evicted) {
				throw new Error(
					`Total connection limit reached (max: ${(pool as unknown as { maxTotal: number }).maxTotal}), all connections busy`,
				);
			}
		}

		// Create mock connection
		const mockSync = createMockSync();
		const pooled = {
			sync: mockSync,
			accountId,
			lastUsed: Date.now(),
			busy: true,
		};

		if (!conns.has(accountId)) {
			conns.set(accountId, []);
		}
		conns.get(accountId)?.push(pooled);

		return mockSync;
	};

	return pool;
}

describe("ConnectionPool — acquire/release lifecycle", () => {
	let db: Database.Database;
	let pool: ConnectionPool;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(async () => {
		if (pool) await pool.shutdown();
		db.close();
	});

	test("acquire creates a connection and increments count", async () => {
		pool = createTestPool(db, { maxPerAccount: 3, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		const sync = await pool.acquire(1, config);
		expect(sync).toBeDefined();
		expect(pool.totalConnections()).toBe(1);
		expect(pool.accountConnections(1)).toBe(1);
	});

	test("release marks connection as idle for reuse", async () => {
		pool = createTestPool(db, { maxPerAccount: 3, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		const sync1 = await pool.acquire(1, config);
		pool.release(1, sync1);

		// Acquiring again should reuse the same connection
		const sync2 = await pool.acquire(1, config);
		expect(sync2).toBe(sync1);
		expect(pool.totalConnections()).toBe(1); // Still 1, not 2
	});

	test("per-account limit prevents excessive connections", async () => {
		pool = createTestPool(db, { maxPerAccount: 1, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		await pool.acquire(1, config);
		// Second acquire for same account should fail (first is still busy)
		await expect(pool.acquire(1, config)).rejects.toThrow("Connection limit reached for account 1");
	});

	test("total limit prevents too many connections across accounts", async () => {
		pool = createTestPool(db, { maxPerAccount: 5, maxTotal: 2 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		await pool.acquire(1, config);
		await pool.acquire(2, config);

		// Third acquire for a new account should fail (both are busy, nothing to evict)
		await expect(pool.acquire(3, config)).rejects.toThrow(
			"Total connection limit reached (max: 2), all connections busy",
		);
	});

	test("total limit evicts oldest idle connection when at capacity", async () => {
		pool = createTestPool(db, { maxPerAccount: 5, maxTotal: 2 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		const sync1 = await pool.acquire(1, config);
		await pool.acquire(2, config);

		// Release account 1's connection (making it idle)
		pool.release(1, sync1);

		// Now acquiring for account 3 should evict account 1's idle connection
		const sync3 = await pool.acquire(3, config);
		expect(sync3).toBeDefined();
		expect(pool.totalConnections()).toBe(2);
		expect(pool.accountConnections(1)).toBe(0); // Evicted
		expect(pool.accountConnections(3)).toBe(1);
	});

	test("multiple accounts can have connections simultaneously", async () => {
		pool = createTestPool(db, { maxPerAccount: 2, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		await pool.acquire(1, config);
		await pool.acquire(2, config);
		await pool.acquire(3, config);

		expect(pool.totalConnections()).toBe(3);
		expect(pool.accountConnections(1)).toBe(1);
		expect(pool.accountConnections(2)).toBe(1);
		expect(pool.accountConnections(3)).toBe(1);
	});

	test("shutdown clears all connections and stops cleanup timer", async () => {
		pool = createTestPool(db, { maxPerAccount: 3, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		await pool.acquire(1, config);
		await pool.acquire(2, config);

		expect(pool.totalConnections()).toBe(2);
		await pool.shutdown();
		expect(pool.totalConnections()).toBe(0);
	});

	test("release is safe for non-existent account", () => {
		pool = createTestPool(db, {});
		pool.release(999, {} as ImapSync);
		expect(pool.totalConnections()).toBe(0);
	});

	test("release is safe for non-matching sync object", async () => {
		pool = createTestPool(db, { maxPerAccount: 3, maxTotal: 10 });
		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };

		await pool.acquire(1, config);
		// Release with a different sync object — should not crash
		pool.release(1, {} as ImapSync);
		expect(pool.totalConnections()).toBe(1);
	});
});

describe("ConnectionPool — idle eviction (evictIdle)", () => {
	type InternalPool = {
		connections: Map<
			number,
			{ sync: ImapSync; accountId: number; lastUsed: number; busy: boolean }[]
		>;
		evictIdle: () => void;
	};

	let db: Database.Database;
	let pool: ConnectionPool;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(async () => {
		if (pool) await pool.shutdown();
		db.close();
	});

	test("evictIdle removes timed-out idle connections and deletes account entry", () => {
		pool = new ConnectionPool(db, { idleTimeoutMs: 1000 });
		const mockSync = createMockSync();
		const internal = pool as unknown as InternalPool;

		internal.connections.set(1, [
			{ sync: mockSync, accountId: 1, lastUsed: Date.now() - 5000, busy: false },
		]);

		expect(pool.totalConnections()).toBe(1);
		internal.evictIdle();

		expect(pool.totalConnections()).toBe(0);
		expect(pool.accountConnections(1)).toBe(0);
		expect(mockSync.disconnect).toHaveBeenCalledTimes(1);
	});

	test("evictIdle keeps connections that are still within the timeout window", () => {
		pool = new ConnectionPool(db, { idleTimeoutMs: 60000 });
		const mockSync = createMockSync();
		const internal = pool as unknown as InternalPool;

		internal.connections.set(1, [
			{ sync: mockSync, accountId: 1, lastUsed: Date.now() - 1000, busy: false },
		]);

		internal.evictIdle();

		expect(pool.totalConnections()).toBe(1);
		expect(mockSync.disconnect).not.toHaveBeenCalled();
	});

	test("evictIdle does not evict busy connections even if they are old", () => {
		pool = new ConnectionPool(db, { idleTimeoutMs: 1000 });
		const mockSync = createMockSync();
		const internal = pool as unknown as InternalPool;

		internal.connections.set(1, [
			{ sync: mockSync, accountId: 1, lastUsed: Date.now() - 10000, busy: true },
		]);

		internal.evictIdle();

		expect(pool.totalConnections()).toBe(1);
		expect(mockSync.disconnect).not.toHaveBeenCalled();
	});

	test("evictIdle evicts only stale idle connections when account has mixed connections", () => {
		pool = new ConnectionPool(db, { idleTimeoutMs: 1000, maxPerAccount: 3 });
		const staleSync = createMockSync();
		const activeSync = createMockSync();
		const internal = pool as unknown as InternalPool;

		internal.connections.set(1, [
			{ sync: staleSync, accountId: 1, lastUsed: Date.now() - 5000, busy: false },
			{ sync: activeSync, accountId: 1, lastUsed: Date.now(), busy: true },
		]);

		internal.evictIdle();

		// stale idle evicted; account still exists with 1 connection
		expect(pool.totalConnections()).toBe(1);
		expect(pool.accountConnections(1)).toBe(1);
		expect(staleSync.disconnect).toHaveBeenCalledTimes(1);
		expect(activeSync.disconnect).not.toHaveBeenCalled();
	});

	test("evictIdle handles multiple accounts and cleans up each independently", () => {
		pool = new ConnectionPool(db, { idleTimeoutMs: 1000 });
		const stale1 = createMockSync();
		const stale2 = createMockSync();
		const fresh = createMockSync();
		const internal = pool as unknown as InternalPool;

		internal.connections.set(1, [
			{ sync: stale1, accountId: 1, lastUsed: Date.now() - 5000, busy: false },
		]);
		internal.connections.set(2, [
			{ sync: stale2, accountId: 2, lastUsed: Date.now() - 5000, busy: false },
		]);
		internal.connections.set(3, [{ sync: fresh, accountId: 3, lastUsed: Date.now(), busy: false }]);

		internal.evictIdle();

		expect(pool.accountConnections(1)).toBe(0); // evicted
		expect(pool.accountConnections(2)).toBe(0); // evicted
		expect(pool.accountConnections(3)).toBe(1); // kept
		expect(stale1.disconnect).toHaveBeenCalledTimes(1);
		expect(stale2.disconnect).toHaveBeenCalledTimes(1);
		expect(fresh.disconnect).not.toHaveBeenCalled();
	});
});

// Tests for the real ConnectionPool.acquire() implementation paths
// (previous tests override acquire() with a mock; these test the actual method)
describe("ConnectionPool — real acquire() limit checks", () => {
	type InternalPool = {
		connections: Map<number, PooledConnection[]>;
	};

	let db: Database.Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		for (const migration of MIGRATIONS) {
			db.exec(migration);
		}
	});

	afterEach(() => {
		db.close();
	});

	test("throws per-account limit error when all connections for account are busy", async () => {
		const pool = new ConnectionPool(db, { maxPerAccount: 1, maxTotal: 10 });
		const internal = pool as unknown as InternalPool;

		// Directly inject a busy connection for account 1 (bypassing connect())
		const mockSync = {
			connect: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
			forceClose: vi.fn(),
		} as unknown as ImapSync;
		internal.connections.set(1, [
			{ sync: mockSync, accountId: 1, lastUsed: Date.now(), busy: true },
		]);

		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };
		// Acquire should throw: account is at maxPerAccount=1 with no idle connection to discard
		await expect(pool.acquire(1, config)).rejects.toThrow(
			"Connection limit reached for account 1 (max: 1)",
		);

		await pool.shutdown();
	});

	test("throws total limit error when all connections across accounts are busy", async () => {
		const pool = new ConnectionPool(db, { maxPerAccount: 5, maxTotal: 2 });
		const internal = pool as unknown as InternalPool;

		// Directly inject two busy connections (filling total capacity)
		const mockSync1 = {
			connect: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
			forceClose: vi.fn(),
		} as unknown as ImapSync;
		const mockSync2 = {
			connect: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
			forceClose: vi.fn(),
		} as unknown as ImapSync;
		internal.connections.set(1, [
			{ sync: mockSync1, accountId: 1, lastUsed: Date.now(), busy: true },
		]);
		internal.connections.set(2, [
			{ sync: mockSync2, accountId: 2, lastUsed: Date.now(), busy: true },
		]);

		const config = { host: "localhost", port: 993, secure: true, auth: { user: "u", pass: "p" } };
		// Acquire for a third account: total=2=maxTotal, evictOldestIdle() finds nothing → throws
		await expect(pool.acquire(3, config)).rejects.toThrow(
			"Total connection limit reached (max: 2), all connections busy",
		);

		await pool.shutdown();
	});
});

// Direct unit tests for evictOldestIdle() — covers the branches in lines 181-206
describe("ConnectionPool — evictOldestIdle() direct tests", () => {
	interface InternalPool {
		connections: Map<number, PooledConnection[]>;
		evictOldestIdle: () => boolean;
		shutdown: () => Promise<void>;
	}

	let db: Database.Database;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA foreign_keys = ON");
		for (const migration of MIGRATIONS) {
			db.exec(migration);
		}
	});

	afterEach(() => {
		db.close();
	});

	function makePool(): InternalPool {
		return new ConnectionPool(db, { maxTotal: 10 }) as unknown as InternalPool;
	}

	function mockSync(): ImapSync {
		return {
			disconnect: vi.fn(() => Promise.resolve()),
			forceClose: vi.fn(),
		} as unknown as ImapSync;
	}

	test("evictOldestIdle evicts idle connection and removes empty account entry", async () => {
		const pool = makePool();
		const sync1 = mockSync();
		pool.connections.set(1, [{ sync: sync1, accountId: 1, lastUsed: 0, busy: false }]);

		const result = pool.evictOldestIdle();

		expect(result).toBe(true);
		expect(sync1.disconnect).toHaveBeenCalledTimes(1);
		// Account entry removed when its connection list becomes empty
		expect(pool.connections.has(1)).toBe(false);

		await pool.shutdown();
	});

	test("evictOldestIdle picks the oldest idle when multiple accounts have idle connections", async () => {
		const pool = makePool();
		const oldSync = mockSync();
		const newSync = mockSync();

		// Account 1 has older idle connection
		pool.connections.set(1, [{ sync: oldSync, accountId: 1, lastUsed: 100, busy: false }]);
		// Account 2 has newer idle connection
		pool.connections.set(2, [{ sync: newSync, accountId: 2, lastUsed: Date.now(), busy: false }]);

		const result = pool.evictOldestIdle();

		expect(result).toBe(true);
		expect(oldSync.disconnect).toHaveBeenCalledTimes(1);
		expect(newSync.disconnect).not.toHaveBeenCalled();
		expect(pool.connections.has(1)).toBe(false); // account 1 removed
		expect(pool.connections.has(2)).toBe(true); // account 2 still present

		await pool.shutdown();
	});

	test("evictOldestIdle keeps account entry when other connections remain for that account", async () => {
		const pool = makePool();
		const idleSync = mockSync();
		const busySync = mockSync();

		// Account 1 has two connections: one old idle, one busy
		pool.connections.set(1, [
			{ sync: idleSync, accountId: 1, lastUsed: 0, busy: false },
			{ sync: busySync, accountId: 1, lastUsed: Date.now(), busy: true },
		]);

		const result = pool.evictOldestIdle();

		expect(result).toBe(true);
		expect(idleSync.disconnect).toHaveBeenCalledTimes(1);
		expect(busySync.disconnect).not.toHaveBeenCalled();
		// Account entry kept — still has one connection
		expect(pool.connections.has(1)).toBe(true);
		expect(pool.connections.get(1)?.length).toBe(1);

		await pool.shutdown();
	});

	test("evictOldestIdle returns false when all connections are busy", async () => {
		const pool = makePool();
		const busy = mockSync();
		pool.connections.set(1, [{ sync: busy, accountId: 1, lastUsed: 0, busy: true }]);

		const result = pool.evictOldestIdle();

		expect(result).toBe(false);
		expect(busy.disconnect).not.toHaveBeenCalled();

		await pool.shutdown();
	});

	test("evictOldestIdle returns false when pool is empty", async () => {
		const pool = makePool();
		const result = pool.evictOldestIdle();
		expect(result).toBe(false);
		await pool.shutdown();
	});
});
