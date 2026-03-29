import type Database from "better-sqlite3-multiple-ciphers";
import { ConnectionPool, type ConnectionPoolOptions } from "./connection-pool.js";
import type { ImapConfig, SyncAllResult, SyncError, SyncProgress } from "./imap-sync.js";

/**
 * Progress snapshot for an actively-running sync, as exposed to callers
 * via getStatus(). Includes a startedAt timestamp so callers can compute
 * elapsed time and estimate remaining time.
 */
export interface ActiveSyncProgress {
	currentFolder: string | null;
	foldersCompleted: number;
	totalFolders: number;
	messagesNew: number;
	errors: number;
	startedAt: number;
}

export interface IdentitySyncConfig {
	identityId: number;
	imapConfig: ImapConfig;
	/** Sync interval in ms (default: 5 minutes) */
	intervalMs?: number;
}

export interface SyncSchedulerOptions {
	/** Default sync interval in ms (default: 5 minutes) */
	defaultIntervalMs?: number;
	/** Connection pool options */
	poolOptions?: ConnectionPoolOptions;
	/** Called when a sync completes */
	onSyncComplete?: (identityId: number, result: SyncAllResult) => void;
	/** Called immediately when a sync error is recorded (for inline logging) */
	onSyncRecordError?: (identityId: number, error: SyncError) => void;
	/** Called when a sync fails */
	onSyncError?: (identityId: number, error: Error) => void;
}

interface ScheduledIdentity {
	config: IdentitySyncConfig;
	timer: ReturnType<typeof setInterval> | null;
	running: boolean;
	lastSync: number | null;
	lastError: string | null;
	consecutiveErrors: number;
	/** Active abort controller for cancelling a running sync */
	abortController: AbortController | null;
	/** Promise that resolves when the current sync completes */
	syncPromise: Promise<void> | null;
	/** Real-time progress of the current sync, null when not running */
	progress: ActiveSyncProgress | null;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * Manages periodic background sync for multiple IMAP identities.
 *
 * Each identity syncs on its own interval. Failed syncs use exponential
 * backoff to avoid hammering a broken server. Uses ConnectionPool to
 * reuse IMAP connections across sync cycles.
 */
export class SyncScheduler {
	private identities: Map<number, ScheduledIdentity> = new Map();
	private pool: ConnectionPool;
	private db: Database.Database;
	private defaultIntervalMs: number;
	private onSyncComplete?: (identityId: number, result: SyncAllResult) => void;
	private onSyncRecordError?: (identityId: number, error: SyncError) => void;
	private onSyncError?: (identityId: number, error: Error) => void;
	private started = false;

	constructor(db: Database.Database, options: SyncSchedulerOptions = {}) {
		this.db = db;
		this.defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS;
		this.pool = new ConnectionPool(db, options.poolOptions);
		this.onSyncComplete = options.onSyncComplete;
		this.onSyncRecordError = options.onSyncRecordError;
		this.onSyncError = options.onSyncError;
	}

	/**
	 * Adds an identity to the scheduler.
	 * If the scheduler is already started, begins syncing immediately.
	 */
	addIdentity(config: IdentitySyncConfig): void {
		if (this.identities.has(config.identityId)) {
			throw new Error(`Identity ${config.identityId} is already scheduled`);
		}

		const scheduled: ScheduledIdentity = {
			config,
			timer: null,
			running: false,
			lastSync: null,
			lastError: null,
			consecutiveErrors: 0,
			abortController: null,
			syncPromise: null,
			progress: null,
		};

		this.identities.set(config.identityId, scheduled);

		if (this.started) {
			this.startIdentitySync(scheduled);
		}
	}

	/**
	 * Removes an identity from the scheduler and releases its connections.
	 */
	removeIdentity(identityId: number): void {
		const scheduled = this.identities.get(identityId);
		if (!scheduled) return;

		if (scheduled.timer) {
			clearInterval(scheduled.timer);
		}

		this.identities.delete(identityId);
	}

	/**
	 * Starts the scheduler — begins periodic sync for all registered identities.
	 */
	start(): void {
		if (this.started) return;
		this.started = true;

		for (const scheduled of this.identities.values()) {
			this.startIdentitySync(scheduled);
		}
	}

	/**
	 * Stops the scheduler — cancels all timers, aborts running syncs,
	 * waits for them to finish (up to 5s), then closes all connections.
	 */
	async stop(): Promise<void> {
		this.started = false;

		const pendingSyncs: Promise<void>[] = [];

		for (const scheduled of this.identities.values()) {
			if (scheduled.timer) {
				clearInterval(scheduled.timer);
				scheduled.timer = null;
			}

			// Signal running syncs to stop
			if (scheduled.abortController) {
				scheduled.abortController.abort();
			}

			if (scheduled.syncPromise) {
				pendingSyncs.push(scheduled.syncPromise);
			}
		}

		// Wait for running syncs to finish gracefully (max 5 seconds)
		if (pendingSyncs.length > 0) {
			const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
			await Promise.race([Promise.allSettled(pendingSyncs), timeout]);
		}

		await this.pool.shutdown();
	}

	/**
	 * Triggers an immediate sync for a specific identity.
	 * Returns the sync result, or throws if the identity is already syncing.
	 */
	async syncNow(identityId: number): Promise<SyncAllResult> {
		const scheduled = this.identities.get(identityId);
		if (!scheduled) {
			throw new Error(`Identity ${identityId} is not registered`);
		}

		return this.runSync(scheduled);
	}

