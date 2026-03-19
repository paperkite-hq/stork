import type Database from "@signalapp/better-sqlite3";
import { ConnectionPool, type ConnectionPoolOptions } from "./connection-pool.js";
import type { ImapConfig, SyncAllResult, SyncProgress } from "./imap-sync.js";

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
	startedAt: number;
}

export interface AccountSyncConfig {
	accountId: number;
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
	onSyncComplete?: (accountId: number, result: SyncAllResult) => void;
	/** Called when a sync fails */
	onSyncError?: (accountId: number, error: Error) => void;
}

interface ScheduledAccount {
	config: AccountSyncConfig;
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
 * Manages periodic background sync for multiple IMAP accounts.
 *
 * Each account syncs on its own interval. Failed syncs use exponential
 * backoff to avoid hammering a broken server. Uses ConnectionPool to
 * reuse IMAP connections across sync cycles.
 */
export class SyncScheduler {
	private accounts: Map<number, ScheduledAccount> = new Map();
	private pool: ConnectionPool;
	private db: Database;
	private defaultIntervalMs: number;
	private onSyncComplete?: (accountId: number, result: SyncAllResult) => void;
	private onSyncError?: (accountId: number, error: Error) => void;
	private started = false;

	constructor(db: Database, options: SyncSchedulerOptions = {}) {
		this.db = db;
		this.defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS;
		this.pool = new ConnectionPool(db, options.poolOptions);
		this.onSyncComplete = options.onSyncComplete;
		this.onSyncError = options.onSyncError;
	}

	/**
	 * Adds an account to the scheduler.
	 * If the scheduler is already started, begins syncing immediately.
	 */
	addAccount(config: AccountSyncConfig): void {
		if (this.accounts.has(config.accountId)) {
			throw new Error(`Account ${config.accountId} is already scheduled`);
		}

		const scheduled: ScheduledAccount = {
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

		this.accounts.set(config.accountId, scheduled);

		if (this.started) {
			this.startAccountSync(scheduled);
		}
	}

	/**
	 * Removes an account from the scheduler and releases its connections.
	 */
	removeAccount(accountId: number): void {
		const scheduled = this.accounts.get(accountId);
		if (!scheduled) return;

		if (scheduled.timer) {
			clearInterval(scheduled.timer);
		}

		this.accounts.delete(accountId);
	}

	/**
	 * Starts the scheduler — begins periodic sync for all registered accounts.
	 */
	start(): void {
		if (this.started) return;
		this.started = true;

		for (const scheduled of this.accounts.values()) {
			this.startAccountSync(scheduled);
		}
	}

	/**
	 * Stops the scheduler — cancels all timers, aborts running syncs,
	 * waits for them to finish (up to 5s), then closes all connections.
	 */
	async stop(): Promise<void> {
		this.started = false;

		const pendingSyncs: Promise<void>[] = [];

		for (const scheduled of this.accounts.values()) {
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
	 * Triggers an immediate sync for a specific account.
	 * Returns the sync result, or throws if the account is already syncing.
	 */
	async syncNow(accountId: number): Promise<SyncAllResult> {
		const scheduled = this.accounts.get(accountId);
		if (!scheduled) {
			throw new Error(`Account ${accountId} is not registered`);
		}

		return this.runSync(scheduled);
	}

	/**
	 * Returns the status of all scheduled accounts.
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

		for (const [accountId, scheduled] of this.accounts) {
			status.set(accountId, {
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
	 * Loads all accounts from the database and adds them to the scheduler.
	 */
	loadAccountsFromDb(): void {
		const accounts = this.db
			.prepare("SELECT id, imap_host, imap_port, imap_tls, imap_user, imap_pass FROM accounts")
			.all() as {
			id: number;
			imap_host: string;
			imap_port: number;
			imap_tls: number;
			imap_user: string;
			imap_pass: string;
		}[];

		for (const account of accounts) {
			if (this.accounts.has(account.id)) continue;

			this.addAccount({
				accountId: account.id,
				imapConfig: {
					host: account.imap_host,
					port: account.imap_port,
					secure: account.imap_tls === 1,
					auth: {
						user: account.imap_user,
						pass: account.imap_pass,
					},
				},
			});
		}
	}

	private startAccountSync(scheduled: ScheduledAccount): void {
		// Run an initial sync immediately
		this.runSync(scheduled).catch(() => {});

		const intervalMs = scheduled.config.intervalMs ?? this.defaultIntervalMs;
		scheduled.timer = setInterval(() => {
			this.runSync(scheduled).catch(() => {});
		}, intervalMs);
	}

	private async runSync(scheduled: ScheduledAccount): Promise<SyncAllResult> {
		if (scheduled.running) {
			throw new Error(`Account ${scheduled.config.accountId} is already syncing`);
		}

		scheduled.running = true;
		scheduled.progress = {
			currentFolder: null,
			foldersCompleted: 0,
			totalFolders: 0,
			messagesNew: 0,
			startedAt: Date.now(),
		};
		const accountId = scheduled.config.accountId;
		const abortController = new AbortController();
		scheduled.abortController = abortController;

		const onProgress = (p: SyncProgress) => {
			if (!scheduled.progress) return;
			scheduled.progress = {
				currentFolder: p.currentFolder ?? null,
				foldersCompleted: p.foldersCompleted,
				totalFolders: p.totalFolders,
				messagesNew: p.messagesNew,
				startedAt: scheduled.progress.startedAt,
			};
		};

		const doSync = async (): Promise<SyncAllResult> => {
			try {
				const sync = await this.pool.acquire(accountId, scheduled.config.imapConfig);

				try {
					const result = await sync.syncAll(abortController.signal, onProgress);
					scheduled.lastSync = Date.now();
					scheduled.lastError = null;
					scheduled.consecutiveErrors = 0;
					this.onSyncComplete?.(accountId, result);
					return result;
				} finally {
					this.pool.release(accountId, sync);
				}
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				scheduled.lastError = error.message;
				scheduled.consecutiveErrors++;
				this.onSyncError?.(accountId, error);

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
		scheduled.syncPromise = promise.catch(() => {}); // Track without propagating rejection
		return promise;
	}
}
