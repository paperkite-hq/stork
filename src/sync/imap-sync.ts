import type Database from "@signalapp/better-sqlite3";
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

export interface SyncResult {
	folder: string;
	newMessages: number;
	updatedFlags: number;
	deletedFolders: number;
	attachmentsSaved: number;
	errors: string[];
}

export interface SyncAllResult {
	folders: SyncResult[];
	totalNew: number;
	totalErrors: number;
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
	private accountId: number;
	private config: ImapConfig;
	private subBatchLabelSize: number;

	constructor(
		config: ImapConfig,
		db: Database.Database,
		accountId: number,
		subBatchLabelSize = DEFAULT_SUB_BATCH_LABEL_SIZE,
	) {
		this.config = config;
		this.client = new ImapFlow({
			...config,
			logger: false,
		});
		this.db = db;
		this.accountId = accountId;
		this.subBatchLabelSize = subBatchLabelSize;
	}

	async connect(): Promise<void> {
		await withRetry(() => {
			// ImapFlow instances cannot be reconnected once closed — create a fresh
			// instance on each retry to avoid "Can not re-use ImapFlow instance"
			this.client = new ImapFlow({
				...this.config,
				logger: false,
			});
			return this.client.connect();
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
	 * Full sync: sync folders, then sync each folder's messages.
	 * Also creates labels from IMAP folder names and applies them to messages.
	 *
	 * Accepts an optional AbortSignal for graceful cancellation — when aborted,
	 * the sync finishes the current message/batch and returns partial results.
	 *
	 * Accepts an optional onProgress callback that fires as sync proceeds,
	 * useful for showing real-time status in the UI.
	 */
	async syncAll(
		signal?: AbortSignal,
		onProgress?: (progress: SyncProgress) => void,
	): Promise<SyncAllResult> {
		const result: SyncAllResult = { folders: [], totalNew: 0, totalErrors: 0 };

		if (signal?.aborted) return result;

		onProgress?.({
			phase: "listing-folders",
			foldersCompleted: 0,
			totalFolders: 0,
			messagesNew: 0,
		});

		const folders = await this.syncFolders();

		// Ensure labels exist for all synced folders
		this.ensureLabelsForFolders();

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
			});

			const folderResult = await this.syncFolder(folderPath, signal);
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
			});
		}

		onProgress?.({
			phase: "applying-labels",
			foldersCompleted,
			totalFolders,
			messagesNew: result.totalNew,
		});

		// Final pass: catch any messages that may have been missed
		this.applyFolderLabelsToMessages();

		return result;
	}

	/**
	 * Lists all mailbox folders from the IMAP server, syncs folder metadata,
	 * and detects deleted/renamed folders.
	 */
	async syncFolders(): Promise<string[]> {
		const mailboxes = await withRetry(() => this.client.list(), "list mailboxes");
		const remotePaths = new Set<string>();

		const upsertFolder = this.db.prepare(`
			INSERT INTO folders (account_id, path, name, delimiter, flags, special_use)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_id, path) DO UPDATE SET
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
					this.accountId,
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
			.prepare("SELECT id, path FROM folders WHERE account_id = ?")
			.all(this.accountId) as { id: number; path: string }[];

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
	 * Syncs messages from a specific folder.
	 * Fetches new messages (incremental via UID), updates flags on existing messages,
	 * and extracts attachments.
	 */
	async syncFolder(folderPath: string, signal?: AbortSignal): Promise<SyncResult> {
		const result: SyncResult = {
			folder: folderPath,
			newMessages: 0,
			updatedFlags: 0,
			deletedFolders: 0,
			attachmentsSaved: 0,
			errors: [],
		};

		const folder = this.db
			.prepare("SELECT id, uid_validity FROM folders WHERE account_id = ? AND path = ?")
			.get(this.accountId, folderPath) as { id: number; uid_validity: number | null } | undefined;

		if (!folder) {
			result.errors.push(`Folder not found in database: ${folderPath}`);
			return result;
		}

		let lock: { release: () => void };
		try {
			lock = await withRetry(() => this.client.getMailboxLock(folderPath), `lock ${folderPath}`);
		} catch (err) {
			result.errors.push(`Could not lock mailbox ${folderPath}: ${err}`);
			return result;
		}

		try {
			const mailboxStatus = this.client.mailbox;
			if (!mailboxStatus) {
				result.errors.push(`Could not open mailbox: ${folderPath}`);
				return result;
			}

			// Check UIDVALIDITY — if it changed, the folder was recreated; full resync needed
			if (folder.uid_validity && BigInt(folder.uid_validity) !== mailboxStatus.uidValidity) {
				this.db.prepare("DELETE FROM messages WHERE folder_id = ?").run(folder.id);
				this.db
					.prepare("DELETE FROM sync_state WHERE account_id = ? AND folder_id = ?")
					.run(this.accountId, folder.id);
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

			// Phase 1: Fetch new messages
			const newCount = await this.fetchNewMessages(folder.id, result, signal);
			result.newMessages = newCount;

			// Phase 2: Sync flags on existing messages (skip if aborted)
			if (!signal?.aborted) {
				const flagCount = await this.syncFlags(folder.id, result, signal);
				result.updatedFlags = flagCount;
			}
		} finally {
			lock?.release();
		}

		return result;
	}

	/**
	 * Fetches messages newer than the last synced UID, parses MIME,
	 * stores messages, and extracts attachments.
	 */
	private async fetchNewMessages(
		folderId: number,
		result: SyncResult,
		signal?: AbortSignal,
	): Promise<number> {
		const syncState = this.db
			.prepare("SELECT last_uid FROM sync_state WHERE account_id = ? AND folder_id = ?")
			.get(this.accountId, folderId) as { last_uid: number } | undefined;

		const lastUid = syncState?.last_uid ?? 0;
		const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";

		const insertMessage = this.db.prepare(`
			INSERT OR IGNORE INTO messages (
				account_id, folder_id, uid, message_id, in_reply_to, "references",
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

		for await (const message of this.client.fetch(range, {
			uid: true,
			envelope: true,
			bodyStructure: true,
			flags: true,
			size: true,
			source: true,
		})) {
			// Check abort signal between messages for graceful cancellation
			if (signal?.aborted) break;

			try {
				const source = message.source;
				if (!source) {
					result.errors.push(`UID ${message.uid}: no source available`);
					continue;
				}

				// Parse MIME with mailparser
				const parsed = await simpleParser(source);

				const envelope = message.envelope;
				if (!envelope) {
					result.errors.push(`UID ${message.uid}: no envelope available`);
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
					this.accountId,
					folderId,
					message.uid,
					envelope.messageId ?? null,
					envelope.inReplyTo ?? null,
					refs ? JSON.stringify(refs) : null,
					envelope.subject ?? null,
					fromAddr?.address ?? null,
					fromAddr?.name ?? null,
					toAddrs ? JSON.stringify(toAddrs) : null,
					ccAddrs ? JSON.stringify(ccAddrs) : null,
					bccAddrs ? JSON.stringify(bccAddrs) : null,
					envelope.date?.toISOString() ?? null,
					parsed.text ?? null,
					typeof parsed.html === "string" ? parsed.html : null,
					JSON.stringify(Array.from(message.flags ?? new Set())),
					message.size ?? null,
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
							att.contentType,
							att.size,
							att.contentId ?? null,
							att.content,
						);
						result.attachmentsSaved++;
					}
				}

				if (message.uid > maxUid) maxUid = message.uid;
				count++;

				// Apply labels periodically within large folders so messages become
				// queryable by label before the entire folder finishes syncing
				if (count % this.subBatchLabelSize === 0) {
					this.applyFolderLabelsToMessages();
				}
			} catch (err) {
				result.errors.push(`Failed to process UID ${message.uid}: ${err}`);
			}
		}

		// Update sync state
		if (maxUid > lastUid) {
			this.db
				.prepare(`
				INSERT INTO sync_state (account_id, folder_id, last_uid, last_synced_at)
				VALUES (?, ?, ?, datetime('now'))
				ON CONFLICT(account_id, folder_id) DO UPDATE SET
					last_uid = excluded.last_uid,
					last_synced_at = excluded.last_synced_at
			`)
				.run(this.accountId, folderId, maxUid);
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
				for await (const msg of this.client.fetch(rangeStr, {
					uid: true,
					flags: true,
				})) {
					const newFlags = JSON.stringify(Array.from(msg.flags ?? new Set()));
					const oldFlags = localFlagMap.get(msg.uid);
					if (oldFlags !== newFlags) {
						updateFlags.run(newFlags, folderId, msg.uid);
						updated++;
					}
				}
			} catch (err) {
				result.errors.push(`Flag sync batch error: ${err}`);
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
			.prepare("SELECT id, name FROM folders WHERE account_id = ?")
			.all(this.accountId) as { id: number; name: string }[];

		const upsertLabel = this.db.prepare(`
			INSERT INTO labels (account_id, name, source)
			VALUES (?, ?, 'imap')
			ON CONFLICT(account_id, name) DO NOTHING
		`);

		const insertMany = this.db.transaction(() => {
			for (const folder of folders) {
				upsertLabel.run(this.accountId, folder.name);
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
			JOIN labels l ON l.account_id = m.account_id AND l.name = f.name
			LEFT JOIN message_labels ml ON ml.message_id = m.id AND ml.label_id = l.id
			WHERE m.account_id = ? AND ml.message_id IS NULL
		`)
			.run(this.accountId);
	}

	/**
	 * Detects messages deleted from the server since last sync.
	 * Returns UIDs of messages that exist locally but not on the server.
	 */
	async detectServerDeletions(folderPath: string): Promise<number[]> {
		const folder = this.db
			.prepare("SELECT id FROM folders WHERE account_id = ? AND path = ?")
			.get(this.accountId, folderPath) as { id: number } | undefined;

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
	 */
	async deleteFromServer(folderPath: string, uids: number[]): Promise<number> {
		if (uids.length === 0) return 0;

		const lock = await this.client.getMailboxLock(folderPath);
		try {
			await this.client.messageDelete(uids, { uid: true });

			const folder = this.db
				.prepare("SELECT id FROM folders WHERE account_id = ? AND path = ?")
				.get(this.accountId, folderPath) as { id: number } | undefined;

			if (folder) {
				const markDeleted = this.db.prepare(
					"UPDATE messages SET deleted_from_server = 1 WHERE folder_id = ? AND uid = ?",
				);
				const markMany = this.db.transaction(() => {
					for (const uid of uids) {
						markDeleted.run(folder.id, uid);
					}
				});
				markMany();
			}

			return uids.length;
		} finally {
			lock.release();
		}
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
	throw new Error(`${label} failed after ${retries} attempts: ${lastError}`);
}
