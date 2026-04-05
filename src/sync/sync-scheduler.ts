import type Database from "better-sqlite3-multiple-ciphers";
import { ConnectionPool, type ConnectionPoolOptions } from "./connection-pool.js";
import type {
	ImapConfig,
	RelabelResult,
	SyncAllResult,
	SyncError,
	SyncProgress,
} from "./imap-sync.js";

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

export interface ConnectorSyncConfig {
	inboundConnectorId: number;
	imapConfig: ImapConfig;
	/** Sync interval in ms (default: 5 minutes) */
	intervalMs?: number;
}

/** @deprecated Use ConnectorSyncConfig */
export type IdentitySyncConfig = ConnectorSyncConfig;

export interface SyncSchedulerOptions {
	/** Default sync interval in ms (default: 5 minutes) */
	defaultIntervalMs?: number;
	/** Connection pool options */
	poolOptions?: ConnectionPoolOptions;
	/** Called when a sync completes */
	onSyncComplete?: (inboundConnectorId: number, result: SyncAllResult) => void;
	/** Called immediately when a sync error is recorded (for inline logging) */
	onSyncRecordError?: (inboundConnectorId: number, error: SyncError) => void;
	/** Called when a sync fails */
	onSyncError?: (inboundConnectorId: number, error: Error) => void;
}

