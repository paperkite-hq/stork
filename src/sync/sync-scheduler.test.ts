import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MIGRATIONS } from "../storage/schema.js";
import { SyncScheduler } from "./sync-scheduler.js";

function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

function createConnector(db: Database.Database, name = "Test"): number {
	db.prepare(`
		INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
		VALUES (?, 'imap', 'imap.example.com', 993, 1, 'test', 'pass')
	`).run(`${name} (Inbound)`);
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

	test("adds and removes identities", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addConnector({
			inboundConnectorId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const status = scheduler.getStatus();
		expect(status.has(1)).toBe(true);
		const identityStatus = status.get(1);
		expect(identityStatus?.running).toBe(false);
		expect(identityStatus?.lastSync).toBeNull();

		scheduler.removeIdentity(1);
		expect(scheduler.getStatus().has(1)).toBe(false);
	});

	test("throws on duplicate identity registration", () => {
		scheduler = new SyncScheduler(db);

		const config = {
			identityId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		};

		scheduler.addIdentity(config);
		expect(() => scheduler.addIdentity(config)).toThrow("already scheduled");
	});

	test("syncNow throws for unregistered identity", async () => {
		scheduler = new SyncScheduler(db);

		try {
			await scheduler.syncNow(999);
			expect(true).toBe(false); // Should not reach
		} catch (err) {
			expect((err as Error).message).toContain("not registered");
		}
	});

	test("loads identities from database", () => {
		const identityId = createConnector(db, "Identity 1");
		createConnector(db, "Identity 2");

		scheduler = new SyncScheduler(db);
		scheduler.loadIdentitiesFromDb();

		const status = scheduler.getStatus();
		expect(status.size).toBe(2);
	});

	test("loadIdentitiesFromDb skips already-registered identities", () => {
		const identityId = createConnector(db);

		scheduler = new SyncScheduler(db);
		scheduler.addConnector({
			inboundConnectorId: identityId,
			imapConfig: {
				host: "custom.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		// Should not throw
		scheduler.loadIdentitiesFromDb();
		expect(scheduler.getStatus().size).toBe(1);
	});

	test("status tracks consecutive errors", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addConnector({
			inboundConnectorId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const identityStatus = scheduler.getStatus().get(1);
		expect(identityStatus?.consecutiveErrors).toBe(0);
		expect(identityStatus?.lastError).toBeNull();
	});

	test("status includes progress field as null when not running", () => {
		scheduler = new SyncScheduler(db);

		scheduler.addConnector({
			inboundConnectorId: 1,
			imapConfig: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "pass" },
			},
		});

		const identityStatus = scheduler.getStatus().get(1);
		expect(identityStatus?.progress).toBeNull();
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
		scheduler.addConnector({
			inboundConnectorId: 1,
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
		scheduler.addConnector({
			inboundConnectorId: 1,
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
