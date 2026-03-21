import Database from "@signalapp/better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MIGRATIONS } from "../src/storage/schema.js";
import { SyncScheduler } from "../src/sync/sync-scheduler.js";

function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

function createAccount(db: Database.Database, name = "Test"): number {
	db.prepare(`
		INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass)
		VALUES (?, 'test@example.com', 'imap.example.com', 993, 1, 'test', 'pass')
	`).run(name);
	return (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

describe("SyncScheduler", () => {
	let db: Database.Database;
	let scheduler: SyncScheduler;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(async () => {
		if (scheduler) await scheduler.stop();
		db.close();
	});

	test("adds and removes accounts", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addAccount({
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const status = scheduler.getStatus();
		expect(status.has(1)).toBe(true);
		const accountStatus = status.get(1);
		expect(accountStatus?.running).toBe(false);
		expect(accountStatus?.lastSync).toBeNull();

		scheduler.removeAccount(1);
		expect(scheduler.getStatus().has(1)).toBe(false);
	});

	test("throws on duplicate account registration", () => {
		scheduler = new SyncScheduler(db);

		const config = {
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		};

		scheduler.addAccount(config);
		expect(() => scheduler.addAccount(config)).toThrow("already scheduled");
	});

	test("syncNow throws for unregistered account", async () => {
		scheduler = new SyncScheduler(db);

		try {
			await scheduler.syncNow(999);
			expect(true).toBe(false); // Should not reach
		} catch (err) {
			expect((err as Error).message).toContain("not registered");
		}
	});

	test("loads accounts from database", () => {
		const accountId = createAccount(db, "Account 1");
		createAccount(db, "Account 2");

		scheduler = new SyncScheduler(db);
		scheduler.loadAccountsFromDb();

		const status = scheduler.getStatus();
		expect(status.size).toBe(2);
	});

	test("loadAccountsFromDb skips already-registered accounts", () => {
		const accountId = createAccount(db);

		scheduler = new SyncScheduler(db);
		scheduler.addAccount({
			accountId,
			imapConfig: {
				host: "custom.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		// Should not throw
		scheduler.loadAccountsFromDb();
		expect(scheduler.getStatus().size).toBe(1);
	});

	test("status tracks consecutive errors", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addAccount({
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const accountStatus = scheduler.getStatus().get(1);
		expect(accountStatus?.consecutiveErrors).toBe(0);
		expect(accountStatus?.lastError).toBeNull();
	});

	test("status includes progress field as null when not running", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addAccount({
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const accountStatus = scheduler.getStatus().get(1);
		expect(accountStatus?.progress).toBeNull();
	});

	test("stop is idempotent", async () => {
		scheduler = new SyncScheduler(db);
		await scheduler.stop();
		await scheduler.stop();
		// Should not throw
	});

	test("start is idempotent", () => {
		scheduler = new SyncScheduler(db);
		scheduler.start();
		scheduler.start();
		// Should not throw
	});

	test("stop completes within timeout even with no running syncs", async () => {
		scheduler = new SyncScheduler(db);
		scheduler.addAccount({
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const start = Date.now();
		await scheduler.stop();
		const elapsed = Date.now() - start;

		// Should complete quickly without waiting for the 5s timeout
		expect(elapsed).toBeLessThan(1000);
	});

	test("stop clears abort controllers and sync promises", async () => {
		scheduler = new SyncScheduler(db);
		scheduler.addAccount({
			accountId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		// Stop should not throw even when no syncs are running
		await scheduler.stop();

		const status = scheduler.getStatus();
		expect(status.get(1)?.running).toBe(false);
	});
});