	/**
	 * Returns the status of all scheduled identities.
	 */
	getStatus(): Map<
		number,
		{
			running: boolean;
			lastSync: number | null;
			lastError: string | null;
			consecutiveErrors: number;
			progress: ActiveSyncProgress | null;
		}
	> {
		const status = new Map<
			number,
			{
				running: boolean;
				lastSync: number | null;
				lastError: string | null;
				consecutiveErrors: number;
				progress: ActiveSyncProgress | null;
			}
		>();

		for (const [identityId, scheduled] of this.identities) {
			status.set(identityId, {
				running: scheduled.running,
				lastSync: scheduled.lastSync,
				lastError: scheduled.lastError,
				consecutiveErrors: scheduled.consecutiveErrors,
				progress: scheduled.progress,
			});
		}

		return status;
	}

	/**
	 * Loads all identities from the database and adds them to the scheduler.
	 */
	loadIdentitiesFromDb(): void {
		// Only load identities with IMAP inbound connectors for periodic sync —
		// Cloudflare Email identities are push-based (webhook) and don't need polling.
		// Join with inbound_connectors to get IMAP credentials from the connector table.
		const identities = this.db
			.prepare(
				`SELECT i.id, ic.imap_host, ic.imap_port, ic.imap_tls, ic.imap_user, ic.imap_pass
				FROM identities i
				JOIN inbound_connectors ic ON ic.id = i.inbound_connector_id
				WHERE ic.type = 'imap'`,
			)
			.all() as {
			id: number;
			imap_host: string;
			imap_port: number;
			imap_tls: number;
			imap_user: string;
			imap_pass: string;
		}[];

		for (const identity of identities) {
			if (this.identities.has(identity.id)) continue;

			this.addIdentity({
				identityId: identity.id,
				imapConfig: {
					host: identity.imap_host,
					port: identity.imap_port,
					secure: identity.imap_tls === 1,
					auth: {
						user: identity.imap_user,
						pass: identity.imap_pass,
					},
				},
			});
		}
	}

	private startIdentitySync(scheduled: ScheduledIdentity): void {
		// Run an initial sync immediately
		this.runSync(scheduled).catch(() => {});

		const intervalMs = scheduled.config.intervalMs ?? this.defaultIntervalMs;
		scheduled.timer = setInterval(() => {
			this.runSync(scheduled).catch(() => {});
		}, intervalMs);
	}

	private async runSync(scheduled: ScheduledIdentity): Promise<SyncAllResult> {
		if (scheduled.running) {
			throw new Error(`Identity ${scheduled.config.identityId} is already syncing`);
		}

		scheduled.running = true;
		scheduled.progress = {
			currentFolder: null,
			foldersCompleted: 0,
			totalFolders: 0,
			messagesNew: 0,
			errors: 0,
			startedAt: Date.now(),
		};
		const identityId = scheduled.config.identityId;
		const abortController = new AbortController();
		scheduled.abortController = abortController;

		const onProgress = (p: SyncProgress) => {
			if (!scheduled.progress) return;
			scheduled.progress = {
				currentFolder: p.currentFolder ?? null,
				foldersCompleted: p.foldersCompleted,
				totalFolders: p.totalFolders,
				messagesNew: p.messagesNew,
				errors: p.errors,
				startedAt: scheduled.progress.startedAt,
			};
		};

		const doSync = async (): Promise<SyncAllResult> => {
			try {
				const sync = await this.pool.acquire(identityId, scheduled.config.imapConfig);

				try {
					const onError = this.onSyncRecordError
						? (err: SyncError) => this.onSyncRecordError?.(identityId, err)
						: undefined;
					const result = await sync.syncAll(abortController.signal, onProgress, onError);
					scheduled.lastSync = Date.now();
					scheduled.lastError = null;
					scheduled.consecutiveErrors = 0;
					this.onSyncComplete?.(identityId, result);
					return result;
				} finally {
					this.pool.release(identityId, sync);
				}
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				// ImapFlow puts the actual server response in responseText, not message
				const imapErr = error as Error & { responseText?: string; responseStatus?: string };
				scheduled.lastError = imapErr.responseText
					? `${imapErr.responseStatus ?? "ERROR"}: ${imapErr.responseText}`
					: error.message;
				scheduled.consecutiveErrors++;
				this.onSyncError?.(identityId, error);

				// Apply exponential backoff by rescheduling with delay
				if (scheduled.consecutiveErrors > 1 && scheduled.timer) {
					clearInterval(scheduled.timer);
					const baseInterval = scheduled.config.intervalMs ?? this.defaultIntervalMs;
					const backoffMs = Math.min(
						baseInterval * 2 ** (scheduled.consecutiveErrors - 1),
						MAX_BACKOFF_MS,
					);
					scheduled.timer = setInterval(() => {
						this.runSync(scheduled).catch(() => {});
					}, backoffMs);
				}

				throw error;
			} finally {
				scheduled.running = false;
				scheduled.progress = null;
				scheduled.abortController = null;
				scheduled.syncPromise = null;
			}
		};

		const promise = doSync();
		scheduled.syncPromise = promise.then(() => {}).catch(() => {}); // Track without propagating rejection
		return promise;
	}
}
