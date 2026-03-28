/**
 * Container boot lifecycle for encrypted stork instances.
 *
 * State machine:
 *   setup   → no stork.keys file; only /api/health and /api/setup are accessible
 *   locked  → stork.keys exists but vault key not yet loaded; 423 on all data routes
 *   unlocked → vault key loaded, database open, sync running
 */

import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { openDatabase } from "../storage/db.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";
import { keysFileExists } from "./keys.js";

export type ContainerState = "setup" | "locked" | "unlocked";

export interface ContainerContext {
	/** Current lock state */
	state: ContainerState;
	dataDir: string;
	/** Database instance, null until unlocked */
	db: Database.Database | null;
	/** Sync scheduler, null until unlocked */
	scheduler: SyncScheduler | null;
	/** Vault key in memory, zeroed after DB open */
	_vaultKeyInMemory: Buffer | null;
}

export type AppFactory = (context: ContainerContext) => { app: Hono };

export interface BootResult {
	app: Hono;
	shutdown: () => Promise<void>;
}

export async function bootContainer(
	dataDir: string,
	createApp: (context: ContainerContext) => { app: Hono },
): Promise<BootResult> {
	const initialState: ContainerState = keysFileExists(dataDir) ? "locked" : "setup";

	const context: ContainerContext = {
		state: initialState,
		dataDir,
		db: null,
		scheduler: null,
		_vaultKeyInMemory: null,
	};

	const { app } = createApp(context);

	async function shutdown(): Promise<void> {
		console.log("\nShutting down...");
		const forceTimer = setTimeout(() => {
			console.error("Graceful shutdown timed out, forcing exit");
			process.exit(1);
		}, 10_000);
		forceTimer.unref();

		if (context.scheduler) {
			await context.scheduler.stop();
		}
		if (context.db) {
			context.db.close();
		}
		clearTimeout(forceTimer);
		process.exit(0);
	}

	return { app, shutdown };
}

/**
 * Called after successful unlock: opens the database with the vault key,
 * starts the sync scheduler, transitions to unlocked state.
 */
/** Returns a short HH:MM:SS timestamp for log lines. */
function ts(): string {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** Number of consecutive identical errors to show individually before batching. */
const BATCH_SHOW_LIMIT = 3;

interface ErrorBatch {
	folder: string | null;
	errorType: string;
	retriable: boolean;
	shownCount: number;
	suppressedCount: number;
}

export function transitionToUnlocked(context: ContainerContext, vaultKey: Buffer): void {
	if (context.state === "unlocked") return;

	const db = openDatabase("stork.db", context.dataDir, vaultKey);

	// Zero vault key immediately after passing to SQLCipher
	vaultKey.fill(0);

	// Per-account batching state for consecutive identical sync errors
	const errorBatches = new Map<number, ErrorBatch>();

	function flushErrorBatch(accountId: number): void {
		const batch = errorBatches.get(accountId);
		if (!batch || batch.suppressedCount === 0) {
			errorBatches.delete(accountId);
			return;
		}
		const retry = batch.retriable ? "(will retry)" : "(permanent)";
		const total = batch.shownCount + batch.suppressedCount;
		const folder = batch.folder ? `"${batch.folder}"` : "sync";
		console.error(
			`  ${ts()} [${batch.errorType}] ${folder} — ${total} batches failed, retrying automatically ${retry}`,
		);
		errorBatches.delete(accountId);
	}

	const scheduler = new SyncScheduler(db, {
		onSyncRecordError: (accountId, err) => {
			const batch = errorBatches.get(accountId);
			const matchesBatch =
				batch && batch.folder === err.folderPath && batch.errorType === err.errorType;

			if (!matchesBatch) {
				flushErrorBatch(accountId);
				errorBatches.set(accountId, {
					folder: err.folderPath,
					errorType: err.errorType,
					retriable: err.retriable,
					shownCount: 0,
					suppressedCount: 0,
				});
			}

			const current = errorBatches.get(accountId);
			if (current === undefined) return;
			if (current.shownCount < BATCH_SHOW_LIMIT) {
				const retry = err.retriable ? "(will retry)" : "(permanent)";
				console.error(`  ${ts()} [${err.errorType}] ${err.message} ${retry}`);
				current.shownCount++;
			} else {
				current.suppressedCount++;
			}
		},
		onSyncComplete: (accountId, result) => {
			flushErrorBatch(accountId);
			if (result.aborted) {
				console.log(
					`${ts()} Sync interrupted for account ${accountId}: ${result.totalNew} new (aborted)`,
				);
				return;
			}
			const parts = [`${ts()} Sync complete for account ${accountId}: ${result.totalNew} new`];
			if (result.totalErrors > 0) {
				parts.push(`${result.totalErrors} errors`);
			}
			console.log(parts.join(", "));
		},
		onSyncError: (accountId, error) => {
			flushErrorBatch(accountId);
			const imapErr = error as Error & { responseText?: string; responseStatus?: string };
			const detail = imapErr.responseText
				? `${imapErr.responseStatus ?? "ERROR"}: ${imapErr.responseText}`
				: error.message;
			console.error(`${ts()} Sync failed for account ${accountId}: ${detail}`);
		},
	});
	scheduler.loadAccountsFromDb();
	scheduler.start();

	context.db = db;
	context.scheduler = scheduler;
	context.state = "unlocked";
}
