import type Database from "better-sqlite3-multiple-ciphers";
import { ImapFlow } from "imapflow";
import { type Attachment, type ParsedMail, simpleParser } from "mailparser";

export interface ImapConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: {
		user: string;
		pass: string;
	};
}

/** Classification of sync errors for retriability assessment */
export type SyncErrorType = "connection" | "folder" | "message" | "flags";

export interface SyncError {
	folderPath: string | null;
	uid: number | null;
	errorType: SyncErrorType;
	message: string;
	/** Whether this error is likely to succeed on retry */
	retriable: boolean;
}

export interface SyncResult {
	folder: string;
	newMessages: number;
	updatedFlags: number;
	deletedFolders: number;
	attachmentsSaved: number;
	/** Number of messages deleted from the IMAP server after syncing (connector mode) */
	deletedFromServer: number;
	errors: SyncError[];
}

export interface SyncAllResult {
	folders: SyncResult[];
	totalNew: number;
	totalErrors: number;
	/** True when the sync was cancelled via abort signal (e.g. shutdown) */
	aborted: boolean;
}

export interface SyncProgress {
	/** Current phase of the sync operation */
	phase: "listing-folders" | "syncing-folder" | "applying-labels";
	/** Folder currently being synced (only set during syncing-folder phase) */
	currentFolder?: string;
	/** Number of folders fully synced so far */
	foldersCompleted: number;
	/** Total number of folders to sync (0 until folder list is fetched) */
	totalFolders: number;
	/** Total new messages synced so far */
	messagesNew: number;
	/** Total errors encountered so far */
	errors: number;
}

/** Special-use folder mapping from IMAP attributes */
export type SpecialUse =
	| "\\Inbox"
	| "\\Sent"
	| "\\Drafts"
	| "\\Trash"
	| "\\Junk"
	| "\\Archive"
	| "\\All"
	| "\\Flagged"
	| null;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_BATCH_SIZE = 50;
/** Max UIDs per IMAP messageDelete call. Prevents overly-long UID-set strings on large initial syncs.
 *  Also used as the fetch batch size for interleaved fetch+delete in connector mode. */
const DELETE_BATCH_SIZE = 100;
/** Apply folder labels to messages after every this-many new messages within a folder.
 *  Keeps the UI responsive during large-folder syncs (e.g. Archive with 50k messages). */
const DEFAULT_SUB_BATCH_LABEL_SIZE = 500;

/**
 * Syncs messages from an IMAP server to local SQLite storage.
 *
 * Uses IMAP UIDs and UIDVALIDITY for efficient incremental sync.
 * Supports proper MIME parsing, attachment extraction, folder lifecycle,
 * flag sync, and error recovery with retry logic.
 */
export class ImapSync {
	private client: ImapFlow;
	private db: Database.Database;
	private inboundConnectorId: number;
	private config: ImapConfig;
	private subBatchLabelSize: number;

	private insertSyncError: Database.Statement | null = null;
	private activeOnError?: (error: SyncError) => void;

	constructor(
		config: ImapConfig,
		db: Database.Database,
		inboundConnectorId: number,
		subBatchLabelSize = DEFAULT_SUB_BATCH_LABEL_SIZE,
	) {
		this.config = config;
		this.client = new ImapFlow({
			...config,
			logger: false,
		});
		this.db = db;
		this.inboundConnectorId = inboundConnectorId;
		this.subBatchLabelSize = subBatchLabelSize;

		// Prepare statement for persisting errors (table may not exist in tests
		// that use an older schema — check first)
		const hasTable = this.db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_errors'")
			.get();
		if (hasTable) {
			this.insertSyncError = this.db.prepare(`
				INSERT INTO sync_errors (inbound_connector_id, folder_path, uid, error_type, message, retriable)
				VALUES (?, ?, ?, ?, ?, ?)
			`);
		}
	}

	/**
	 * Records a sync error both in the result array and in the database.
	 */
	private recordError(result: SyncResult, error: SyncError): void {
		result.errors.push(error);
		this.insertSyncError?.run(
			this.inboundConnectorId,
			error.folderPath,
			error.uid,
			error.errorType,
			error.message,
			error.retriable ? 1 : 0,
		);
		this.activeOnError?.(error);
	}

	/**
	 * Marks all unresolved errors for this identity as resolved.
	 * Called at the start of each sync cycle so stale errors don't accumulate.
	 */
	private resolveStaleErrors(): void {
		if (!this.insertSyncError) return;
		this.db
			.prepare(
				`UPDATE sync_errors SET resolved = 1, resolved_at = datetime('now')
				 WHERE inbound_connector_id = ? AND resolved = 0`,
			)
			.run(this.inboundConnectorId);
	}

