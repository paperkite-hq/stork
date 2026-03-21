import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "../helpers/test-db.js";

describe("Accounts API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../src/sync/sync-scheduler.js").SyncScheduler;

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
	});

	afterEach(async () => {
		await scheduler.stop();
		db.close();
	});

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await app.request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Accounts CRUD ──────────────────────────────────────
	describe("Accounts CRUD", () => {
		test("GET /api/accounts returns empty array initially", async () => {
			const { status, body } = await jsonRequest("/api/accounts");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/accounts creates an account", async () => {
			const { status, body } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					imap_host: "imap.example.com",
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: accounts } = await jsonRequest("/api/accounts");
			expect(accounts).toHaveLength(1);
			expect(accounts[0].name).toBe("Test");
			expect(accounts[0].email).toBe("test@example.com");
		});

		test("GET /api/accounts/:id returns account details", async () => {
			const accountId = createTestAccount(db);
			const { status, body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(status).toBe(200);
			expect(body.id).toBe(accountId);
			expect(body.name).toBe("Test Account");
			expect(body.imap_pass).toBeUndefined();
		});

		test("GET /api/accounts/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/accounts/999");
			expect(status).toBe(404);
		});

		test("PUT /api/accounts/:id updates fields", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.name).toBe("Updated Name");
		});

		test("PUT /api/accounts/:id rejects empty update", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("DELETE /api/accounts/:id deletes account", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: accounts } = await jsonRequest("/api/accounts");
			expect(accounts).toHaveLength(0);
		});

		test("DELETE /api/accounts/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/accounts/999", {
				method: "DELETE",
			});
			expect(status).toBe(404);
		});
	});

	// ─── Folders ────────────────────────────────────────────
	describe("Folders", () => {
		test("GET /api/accounts/:id/folders returns folders", async () => {
			const accountId = createTestAccount(db);
			createTestFolder(db, accountId, "INBOX", { specialUse: "\\Inbox" });
			createTestFolder(db, accountId, "Sent", { specialUse: "\\Sent" });

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/folders`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
			expect(body[0].path).toBe("INBOX");
		});

		test("GET /api/accounts/:id/sync-status returns folder sync info", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");

			db.prepare("INSERT INTO sync_state (account_id, folder_id, last_uid) VALUES (?, ?, 42)").run(
				accountId,
				folderId,
			);

			const { status, body } = await jsonRequest(`/api/accounts/${accountId}/sync-status`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].last_uid).toBe(42);
		});
	});

	// ─── Validation edge cases ───────────────────────────────
	describe("Validation", () => {
		test("POST /api/accounts with missing required fields fails gracefully", async () => {
			const { status } = await jsonRequest("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBeGreaterThanOrEqual(400);
		});

		test("PUT /api/accounts/:id ignores unknown fields", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Valid", unknown_field: "ignored" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.name).toBe("Valid");
		});

		test("PUT /api/accounts/:id with only unknown fields returns 400", async () => {
			const accountId = createTestAccount(db);
			const { status } = await jsonRequest(`/api/accounts/${accountId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ unknown_field: "value" }),
			});
			expect(status).toBe(400);
		});

		test("GET /api/accounts/:id does not expose passwords", async () => {
			const accountId = createTestAccount(db);
			const { body } = await jsonRequest(`/api/accounts/${accountId}`);
			expect(body.imap_pass).toBeUndefined();
			expect(body.smtp_pass).toBeUndefined();
		});
	});

	// ─── Sync trigger ───────────────────────────────────────
	describe("Sync trigger", () => {
		test("POST /api/accounts/:id/sync returns 500 when sync fails", async () => {
			// Account with unreachable IMAP server — syncNow throws, route returns 500
			const accountId = createTestAccount(db, {
				imapHost: "127.0.0.1",
				imapPort: 19999, // no server listening here
			});
			scheduler.addAccount({
				accountId,
				imapConfig: {
					host: "127.0.0.1",
					port: 19999,
					secure: false,
					auth: { user: "test", pass: "test" },
				},
			});
			const { status } = await jsonRequest(`/api/accounts/${accountId}/sync`, {
				method: "POST",
			});
			expect(status).toBe(500);
		});
	});

	// ─── Delete cascades ────────────────────────────────────
	describe("Delete cascades", () => {
		test("deleting account removes its folders and messages", async () => {
			const accountId = createTestAccount(db);
			const folderId = createTestFolder(db, accountId, "INBOX");
			createTestMessage(db, accountId, folderId, 1);

			await jsonRequest(`/api/accounts/${accountId}`, { method: "DELETE" });

			const folders = db
				.prepare("SELECT COUNT(*) as count FROM folders WHERE account_id = ?")
				.get(accountId) as { count: number };
			expect(folders.count).toBe(0);

			const messages = db
				.prepare("SELECT COUNT(*) as count FROM messages WHERE account_id = ?")
				.get(accountId) as { count: number };
			expect(messages.count).toBe(0);
		});
	});

	describe("POST /accounts/test-connection", () => {
		test("returns 400 when required fields are missing", async () => {
			const res = await app.request("/api/accounts/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ imap_host: "imap.example.com" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toContain("Missing required fields");
		});

		test("returns ok:false with error for unreachable server", async () => {
			const res = await app.request("/api/accounts/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imap_host: "localhost",
					imap_port: 19999,
					imap_tls: 0,
					imap_user: "test",
					imap_pass: "test",
				}),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; error?: string };
			expect(body.ok).toBe(false);
			expect(body.error).toBeTruthy();
		});
	});
});
