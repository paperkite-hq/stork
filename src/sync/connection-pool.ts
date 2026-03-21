import type Database from "@signalapp/better-sqlite3";
import { type ImapConfig, ImapSync } from "./imap-sync.js";

export interface PooledConnection {
	sync: ImapSync;
	accountId: number;
	lastUsed: number;
	busy: boolean;
}

export interface ConnectionPoolOptions {
	/** Max connections per account (default: 1) */
	maxPerAccount?: number;
	/** Max total connections across all accounts (default: 10) */
	maxTotal?: number;
	/** Idle timeout in ms before a connection is closed (default: 5 minutes) */
	idleTimeoutMs?: number;
}

const DEFAULT_MAX_PER_ACCOUNT = 1;
const DEFAULT_MAX_TOTAL = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Manages a pool of IMAP connections across multiple accounts.
 *
 * Reuses existing connections when possible, enforces per-account
 * and total connection limits, and cleans up idle connections.
 */
export class ConnectionPool {
	private connections: Map<number, PooledConnection[]> = new Map();
	private db: Database.Database;
	private maxPerAccount: number;
	private maxTotal: number;
	private idleTimeoutMs: number;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(db: Database.Database, options: ConnectionPoolOptions = {}) {
		this.db = db;
		this.maxPerAccount = options.maxPerAccount ?? DEFAULT_MAX_PER_ACCOUNT;
		this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

		// Periodically clean up idle connections
		this.cleanupTimer = setInterval(() => this.evictIdle(), this.idleTimeoutMs);
	}

	/**
	 * Acquires an IMAP sync instance for the given account.
	 * Reuses an idle connection if available, or creates a new one.
	 */
	async acquire(accountId: number, config: ImapConfig): Promise<ImapSync> {
		const accountConns = this.connections.get(accountId) ?? [];

		// Discard idle connections — ImapFlow instances can't be reused after
		// ungraceful shutdown and there's no reliable way to check liveness.
		// Always create a fresh connection for each sync cycle.
		const idleIdx = accountConns.findIndex((c) => !c.busy);
		if (idleIdx !== -1) {
			const [stale] = accountConns.splice(idleIdx, 1);
			stale.sync.disconnect().catch(() => {});
			if (accountConns.length === 0) {
				this.connections.delete(accountId);
			}
		}

		// Check per-account limit
		if (accountConns.length >= this.maxPerAccount) {
			throw new Error(
				`Connection limit reached for account ${accountId} (max: ${this.maxPerAccount})`,
			);
		}

		// Check total limit — evict oldest idle connection if at capacity
		if (this.totalConnections() >= this.maxTotal) {
			const evicted = this.evictOldestIdle();
			if (!evicted) {
				throw new Error(
					`Total connection limit reached (max: ${this.maxTotal}), all connections busy`,
				);
			}
		}

		// Create new connection
		const sync = new ImapSync(config, this.db, accountId);
		await sync.connect();

		const pooled: PooledConnection = {
			sync,
			accountId,
			lastUsed: Date.now(),
			busy: true,
		};

		if (!this.connections.has(accountId)) {
			this.connections.set(accountId, []);
		}
		this.connections.get(accountId)?.push(pooled);

		return sync;
	}

	/**
	 * Releases a connection back to the pool for reuse.
	 */
	release(accountId: number, sync: ImapSync): void {
		const accountConns = this.connections.get(accountId);
		if (!accountConns) return;

		const pooled = accountConns.find((c) => c.sync === sync);
		if (pooled) {
			pooled.busy = false;
			pooled.lastUsed = Date.now();
		}
	}

	/**
	 * Closes all connections and stops the cleanup timer.
	 * Uses force-close to avoid hanging on LOGOUT when connections are
	 * mid-FETCH (e.g., during process shutdown).
	 */
	async shutdown(): Promise<void> {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		for (const [, conns] of this.connections) {
			for (const conn of conns) {
				conn.sync.forceClose();
			}
		}

		this.connections.clear();
	}

	/**
	 * Returns the total number of active connections.
	 */
	totalConnections(): number {
		let total = 0;
		for (const [, conns] of this.connections) {
			total += conns.length;
		}
		return total;
	}

	/**
	 * Returns the number of connections for a specific account.
	 */
	accountConnections(accountId: number): number {
		return this.connections.get(accountId)?.length ?? 0;
	}

	/**
	 * Evicts connections that have been idle longer than the timeout.
	 */
	private evictIdle(): void {
		const now = Date.now();
		for (const [accountId, conns] of this.connections) {
			const remaining: PooledConnection[] = [];
			for (const conn of conns) {
				if (!conn.busy && now - conn.lastUsed > this.idleTimeoutMs) {
					conn.sync.disconnect().catch(() => {});
				} else {
					remaining.push(conn);
				}
			}
			if (remaining.length === 0) {
				this.connections.delete(accountId);
			} else {
				this.connections.set(accountId, remaining);
			}
		}
	}

	/**
	 * Evicts the oldest idle connection across all accounts.
	 * Returns true if a connection was evicted.
	 */
	private evictOldestIdle(): boolean {
		let oldest: { accountId: number; index: number; lastUsed: number } | null = null;

		for (const [accountId, conns] of this.connections) {
			for (let i = 0; i < conns.length; i++) {
				if (!conns[i].busy) {
					if (!oldest || conns[i].lastUsed < oldest.lastUsed) {
						oldest = { accountId, index: i, lastUsed: conns[i].lastUsed };
					}
				}
			}
		}

		if (!oldest) return false;

		const conns = this.connections.get(oldest.accountId);
		if (!conns) return false;
		const [removed] = conns.splice(oldest.index, 1);
		removed.sync.disconnect().catch(() => {});

		if (conns.length === 0) {
			this.connections.delete(oldest.accountId);
		}

		return true;
	}
}
