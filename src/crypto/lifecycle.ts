/**
 * Container boot lifecycle for encrypted stork instances.
 *
 * State machine:
 *   setup   → no stork.keys file; only /api/health and /api/setup are accessible
 *   locked  → stork.keys exists but vault key not yet loaded; 423 on all data routes
 *   unlocked → vault key loaded, database open, sync running
 */

import type Database from "@signalapp/better-sqlite3";
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
		}, 3_000);
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
export function transitionToUnlocked(context: ContainerContext, vaultKey: Buffer): void {
	if (context.state === "unlocked") return;

	const db = openDatabase("stork.db", context.dataDir, vaultKey);

	// Zero vault key immediately after passing to SQLCipher
	vaultKey.fill(0);

	const scheduler = new SyncScheduler(db, {
		onSyncComplete: (accountId, result) => {
			console.log(
				`Sync complete for account ${accountId}: ${result.totalNew} new, ${result.totalErrors} errors`,
			);
		},
		onSyncError: (accountId, error) => {
			console.error(`Sync failed for account ${accountId}: ${error.message}`);
		},
	});
	scheduler.loadAccountsFromDb();
	scheduler.start();

	context.db = db;
	context.scheduler = scheduler;
	context.state = "unlocked";
}