	async connect(): Promise<void> {
		await withRetry(async () => {
			// ImapFlow instances cannot be reconnected once closed — create a fresh
			// instance on each retry to avoid "Can not re-use ImapFlow instance".
			// Close the previous client first to release the underlying TCP socket
			// before creating a new one.
			suppressImapFlowErrors(this.client);
			const oldSocket = getImapSocket(this.client);
			try {
				this.client.close();
			} catch {
				// Ignore — client may not be connected yet on the first attempt
			}
			// Re-add error suppression: close() strips handlers before destroying
			// the socket (possibly via setImmediate), leaving a window where
			// ECONNRESET can fire unhandled.
			suppressSocketErrors(oldSocket);
			if (oldSocket && typeof oldSocket.destroy === "function") {
				oldSocket.destroy();
			}
			this.client = new ImapFlow({
				...this.config,
				logger: false,
			});
			try {
				return await this.client.connect();
			} catch (err) {
				// Suppress errors on the just-failed client/socket immediately to
				// prevent ECONNRESET from surfacing as an unhandled exception in the
				// window between this rejection and the next retry (or forceClose).
				suppressImapFlowErrors(this.client);
				const failedSocket = getImapSocket(this.client);
				suppressSocketErrors(failedSocket);
				if (failedSocket && typeof failedSocket.destroy === "function") {
					failedSocket.destroy();
				}
				throw err;
			}
		}, "IMAP connect");
	}

	async disconnect(): Promise<void> {
		try {
			await this.client.logout();
		} catch {
			// Ignore errors during disconnect — connection may already be closed
		}
	}

	/**
	 * Forcefully closes the IMAP connection by destroying the underlying socket.
	 * Unlike disconnect(), this does not send a LOGOUT command and returns
	 * immediately. Any pending FETCH operations will throw, unblocking
	 * async iterators that are waiting for server data.
	 */
	forceClose(): void {
		suppressImapFlowErrors(this.client);
		const socket = getImapSocket(this.client);
		try {
			this.client.close();
		} catch {
			// Ignore errors — connection may already be closed
		}
		// Re-add error suppression: close() strips handlers before destroying
		// the socket (possibly via setImmediate), leaving a window where
		// ECONNRESET can fire unhandled.
		suppressSocketErrors(socket);
		// Destroy the socket synchronously to prevent ImapFlow's deferred
		// close from stripping our error handlers and leaving an orphaned
		// socket that can receive ECONNRESET with no listener.
		if (socket && typeof socket.destroy === "function") {
			socket.destroy();
		}
	}

