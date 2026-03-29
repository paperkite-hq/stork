import type Database from "better-sqlite3-multiple-ciphers";
import { type ImapConfig, ImapSync } from "./imap-sync.js";

export interface PooledConnection {
	sync: ImapSync;
	connectorId: number;
	lastUsed: number;
	busy: boolean;
}

export interface ConnectionPoolOptions {
	/** Max connections per connector (default: 1) */
	maxPerConnector?: number;
	/** Max total connections across all connectors (default: 10) */
	maxTotal?: number;
	/** Idle timeout in ms before a connection is closed (default: 5 minutes) */
	idleTimeoutMs?: number;
}

const DEFAULT_MAX_PER_CONNECTOR = 1;
const DEFAULT_MAX_TOTAL = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Manages a pool of IMAP connections across multiple inbound connectors.
 *
 * Reuses existing connections when possible, enforces per-connector
 * and total connection limits, and cleans up idle connections.
 */
export class ConnectionPool {
	private connections: Map<number, PooledConnection[]> = new Map();
	private db: Database.Database;
	private maxPerConnector: number;
	private maxTotal: number;
	private idleTimeoutMs: number;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(db: Database.Database, options: ConnectionPoolOptions = {}) {
		this.db = db;
		this.maxPerConnector = options.maxPerConnector ?? DEFAULT_MAX_PER_CONNECTOR;
		this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

		// Periodically clean up idle connections
		this.cleanupTimer = setInterval(() => this.evictIdle(), this.idleTimeoutMs);
	}

	/**
	 * Acquires an IMAP sync instance for the given inbound connector.
	 * Reuses an idle connection if available, or creates a new one.
	 */
	async acquire(connectorId: number, config: ImapConfig): Promise<ImapSync> {
		const connectorConns = this.connections.get(connectorId) ?? [];

		// Discard idle connections — ImapFlow instances can't be reused after
		// ungraceful shutdown and there's no reliable way to check liveness.
		// Always create a fresh connection for each sync cycle.
		const idleIdx = connectorConns.findIndex((c) => !c.busy);
		if (idleIdx !== -1) {
			const [stale] = connectorConns.splice(idleIdx, 1);
			stale.sync.disconnect().catch(() => {});
			if (connectorConns.length === 0) {
				this.connections.delete(connectorId);
			}
		}

		// Check per-connector limit
		if (connectorConns.length >= this.maxPerConnector) {
			throw new Error(
				`Connection limit reached for connector ${connectorId} (max: ${this.maxPerConnector})`,
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
		const sync = new ImapSync(config, this.db, connectorId);
		try {
			await sync.connect();
		} catch (err) {
			// Force-close the failed client to release the underlying TCP socket
			// and prevent async teardown events from leaking after the error.
			sync.forceClose();
			throw err;
		}

		const pooled: PooledConnection = {
			sync,
			connectorId,
			lastUsed: Date.now(),
			busy: true,
		};

		if (!this.connections.has(connectorId)) {
			this.connections.set(connectorId, []);
		}
		this.connections.get(connectorId)?.push(pooled);

		return sync;
	}

	/**
	 * Releases a connection back to the pool for reuse.
	 */
	release(connectorId: number, sync: ImapSync): void {
		const connectorConns = this.connections.get(connectorId);
		if (!connectorConns) return;

		const pooled = connectorConns.find((c) => c.sync === sync);
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
	 * Returns the number of connections for a specific connector.
	 */
	connectorConnections(connectorId: number): number {
		return this.connections.get(connectorId)?.length ?? 0;
	}

	/**
	 * Evicts connections that have been idle longer than the timeout.
	 */
	private evictIdle(): void {
		const now = Date.now();
		for (const [connectorId, conns] of this.connections) {
			const remaining: PooledConnection[] = [];
			for (const conn of conns) {
				if (!conn.busy && now - conn.lastUsed > this.idleTimeoutMs) {
					conn.sync.disconnect().catch(() => {});
				} else {
					remaining.push(conn);
				}
			}
			if (remaining.length === 0) {
				this.connections.delete(connectorId);
			} else {
				this.connections.set(connectorId, remaining);
			}
		}
	}

	/**
	 * Evicts the oldest idle connection across all connectors.
	 * Returns true if a connection was evicted.
	 */
	private evictOldestIdle(): boolean {
		let oldest: { connectorId: number; index: number; lastUsed: number } | null = null;

		for (const [connectorId, conns] of this.connections) {
			for (let i = 0; i < conns.length; i++) {
				if (!conns[i].busy) {
					if (!oldest || conns[i].lastUsed < oldest.lastUsed) {
						oldest = { connectorId, index: i, lastUsed: conns[i].lastUsed };
					}
				}
			}
		}

		if (!oldest) return false;

		const conns = this.connections.get(oldest.connectorId);
		if (!conns) return false;
		const [removed] = conns.splice(oldest.index, 1);
		removed.sync.disconnect().catch(() => {});

		if (conns.length === 0) {
			this.connections.delete(oldest.connectorId);
		}

		return true;
	}
}
