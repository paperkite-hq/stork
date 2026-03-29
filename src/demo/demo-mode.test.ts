import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openDatabase } from "../storage/db.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-demo-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true });
	vi.unstubAllEnvs();
});

describe("seedDemoData", () => {
	test("populates database with demo account, folders, labels, and messages", async () => {
		const { seedDemoData } = await import("./seed.js");
		const db = openDatabase("test.db", tmpDir);

		seedDemoData(db);

		const accounts = db.prepare("SELECT * FROM accounts").all() as { name: string }[];
		expect(accounts).toHaveLength(2);
		expect(accounts[0].name).toBe("Alex Demo");
		expect(accounts[1].name).toBe("Alex (Work)");

		const folders = db.prepare("SELECT * FROM folders").all();
		expect(folders).toHaveLength(2); // one INBOX per account

		const labels = db.prepare("SELECT * FROM labels").all();
		expect(labels).toHaveLength(11); // 9 unique global labels (7 + 5 - 3 shared) + 2 account labels

		const messages = db.prepare("SELECT * FROM messages").all();
		expect(messages).toHaveLength(19); // 15 for account 1, 4 for account 2

		// Check message-label assignments exist
		const mlCount = (db.prepare("SELECT COUNT(*) as n FROM message_labels").get() as { n: number })
			.n;
		expect(mlCount).toBeGreaterThan(0);

		// Check FTS is populated (triggers fire on insert)
		const ftsResults = db
			.prepare("SELECT * FROM messages_fts WHERE messages_fts MATCH 'Kubernetes'")
			.all();
		expect(ftsResults.length).toBeGreaterThan(0);

		db.close();
	});

	test("creates threaded messages with in_reply_to references", async () => {
		const { seedDemoData } = await import("./seed.js");
		const db = openDatabase("test.db", tmpDir);

		seedDemoData(db);

		const threads = db.prepare("SELECT * FROM messages WHERE in_reply_to IS NOT NULL").all() as {
			subject: string;
		}[];
		expect(threads.length).toBeGreaterThanOrEqual(2);

		db.close();
	});

	test("some messages have attachment indicators", async () => {
		const { seedDemoData } = await import("./seed.js");
		const db = openDatabase("test.db", tmpDir);

		seedDemoData(db);

		const withAttachments = db.prepare("SELECT * FROM messages WHERE has_attachments = 1").all();
		expect(withAttachments.length).toBeGreaterThanOrEqual(3);

		db.close();
	});
});

describe("bootDemoDatabase", () => {
	test("creates and seeds database on first boot", async () => {
		const { bootDemoDatabase } = await import("./demo-mode.js");

		vi.stubEnv("STORK_DEMO_MODE", "1");

		const db = bootDemoDatabase(tmpDir);

		const messages = db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number };
		expect(messages.n).toBe(19); // 15 (account 1) + 4 (account 2)

		db.close();
	});

	test("does not re-seed on second boot", async () => {
		const { bootDemoDatabase } = await import("./demo-mode.js");

		vi.stubEnv("STORK_DEMO_MODE", "1");

		const db1 = bootDemoDatabase(tmpDir);
		db1.close();

		const db2 = bootDemoDatabase(tmpDir);
		const messages = db2.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number };
		expect(messages.n).toBe(19); // Not doubled
		db2.close();
	});
});

describe("isDemoMode", () => {
	test("returns true when STORK_DEMO_MODE=1", async () => {
		vi.stubEnv("STORK_DEMO_MODE", "1");
		// Re-import to pick up the env change
		const { isDemoMode } = await import("./demo-mode.js");
		expect(isDemoMode()).toBe(true);
	});

	test("returns false when STORK_DEMO_MODE is unset", async () => {
		vi.stubEnv("STORK_DEMO_MODE", "");
		const { isDemoMode } = await import("./demo-mode.js");
		expect(isDemoMode()).toBe(false);
	});
});

describe("demo API read-only middleware", () => {
	test("blocks POST requests on data routes in demo mode", async () => {
		vi.stubEnv("STORK_DEMO_MODE", "1");

		// We need to dynamically import after stubbing the env
		const { createApp } = await import("../api/server.js");
		const { bootDemoDatabase } = await import("./demo-mode.js");

		const db = bootDemoDatabase(tmpDir);
		const context = {
			state: "unlocked" as const,
			dataDir: tmpDir,
			db,
			scheduler: null,
			_vaultKeyInMemory: null,
		};

		const { app } = createApp(context);

		// GET should work
		const getRes = await app.request("/api/health");
		expect(getRes.status).toBe(200);

		// GET /api/demo should return { demo: true }
		const demoRes = await app.request("/api/demo");
		const demoBody = await demoRes.json();
		expect(demoBody).toEqual({ demo: true });

		// GET data route should work
		const accountsRes = await app.request("/api/accounts");
		expect(accountsRes.status).toBe(200);
		const accounts = await accountsRes.json();
		expect(Array.isArray(accounts)).toBe(true);

		// POST should be blocked with 403
		const postRes = await app.request("/api/accounts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "test" }),
		});
		expect(postRes.status).toBe(403);
		const postBody = (await postRes.json()) as { error: string };
		expect(postBody.error).toContain("read-only demo");

		// DELETE should be blocked with 403
		const deleteRes = await app.request("/api/messages/1", {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(403);

		// PATCH should be blocked with 403
		const patchRes = await app.request("/api/messages/1/flags", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ add: ["\\Seen"] }),
		});
		expect(patchRes.status).toBe(403);

		db.close();
	});
});