	/**
	 * Full sync: sync folders, then sync each folder's messages.
	 * Also creates labels from IMAP folder names and applies them to messages.
	 *
	 * Accepts an optional AbortSignal for graceful cancellation — when aborted,
	 * the sync finishes the current message/batch and returns partial results.
	 *
	 * Accepts an optional onProgress callback that fires as sync proceeds,
	 * useful for showing real-time status in the UI.
	 *
	 * Accepts an optional onError callback that fires immediately when an
	 * error is recorded, so callers can log errors inline rather than
	 * waiting for the summary.
	 */
	async syncAll(
		signal?: AbortSignal,
		onProgress?: (progress: SyncProgress) => void,
		onError?: (error: SyncError) => void,
	): Promise<SyncAllResult> {
		const result: SyncAllResult = { folders: [], totalNew: 0, totalErrors: 0, aborted: false };

		if (signal?.aborted) return result;

		this.activeOnError = onError;

		// Mark previous errors as resolved — they'll be re-recorded if they recur
		this.resolveStaleErrors();

		// When the abort signal fires, force-close the IMAP connection to
		// immediately unblock any `for await` loops waiting on server data.
		// Without this, the loop only checks `signal.aborted` between messages,
		// so a slow FETCH (large mailbox) would hang until the next message arrives.
		const onAbort = () => this.forceClose();
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			onProgress?.({
				phase: "listing-folders",
				foldersCompleted: 0,
				totalFolders: 0,
				messagesNew: 0,
				errors: 0,
			});

			const folders = await this.syncFolders();

			// Ensure labels exist for all synced folders and for this identity
			this.ensureLabelsForFolders();
			this.ensureIdentityLabel();

			// Read connector mode setting from the inbound connector.
			const connectorRow = this.db
				.prepare(`
					SELECT sync_delete_from_server
					FROM inbound_connectors
					WHERE id = ?
				`)
				.get(this.inboundConnectorId) as { sync_delete_from_server: number } | undefined;
			const deleteFromServerAfterSync = connectorRow?.sync_delete_from_server === 1;

			const totalFolders = folders.length;
			let foldersCompleted = 0;

			for (const folderPath of folders) {
				if (signal?.aborted) break;

				onProgress?.({
					phase: "syncing-folder",
					currentFolder: folderPath,
					foldersCompleted,
					totalFolders,
					messagesNew: result.totalNew,
					errors: result.totalErrors,
				});

				const folderResult = await this.syncFolder(folderPath, signal, deleteFromServerAfterSync);
				result.folders.push(folderResult);
				result.totalNew += folderResult.newMessages;
				result.totalErrors += folderResult.errors.length;
				foldersCompleted++;

				// Apply labels immediately after each folder so messages are
				// visible in the UI during sync, not only after all folders finish
				if (folderResult.newMessages > 0) {
					this.applyFolderLabelsToMessages();
				}

				onProgress?.({
					phase: "syncing-folder",
					currentFolder: folderPath,
					foldersCompleted,
					totalFolders,
					messagesNew: result.totalNew,
					errors: result.totalErrors,
				});
			}

			onProgress?.({
				phase: "applying-labels",
				foldersCompleted,
				totalFolders,
				messagesNew: result.totalNew,
				errors: result.totalErrors,
			});

			// Final pass: catch any messages that may have been missed
			this.applyFolderLabelsToMessages();
			this.applyIdentityLabelToMessages();

			// Update cached label counts so API endpoints stay O(1)
			// regardless of database size. Runs once per sync cycle.
			this.refreshLabelCounts();

			if (signal?.aborted) {
				result.aborted = true;
			}

			return result;
		} finally {
			this.activeOnError = undefined;
			signal?.removeEventListener("abort", onAbort);
		}
	}

	/**
	 * Lists all mailbox folders from the IMAP server, syncs folder metadata,
	 * and detects deleted/renamed folders.
	 */
	async syncFolders(): Promise<string[]> {
		const mailboxes = await withRetry(() => this.client.list(), "list mailboxes");
		const remotePaths = new Set<string>();

		const upsertFolder = this.db.prepare(`
			INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, special_use)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(inbound_connector_id, path) WHERE inbound_connector_id IS NOT NULL DO UPDATE SET
				name = excluded.name,
				delimiter = excluded.delimiter,
				flags = excluded.flags,
				special_use = excluded.special_use
		`);

		const insertMany = this.db.transaction(() => {
			for (const mailbox of mailboxes) {
				// Skip duplicate paths (some IMAP servers report the same folder twice)
				if (remotePaths.has(mailbox.path)) continue;
				// Skip non-selectable folders (namespace roots, \Noselect)
				const flags = mailbox.flags ? Array.from(mailbox.flags) : [];
				if (flags.some((f) => f.toLowerCase() === "\\noselect")) continue;

				const specialUse = resolveSpecialUse(mailbox);
				upsertFolder.run(
					this.inboundConnectorId,
					mailbox.path,
					mailbox.name,
					mailbox.delimiter,
					JSON.stringify(flags),
					specialUse,
				);
				remotePaths.add(mailbox.path);
			}
		});

		insertMany();

		// Detect deleted folders: remove local folders no longer on server
		this.pruneDeletedFolders(remotePaths);

		return Array.from(remotePaths);
	}

	/**
	 * Removes local folders that no longer exist on the IMAP server.
	 * Cascading deletes in the schema handle messages and attachments.
	 */
	private pruneDeletedFolders(remotePaths: Set<string>): number {
		const localFolders = this.db
			.prepare("SELECT id, path FROM folders WHERE inbound_connector_id = ?")
			.all(this.inboundConnectorId) as { id: number; path: string }[];

		let deleted = 0;
		const deleteFolder = this.db.prepare("DELETE FROM folders WHERE id = ?");

		for (const local of localFolders) {
			if (!remotePaths.has(local.path)) {
				deleteFolder.run(local.id);
				deleted++;
			}
		}

		return deleted;
	}

	/**
	 * Syncs messages from a specific folder using an interleaved fetch+delete design.
	 *
	 * Phase 0: Acquire lock → get mailbox status, check UIDVALIDITY, update metadata
	 *          → search for new UIDs → release lock.
	 * Phase 1 (per-batch): For each batch of DELETE_BATCH_SIZE UIDs:
	 *   a. acquire lock → fetchUidBatch() → release lock
	 *   b. if connector mode: deleteFromServer() for this batch (acquires its own lock)
	 * Phase 2: Acquire lock → sync flags → release lock.
	 * Phase 3 (crash recovery): Delete any pending_archive=1, deleted_from_server=0
	 *          messages not handled in Phase 1 (from previous incomplete cycles).
	 */
	async syncFolder(
		folderPath: string,
		signal?: AbortSignal,
		deleteFromServerAfterSync = false,
	): Promise<SyncResult> {
		const result: SyncResult = {
			folder: folderPath,
			newMessages: 0,
			updatedFlags: 0,
			deletedFolders: 0,
			attachmentsSaved: 0,
			deletedFromServer: 0,
			errors: [],
		};

		const folder = this.db
			.prepare("SELECT id, uid_validity FROM folders WHERE inbound_connector_id = ? AND path = ?")
			.get(this.inboundConnectorId, folderPath) as
			| { id: number; uid_validity: number | null }
			| undefined;

		if (!folder) {
			this.recordError(result, {
				folderPath,
				uid: null,
				errorType: "folder",
				message: `Folder not found in database: ${folderPath}`,
				retriable: true,
			});
			return result;
		}

		// Phase 0: acquire lock → get mailbox status, check UIDVALIDITY, update
		// metadata → search for new UIDs → release lock.
		let newUids: number[] = [];
		{
			let lock: { release: () => void };
			try {
				lock = await withRetry(() => this.client.getMailboxLock(folderPath), `lock ${folderPath}`);
			} catch (err) {
				this.recordError(result, {
					folderPath,
					uid: null,
					errorType: "folder",
					message: `Could not lock mailbox ${folderPath}: ${formatImapError(err)} [STORK-E001]`,
					retriable: true,
				});
				return result;
			}

			try {
				const mailboxStatus = this.client.mailbox;
				if (!mailboxStatus) {
					this.recordError(result, {
						folderPath,
						uid: null,
						errorType: "folder",
						message: `Could not open mailbox: ${folderPath}`,
						retriable: true,
					});
					return result;
				}

				// Check UIDVALIDITY — if it changed, the folder was recreated; full resync needed
				if (folder.uid_validity && BigInt(folder.uid_validity) !== mailboxStatus.uidValidity) {
					this.db.prepare("DELETE FROM messages WHERE folder_id = ?").run(folder.id);
					this.db
						.prepare("DELETE FROM sync_state WHERE inbound_connector_id = ? AND folder_id = ?")
						.run(this.inboundConnectorId, folder.id);
				}

				// Update folder metadata
				this.db
					.prepare(`
					UPDATE folders SET
						uid_validity = ?,
						uid_next = ?,
						message_count = ?,
						last_synced_at = datetime('now')
					WHERE id = ?
				`)
					.run(mailboxStatus.uidValidity, mailboxStatus.uidNext, mailboxStatus.exists, folder.id);

				// Search for new UIDs (skip empty folders — IMAP SEARCH/FETCH on
				// an empty mailbox returns "Invalid messageset")
				if (mailboxStatus.exists > 0) {
					const syncState = this.db
						.prepare(
							"SELECT last_uid FROM sync_state WHERE inbound_connector_id = ? AND folder_id = ?",
						)
						.get(this.inboundConnectorId, folder.id) as { last_uid: number } | undefined;

					const lastUid = syncState?.last_uid ?? 0;
					const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";

					try {
						const searchResult = await this.client.search({ uid: range }, { uid: true });
						// ImapFlow returns false when search finds nothing or fails
						if (searchResult && Array.isArray(searchResult) && searchResult.length > 0) {
							newUids = searchResult as number[];
						}
					} catch (err) {
						if (signal?.aborted) throw err;
						this.recordError(result, {
							folderPath,
							uid: null,
							errorType: "folder",
							message: `Search failed for ${folderPath}: ${formatImapError(err)} [STORK-E002]`,
							retriable: true,
						});
					}
				}
			} finally {
				try {
					lock.release();
				} catch {
					// Lock release may fail if connection was force-closed during shutdown
				}
			}
		}

		// Phase 1 (per-batch loop): fetch+delete interleaved in batches of DELETE_BATCH_SIZE.
		// Track a running label-application counter across all batches.
		let runningLabelCount = 0;

		for (let i = 0; i < newUids.length; i += DELETE_BATCH_SIZE) {
			if (signal?.aborted) break;

			const batchUids = newUids.slice(i, i + DELETE_BATCH_SIZE);

			// Phase 1a: acquire lock → fetch this batch → release lock
			let batchCount = 0;
			{
				let lock: { release: () => void };
				try {
					lock = await withRetry(
						() => this.client.getMailboxLock(folderPath),
						`lock ${folderPath}`,
					);
				} catch (err) {
					if (signal?.aborted) break;
					this.recordError(result, {
						folderPath,
						uid: null,
						errorType: "folder",
						message: `Could not lock mailbox ${folderPath} for fetch: ${formatImapError(err)} [STORK-E001]`,
						retriable: true,
					});
					break;
				}

				try {
					batchCount = await this.fetchUidBatch(
						folder.id,
						batchUids,
						result,
						signal,
						deleteFromServerAfterSync,
					);
				} catch (err) {
					if (signal?.aborted) throw err;
					this.recordError(result, {
						folderPath,
						uid: null,
						errorType: "folder",
						message: `Fetch failed for ${folderPath}: ${formatImapError(err)} [STORK-E002]`,
						retriable: true,
					});
				} finally {
					try {
						lock.release();
					} catch {
						// Lock release may fail if connection was force-closed during shutdown
					}
				}
			}

			result.newMessages += batchCount;
			runningLabelCount += batchCount;

			// Apply labels periodically across batches so messages become queryable
			// by label before the entire folder finishes syncing
			if (runningLabelCount >= this.subBatchLabelSize) {
				this.applyFolderLabelsToMessages();
				runningLabelCount = 0;
			}

			// Phase 1b: if connector mode, delete this batch from the server.
			// deleteFromServer() acquires its own lock per batch internally.
			if (deleteFromServerAfterSync && !signal?.aborted) {
				try {
					const deleted = await this.deleteFromServer(folderPath, batchUids);
					result.deletedFromServer += deleted;
				} catch (err) {
					if (signal?.aborted) throw err;
					this.recordError(result, {
						folderPath,
						uid: null,
						errorType: "folder",
						message: `Failed to delete synced messages from server: ${formatImapError(err)} [STORK-E005]`,
						retriable: true,
					});
				}
			}
		}

		// Phase 2: sync flags on existing messages (skip if aborted).
		// Acquires and releases its own lock internally.
		if (!signal?.aborted) {
			let lock: { release: () => void } | null = null;
			try {
				lock = await withRetry(
					() => this.client.getMailboxLock(folderPath),
					`lock ${folderPath} for flags`,
				);
				const flagCount = await this.syncFlags(folder.id, result, signal);
				result.updatedFlags = flagCount;
			} catch (err) {
				if (signal?.aborted) throw err;
				this.recordError(result, {
					folderPath,
					uid: null,
					errorType: "flags",
					message: `Could not acquire lock for flag sync on ${folderPath}: ${formatImapError(err)} [STORK-E003]`,
					retriable: true,
				});
			} finally {
				try {
					lock?.release();
				} catch {
					// Lock release may fail if connection was force-closed during shutdown
				}
			}
		}

		// Phase 3 (crash recovery): delete any pending_archive=1, deleted_from_server=0
		// messages not already handled in Phase 1. These are from previous incomplete
		// cycles where the process was killed after fetch but before delete.
		// Only runs in connector mode and when not aborted.
		if (deleteFromServerAfterSync && !signal?.aborted) {
			try {
				const pendingRows = this.db
					.prepare(
						"SELECT uid FROM messages WHERE folder_id = ? AND pending_archive = 1 AND deleted_from_server = 0",
					)
					.all(folder.id) as { uid: number }[];

				// Filter out UIDs already processed in Phase 1 (avoid double-delete)
				const phase1UidSet = new Set(newUids);
				const crashRecoveryUids = pendingRows
					.map((r) => r.uid)
					.filter((uid) => !phase1UidSet.has(uid));

				if (crashRecoveryUids.length > 0) {
					const deleted = await this.deleteFromServer(folderPath, crashRecoveryUids);
					result.deletedFromServer += deleted;
				}
			} catch (err) {
				if (signal?.aborted) throw err;
				this.recordError(result, {
					folderPath,
					uid: null,
					errorType: "folder",
					message: `Failed to delete crash-recovery messages from server: ${formatImapError(err)} [STORK-E005]`,
					retriable: true,
				});
			}
		}

		return result;
	}

	/**
	 * Fetches a specific list of UIDs, parses MIME, stores messages, and extracts attachments.
	 *
	 * Takes an explicit list of UIDs to fetch (used by the interleaved fetch+delete loop
	 * in syncFolder). Updates last_uid in sync_state after processing the batch.
	 *
	 * In connector mode, marks each newly-stored message as pending_archive=1 so that
	 * a crash between fetch and delete is recoverable — the next sync cycle picks
	 * up pending_archive=1 records and retries the deletion (Phase 3 crash recovery).
	 *
	 * Returns the count of new messages stored.
	 */
	private async fetchUidBatch(
		folderId: number,
		uids: number[],
		result: SyncResult,
		signal?: AbortSignal,
		vaultMode = false,
	): Promise<number> {
		if (uids.length === 0) return 0;

		const syncState = this.db
			.prepare("SELECT last_uid FROM sync_state WHERE inbound_connector_id = ? AND folder_id = ?")
			.get(this.inboundConnectorId, folderId) as { last_uid: number } | undefined;

		const lastUid = syncState?.last_uid ?? 0;

		const insertMessage = this.db.prepare(`
			INSERT OR IGNORE INTO messages (
				inbound_connector_id, folder_id, uid, message_id, in_reply_to, "references",
				subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses,
				date, text_body, html_body, flags, size, has_attachments, raw_headers
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const insertAttachment = this.db.prepare(`
			INSERT INTO attachments (message_id, filename, content_type, size, content_id, data)
			VALUES (?, ?, ?, ?, ?, ?)
		`);

		let maxUid = lastUid;
		let count = 0;

		try {
			for await (const message of this.client.fetch(
				uids,
				{
					uid: true,
					envelope: true,
					bodyStructure: true,
					flags: true,
					size: true,
					source: true,
				},
				{ uid: true },
			)) {
				// Check abort signal between messages for graceful cancellation
				if (signal?.aborted) break;

				try {
					const source = message.source;
					if (!source) {
						this.recordError(result, {
							folderPath: result.folder,
							uid: message.uid,
							errorType: "message",
							message: `UID ${message.uid}: no source available`,
							retriable: true,
						});
						continue;
					}

					// Parse MIME with mailparser
					const parsed = await simpleParser(source);

					const envelope = message.envelope;
					if (!envelope) {
						this.recordError(result, {
							folderPath: result.folder,
							uid: message.uid,
							errorType: "message",
							message: `UID ${message.uid}: no envelope available`,
							retriable: true,
						});
						continue;
					}
					const fromAddr = envelope.from?.[0];
					const toAddrs = envelope.to?.map((a) => a.address).filter(Boolean);
					const ccAddrs = envelope.cc?.map((a) => a.address).filter(Boolean);
					const bccAddrs = envelope.bcc?.map((a) => a.address).filter(Boolean);
					const refs = parsed.references
						? Array.isArray(parsed.references)
							? parsed.references
							: [parsed.references]
						: null;

					const dbResult = insertMessage.run(
						this.inboundConnectorId,
						folderId,
						message.uid,
						toStringOrNull(envelope.messageId),
						toStringOrNull(envelope.inReplyTo),
						refs ? JSON.stringify(refs) : null,
						toStringOrNull(envelope.subject),
						toStringOrNull(fromAddr?.address),
						toStringOrNull(fromAddr?.name),
						toAddrs ? JSON.stringify(toAddrs) : null,
						ccAddrs ? JSON.stringify(ccAddrs) : null,
						bccAddrs ? JSON.stringify(bccAddrs) : null,
						envelope.date instanceof Date && !Number.isNaN(envelope.date.getTime())
							? envelope.date.toISOString()
							: typeof envelope.date === "string"
								? envelope.date
								: null,
						typeof parsed.text === "string" ? parsed.text : null,
						typeof parsed.html === "string" ? parsed.html : null,
						Array.from(message.flags ?? new Set()).join(","),
						typeof message.size === "number" ? message.size : null,
						parsed.attachments.length > 0 ? 1 : 0,
						formatHeaders(parsed),
					);

					// Extract and store attachments
					if (dbResult.changes > 0 && parsed.attachments.length > 0) {
						const messageId = dbResult.lastInsertRowid;
						for (const att of parsed.attachments) {
							insertAttachment.run(
								messageId,
								att.filename ?? null,
								toStringOrNull(att.contentType) ?? "application/octet-stream",
								typeof att.size === "number" ? att.size : (att.content?.length ?? 0),
								att.contentId ?? null,
								att.content ?? null,
							);
							result.attachmentsSaved++;
						}
					}

					if (message.uid > maxUid) maxUid = message.uid;

					// Mark message as pending server deletion for crash-safe connector mode.
					// This must be set BEFORE Phase 1b (deleteFromServer) runs so that a
					// crash between fetch and delete is recoverable — the next sync cycle's
					// Phase 3 will find pending_archive=1 and retry the deletion.
					if (vaultMode && dbResult.changes > 0) {
						this.db
							.prepare("UPDATE messages SET pending_archive = 1 WHERE folder_id = ? AND uid = ?")
							.run(folderId, message.uid);
					}

					count++;
				} catch (err) {
					this.recordError(result, {
						folderPath: result.folder,
						uid: message.uid,
						errorType: "message",
						message: `Failed to process UID ${message.uid}: ${err instanceof Error ? err.message : err} [STORK-E004]`,
						retriable: false,
					});
				}
			}
		} catch (err) {
			// When the connection is force-closed during shutdown, the async
			// iterator throws a connection error. Treat this as a normal abort.
			if (!signal?.aborted) {
				throw err;
			}
		}

		// Update sync state to the max UID seen in this batch
		if (maxUid > lastUid) {
			this.db
				.prepare(`
				INSERT INTO sync_state (inbound_connector_id, folder_id, last_uid, last_synced_at)
				VALUES (?, ?, ?, datetime('now'))
				ON CONFLICT(inbound_connector_id, folder_id) DO UPDATE SET
					last_uid = excluded.last_uid,
					last_synced_at = excluded.last_synced_at
			`)
				.run(this.inboundConnectorId, folderId, maxUid);
		}

		return count;
	}

	/**
	 * Syncs flags (read/unread, starred, etc.) for messages already in the database.
	 * Fetches flags for all known UIDs and updates any that changed.
	 */
	private async syncFlags(
		folderId: number,
		result: SyncResult,
		signal?: AbortSignal,
	): Promise<number> {
		const localMessages = this.db
			.prepare("SELECT uid, flags FROM messages WHERE folder_id = ? AND deleted_from_server = 0")
			.all(folderId) as { uid: number; flags: string }[];

		if (localMessages.length === 0) return 0;

		const uidSet = localMessages.map((m) => m.uid);
		const localFlagMap = new Map<number, string>();
		for (const m of localMessages) {
			localFlagMap.set(m.uid, m.flags);
		}

		const updateFlags = this.db.prepare(
			"UPDATE messages SET flags = ? WHERE folder_id = ? AND uid = ?",
		);

		let updated = 0;

		// Fetch flags in batches to avoid oversized IMAP commands
		for (let i = 0; i < uidSet.length; i += FETCH_BATCH_SIZE) {
			if (signal?.aborted) break;
			const batch = uidSet.slice(i, i + FETCH_BATCH_SIZE);
			const rangeStr = batch.join(",");

			try {
				for await (const msg of this.client.fetch(
					rangeStr,
					{
						uid: true,
						flags: true,
					},
					{ uid: true },
				)) {
					const newFlags = Array.from(msg.flags ?? new Set()).join(",");
					const oldFlags = localFlagMap.get(msg.uid);
					if (oldFlags !== newFlags) {
						updateFlags.run(newFlags, folderId, msg.uid);
						updated++;
					}
				}
			} catch (err) {
				// Connection force-closed during shutdown — treat as normal abort
				if (signal?.aborted) break;
				this.recordError(result, {
					folderPath: result.folder,
					uid: null,
					errorType: "flags",
					message: `Flag sync failed for "${result.folder}" (UIDs ${batch[0]}–${batch[batch.length - 1]}): ${formatImapError(err)} [STORK-E003]`,
					retriable: true,
				});
			}
		}

		return updated;
	}

	/**
	 * Creates labels for all synced IMAP folders that don't already have one.
	 * Uses the folder's display name as the label name, with source='imap'.
	 */
	ensureLabelsForFolders(): void {
		const folders = this.db
			.prepare("SELECT id, name FROM folders WHERE inbound_connector_id = ?")
			.all(this.inboundConnectorId) as { id: number; name: string }[];

		const upsertLabel = this.db.prepare(`
			INSERT INTO labels (name, source)
			VALUES (?, 'imap')
			ON CONFLICT(name) DO NOTHING
		`);

		const insertMany = this.db.transaction(() => {
			for (const folder of folders) {
				upsertLabel.run(folder.name);
			}
		});

		insertMany();
	}

	/**
	 * Applies folder-derived labels to messages that don't have them yet.
	 * Each message gets a label matching its IMAP folder name.
	 */
	applyFolderLabelsToMessages(): void {
		// For each folder, find the matching label and apply it to messages
		// that don't already have it
		this.db
			.prepare(`
			INSERT OR IGNORE INTO message_labels (message_id, label_id)
			SELECT m.id, l.id
			FROM messages m
			JOIN folders f ON f.id = m.folder_id
			JOIN labels l ON l.name = f.name
			LEFT JOIN message_labels ml ON ml.message_id = m.id AND ml.label_id = l.id
			WHERE m.inbound_connector_id = ? AND ml.message_id IS NULL
		`)
			.run(this.inboundConnectorId);
	}

	/**
	 * Recomputes and caches message_count and unread_count on the labels table.
	 * Called at the end of each sync cycle. This keeps the GET /labels API
	 * endpoint O(labels) — a simple column read — instead of forcing it to
	 * re-join all of message_labels × messages on every request.
	 *
	 * Uses a single GROUP BY scan instead of N correlated subqueries, so the
	 * full message_labels × messages join happens once (not once per label).
	 */
	refreshLabelCounts(): void {
		// One pass: count total and unread per label across all identities (labels are now global)
		const counts = this.db
			.prepare(`
				SELECT ml.label_id,
					COUNT(*) AS message_count,
					SUM(CASE WHEN m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%' THEN 1 ELSE 0 END) AS unread_count
				FROM message_labels ml
				JOIN messages m ON m.id = ml.message_id
				GROUP BY ml.label_id
			`)
			.all() as Array<{
			label_id: number;
			message_count: number;
			unread_count: number;
		}>;

		const updateStmt = this.db.prepare(
			"UPDATE labels SET message_count = ?, unread_count = ? WHERE id = ?",
		);

		const applyUpdate = this.db.transaction(
			(rows: Array<{ label_id: number; message_count: number; unread_count: number }>) => {
				// Reset all labels to 0; labels with no messages won't appear in counts above
				this.db.prepare("UPDATE labels SET message_count = 0, unread_count = 0").run();
				for (const row of rows) {
					updateStmt.run(row.message_count, row.unread_count, row.label_id);
				}
			},
		);
		applyUpdate(counts);
	}

	/**
	 * Ensures a label exists for this inbound connector (source='connector'), named after
	 * the connector's display name. These auto-labels enable label-based connector filtering
	 * that composes with other label filters.
	 */
	ensureIdentityLabel(): void {
		const connector = this.db
			.prepare("SELECT name FROM inbound_connectors WHERE id = ?")
			.get(this.inboundConnectorId) as { name: string } | undefined;
		if (!connector) return;

		this.db
			.prepare(`
				INSERT INTO labels (name, source, color)
				VALUES (?, 'connector', ?)
				ON CONFLICT(name) DO UPDATE SET source = 'connector'
			`)
			.run(connector.name, this.connectorLabelColor());
	}

	/**
	 * Applies the connector label to all messages from this connector that don't have it yet.
	 * Runs after each sync cycle alongside applyFolderLabelsToMessages().
	 */
	applyIdentityLabelToMessages(): void {
		const connector = this.db
			.prepare("SELECT name FROM inbound_connectors WHERE id = ?")
			.get(this.inboundConnectorId) as { name: string } | undefined;
		if (!connector) return;

		this.db
			.prepare(`
				INSERT OR IGNORE INTO message_labels (message_id, label_id)
				SELECT m.id, l.id
				FROM messages m
				JOIN labels l ON l.name = ? AND l.source = 'connector'
				LEFT JOIN message_labels ml ON ml.message_id = m.id AND ml.label_id = l.id
				WHERE m.inbound_connector_id = ? AND ml.message_id IS NULL
			`)
			.run(connector.name, this.inboundConnectorId);
	}

	/**
	 * Returns a color for the connector label based on connector ID position.
	 * Uses a curated palette of distinct, accessible colors.
	 */
	private connectorLabelColor(): string {
		const palette = [
			"#3b82f6", // blue
			"#10b981", // emerald
			"#f59e0b", // amber
			"#8b5cf6", // violet
			"#ef4444", // red
			"#06b6d4", // cyan
			"#ec4899", // pink
			"#84cc16", // lime
		];
		return palette[(this.inboundConnectorId - 1) % palette.length] ?? palette[0];
	}

	/**
	 * Recomputes and caches total message count and unread count on the identities table.
	 * Called at the end of each sync cycle alongside refreshLabelCounts(). This keeps
	 * the GET /all-messages/count and GET /unread-messages/count endpoints O(1) —
	 * a single row read — instead of a full messages table scan on every request.
	 */

	/**
	 * Detects messages deleted from the server since last sync.
	 * Returns UIDs of messages that exist locally but not on the server.
	 */
	async detectServerDeletions(folderPath: string): Promise<number[]> {
		const folder = this.db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = ?")
			.get(this.inboundConnectorId, folderPath) as { id: number } | undefined;

		if (!folder) return [];

		const localUids = this.db
			.prepare("SELECT uid FROM messages WHERE folder_id = ? AND deleted_from_server = 0")
			.all(folder.id) as { uid: number }[];

		if (localUids.length === 0) return [];

		const lock = await this.client.getMailboxLock(folderPath);
		try {
			// Ask the server which UIDs still exist
			const serverUids = new Set<number>();
			for await (const msg of this.client.fetch("1:*", { uid: true })) {
				serverUids.add(msg.uid);
			}

			return localUids.filter((m) => !serverUids.has(m.uid)).map((m) => m.uid);
		} finally {
			lock.release();
		}
	}

	/**
	 * Deletes messages from the server that have been synced locally.
	 * Only operates on messages explicitly marked for server deletion.
	 *
	 * Deletes in batches of DELETE_BATCH_SIZE to avoid overly-long IMAP UID-set
	 * strings on large initial syncs (e.g. a mailbox with thousands of messages).
	 * Each batch is fully deleted and marked in the DB before the next batch starts,
	 * so a crash mid-batch only loses progress on the current batch — pending_archive
	 * records for unprocessed batches remain and are picked up on the next sync cycle.
	 */
	async deleteFromServer(folderPath: string, uids: number[]): Promise<number> {
		if (uids.length === 0) return 0;

		const folder = this.db
			.prepare("SELECT id FROM folders WHERE inbound_connector_id = ? AND path = ?")
			.get(this.inboundConnectorId, folderPath) as { id: number } | undefined;

		const markDeleted = folder
			? this.db.prepare(
					"UPDATE messages SET deleted_from_server = 1, pending_archive = 0 WHERE folder_id = ? AND uid = ?",
				)
			: null;

		let totalDeleted = 0;

		for (let i = 0; i < uids.length; i += DELETE_BATCH_SIZE) {
			const batch = uids.slice(i, i + DELETE_BATCH_SIZE);

			const lock = await this.client.getMailboxLock(folderPath);
			try {
				await this.client.messageDelete(batch, { uid: true });

				if (folder && markDeleted) {
					const markMany = this.db.transaction(() => {
						for (const uid of batch) {
							markDeleted.run(folder.id, uid);
						}
					});
					markMany();
				}

				totalDeleted += batch.length;
			} finally {
				lock.release();
			}
		}

		return totalDeleted;
	}
}

/**
 * Resolves the special-use attribute for a mailbox.
 * Handles both the standardized RFC 6154 attributes and common folder names.
 */
function resolveSpecialUse(mailbox: { specialUse?: string; path: string }): SpecialUse {
	if (mailbox.specialUse) return mailbox.specialUse as SpecialUse;

	// Fallback: detect by common folder names
	const lower = mailbox.path.toLowerCase();
	if (lower === "inbox") return "\\Inbox";
	if (lower === "sent" || lower === "sent mail" || lower === "sent items") return "\\Sent";
	if (lower === "drafts" || lower === "draft") return "\\Drafts";
	if (lower === "trash" || lower === "deleted" || lower === "deleted items") return "\\Trash";
	if (lower === "junk" || lower === "spam") return "\\Junk";
	if (lower === "archive" || lower === "all mail" || lower === "[gmail]/all mail")
		return "\\Archive";
	return null;
}

/**
 * Formats parsed email headers into a compact string for storage.
 */
/**
 * Coerces a value to a string or null for safe SQLite binding.
 * Malformed emails can produce unexpected types in envelope fields.
 */
function toStringOrNull(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value;
	return String(value);
}

function formatHeaders(parsed: ParsedMail): string | null {
	if (!parsed.headers) return null;
	const lines: string[] = [];
	for (const [key, value] of parsed.headers) {
		lines.push(
			`${key}: ${typeof value === "object" && value !== null && "text" in value ? (value as { text: string }).text : value}`,
		);
	}
	return lines.join("\r\n");
}

/**
 * Suppress async errors from an ImapFlow client before closing it.
 *
 * ImapFlow's close() removes socket error handlers before destroying the socket,
 * creating a race where ECONNRESET fires with no listener (uncaught exception).
 * Additionally, close() may be deferred via setImmediate (closeAfter), producing
 * unhandled rejections when pending operations are rejected asynchronously.
 *
 * Adding noop handlers to both the socket and the ImapFlow EventEmitter prevents
 * these expected teardown errors from surfacing as test/process failures.
 */
function suppressImapFlowErrors(client: ImapFlow): void {
	const noop = () => {};
	// Suppress errors emitted on the ImapFlow EventEmitter (e.g. from emitError)
	if (!client.listenerCount("error")) {
		client.on("error", noop);
	}
	// Suppress socket-level errors (ECONNRESET) after handler removal
	const socket = (
		client as unknown as { socket?: { on?: (event: string, fn: () => void) => void } }
	).socket;
	if (socket && typeof socket.on === "function") {
		socket.on("error", noop);
	}
}

type ImapSocket =
	| { on?: (event: string, fn: () => void) => void; destroy?: () => void }
	| undefined;

/** Extract the internal socket from an ImapFlow client (private field). */
function getImapSocket(client: ImapFlow): ImapSocket {
	return (client as unknown as { socket?: ImapSocket }).socket;
}

/** Add a noop error handler to a raw socket if it exists. */
function suppressSocketErrors(socket: ImapSocket): void {
	if (socket && typeof socket.on === "function") {
		socket.on("error", () => {});
	}
}

/**
 * Generic retry wrapper with exponential backoff.
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	label: string,
	retries = MAX_RETRIES,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt < retries) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
			}
		}
	}
	throw new Error(`${label} failed after ${retries} attempts: ${formatImapError(lastError)}`);
}

/**
 * Extracts a useful error message from ImapFlow errors.
 * ImapFlow sets error.message to "Command failed" but puts the actual
 * IMAP server response in error.responseText and the status (NO/BAD)
 * in error.responseStatus. This function combines them.
 */
function formatImapError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const imapErr = err as Error & { responseText?: string; responseStatus?: string };
	if (imapErr.responseText) {
		return `${imapErr.responseStatus ?? "ERROR"}: ${imapErr.responseText}`;
	}
	return imapErr.message;
}