interface ScheduledConnector {
	config: ConnectorSyncConfig;
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
 * Manages periodic background sync for multiple IMAP inbound connectors.
 *
 * Each connector syncs on its own interval. Failed syncs use exponential
 * backoff to avoid hammering a broken server. Uses ConnectionPool to
 * reuse IMAP connections across sync cycles.
 */
export class SyncScheduler {
	private connectors: Map<number, ScheduledConnector> = new Map();
	private pool: ConnectionPool;
	private db: Database.Database;
	private defaultIntervalMs: number;
	private onSyncComplete?: (inboundConnectorId: number, result: SyncAllResult) => void;
	private onSyncRecordError?: (inboundConnectorId: number, error: SyncError) => void;
	private onSyncError?: (inboundConnectorId: number, error: Error) => void;
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
	 * Adds an inbound connector to the scheduler.
	 * If the scheduler is already started, begins syncing immediately.
	 */
	addConnector(config: ConnectorSyncConfig): void {
		if (this.connectors.has(config.inboundConnectorId)) {
			throw new Error(`Connector ${config.inboundConnectorId} is already scheduled`);
		}

		const scheduled: ScheduledConnector = {
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

		this.connectors.set(config.inboundConnectorId, scheduled);

		if (this.started) {
			this.startConnectorSync(scheduled);
		}
	}

	/** @deprecated Use addConnector */
	addIdentity(config: ConnectorSyncConfig): void {
		this.addConnector(config);
	}

	/**
	 * Removes an inbound connector from the scheduler and releases its connections.
	 */
	removeConnector(inboundConnectorId: number): void {
		const scheduled = this.connectors.get(inboundConnectorId);
		if (!scheduled) return;

		if (scheduled.timer) {
			clearInterval(scheduled.timer);
		}

		this.connectors.delete(inboundConnectorId);
	}

	/** @deprecated Use removeConnector */
	removeIdentity(inboundConnectorId: number): void {
		this.removeConnector(inboundConnectorId);
	}

	/**
	 * Starts the scheduler — begins periodic sync for all registered connectors.
	 */
	start(): void {
		if (this.started) return;
		this.started = true;

		for (const scheduled of this.connectors.values()) {
			this.startConnectorSync(scheduled);
		}
	}

	/**
	 * Stops the scheduler — cancels all timers, aborts running syncs,
	 * waits for them to finish (up to 5s), then closes all connections.
	 */
	async stop(): Promise<void> {
		this.started = false;

		const pendingSyncs: Promise<void>[] = [];

		for (const scheduled of this.connectors.values()) {
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
	 * Triggers an immediate sync for a specific inbound connector.
	 * Returns the sync result, or throws if the connector is already syncing.
	 */
	async syncNow(inboundConnectorId: number): Promise<SyncAllResult> {
		const scheduled = this.connectors.get(inboundConnectorId);
		if (!scheduled) {
			throw new Error(`Connector ${inboundConnectorId} is not registered`);
		}

		return this.runSync(scheduled);
	}

	/**
	 * Deletes all locally-synced messages (deleted_from_server = 0) from the IMAP server
	 * for a specific inbound connector. Used as a one-time cleanup when transitioning
	 * from mirror mode to connector mode.
	 *
	 * Groups messages by folder and uses the existing deleteFromServer() batch-delete
	 * pattern (100 UIDs at a time) for crash safety.
	 */
	async cleanServerNow(inboundConnectorId: number): Promise<{ deleted: number }> {
		const scheduled = this.connectors.get(inboundConnectorId);
		if (!scheduled) {
			throw new Error(`Connector ${inboundConnectorId} is not registered`);
		}

		const rows = this.db
			.prepare(
				`SELECT f.path AS folder_path, m.uid
				FROM messages m
				JOIN folders f ON m.folder_id = f.id
				WHERE m.inbound_connector_id = ? AND m.deleted_from_server = 0
				ORDER BY f.path`,
			)
			.all(inboundConnectorId) as { folder_path: string; uid: number }[];

		if (rows.length === 0) return { deleted: 0 };

		// Group UIDs by folder path
		const byFolder = new Map<string, number[]>();
		for (const row of rows) {
			const uids = byFolder.get(row.folder_path) ?? [];
			uids.push(row.uid);
			byFolder.set(row.folder_path, uids);
		}

		const sync = await this.pool.acquire(inboundConnectorId, scheduled.config.imapConfig);
		let totalDeleted = 0;
		try {
			for (const [folderPath, uids] of byFolder) {
				totalDeleted += await sync.deleteFromServer(folderPath, uids);
			}
		} finally {
			this.pool.release(inboundConnectorId, sync);
		}

		return { deleted: totalDeleted };
	}

	/**
	 * Reconciles folder labels against current server state for a specific
	 * inbound connector. Detects cross-folder moves via Message-ID and updates
	 * labels to match the server's current folder memberships.
	 */
	async relabelFromServerNow(inboundConnectorId: number): Promise<RelabelResult> {
		const scheduled = this.connectors.get(inboundConnectorId);
		if (!scheduled) {
			throw new Error(`Connector ${inboundConnectorId} is not registered`);
		}

		const sync = await this.pool.acquire(inboundConnectorId, scheduled.config.imapConfig);
		try {
			return await sync.relabelFromServer();
		} finally {
			this.pool.release(inboundConnectorId, sync);
		}
	}

	/**
	 * Returns the status of all scheduled connectors.
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

		for (const [inboundConnectorId, scheduled] of this.connectors) {
			status.set(inboundConnectorId, {
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
	 * Loads all IMAP inbound connectors from the database and adds them to the scheduler.
	 * Cloudflare Email connectors are push-based (webhook/R2) and don't need polling.
	 */
	loadConnectorsFromDb(): void {
		const connectors = this.db
			.prepare(
				`SELECT id, imap_host, imap_port, imap_tls, imap_user, imap_pass
				FROM inbound_connectors
				WHERE type = 'imap'`,
			)
			.all() as {
			id: number;
			imap_host: string;
			imap_port: number;
			imap_tls: number;
			imap_user: string;
			imap_pass: string;
		}[];

		for (const connector of connectors) {
			if (this.connectors.has(connector.id)) continue;

			this.addConnector({
				inboundConnectorId: connector.id,
				imapConfig: {
					host: connector.imap_host,
					port: connector.imap_port,
					secure: connector.imap_tls === 1,
					auth: {
						user: connector.imap_user,
						pass: connector.imap_pass,
					},
				},
			});
		}
	}

	/** @deprecated Use loadConnectorsFromDb */
	loadIdentitiesFromDb(): void {
		this.loadConnectorsFromDb();
	}

	private startConnectorSync(scheduled: ScheduledConnector): void {
		// Run an initial sync immediately
		this.runSync(scheduled).catch(() => {});

		const intervalMs = scheduled.config.intervalMs ?? this.defaultIntervalMs;
		scheduled.timer = setInterval(() => {
			this.runSync(scheduled).catch(() => {});
		}, intervalMs);
	}

	private async runSync(scheduled: ScheduledConnector): Promise<SyncAllResult> {
		if (scheduled.running) {
			throw new Error(`Connector ${scheduled.config.inboundConnectorId} is already syncing`);
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
		const inboundConnectorId = scheduled.config.inboundConnectorId;
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
				const sync = await this.pool.acquire(inboundConnectorId, scheduled.config.imapConfig);

				try {
					const onError = this.onSyncRecordError
						? (err: SyncError) => this.onSyncRecordError?.(inboundConnectorId, err)
						: undefined;
					const result = await sync.syncAll(abortController.signal, onProgress, onError);
					scheduled.lastSync = Date.now();
					scheduled.lastError = null;
					scheduled.consecutiveErrors = 0;
					this.onSyncComplete?.(inboundConnectorId, result);
					return result;
				} finally {
					this.pool.release(inboundConnectorId, sync);
				}
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				// ImapFlow puts the actual server response in responseText, not message
				const imapErr = error as Error & { responseText?: string; responseStatus?: string };
				scheduled.lastError = imapErr.responseText
					? `${imapErr.responseStatus ?? "ERROR"}: ${imapErr.responseText}`
					: error.message;
				scheduled.consecutiveErrors++;
				this.onSyncError?.(inboundConnectorId, error);

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
