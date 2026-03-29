import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { createTestContext, createTestDb, createTestIdentity } from "../../test-helpers/test-db.js";

describe("Sync API", () => {
	let db: Database.Database;
	let app: Hono;
	let scheduler: import("../../sync/sync-scheduler.js").SyncScheduler;

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

	describe("GET /api/sync/status", () => {
		test("returns sync info", async () => {
			const { status, body } = await jsonRequest("/api/sync/status");
			expect(status).toBe(200);
			expect(typeof body).toBe("object");
		});
	});

	describe("POST /api/identities/:id/sync", () => {
		test("returns 500 when identity not registered with scheduler", async () => {
			const { status, body } = await jsonRequest("/api/identities/99999/sync", {
				method: "POST",
			});
			expect(status).toBe(500);
			expect(body.error).toBeDefined();
		});
	});

	describe("GET /api/sync/errors", () => {
		function insertSyncError(
			identityId: number,
			opts: Partial<{
				folderPath: string;
				uid: number;
				errorType: string;
				message: string;
				retriable: number;
				resolved: number;
			}> = {},
		) {
			db.prepare(`
				INSERT INTO sync_errors (identity_id, folder_path, uid, error_type, message, retriable, resolved)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(
				identityId,
				opts.folderPath ?? "INBOX",
				opts.uid ?? null,
				opts.errorType ?? "parse",
				opts.message ?? "test error",
				opts.retriable ?? 1,
				opts.resolved ?? 0,
			);
		}

		test("returns empty array when no errors", async () => {
			const { status, body } = await jsonRequest("/api/sync/errors");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("returns sync errors", async () => {
			const identityId = createTestIdentity(db);
			insertSyncError(identityId, { message: "MIME parse failed" });

			const { status, body } = await jsonRequest("/api/sync/errors");
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].message).toBe("MIME parse failed");
			expect(body[0].identity_id).toBe(identityId);
		});

		test("filters by identity_id", async () => {
			const identity1 = createTestIdentity(db);
			const identity2 = createTestIdentity(db, { email: "other@example.com" });
			insertSyncError(identity1, { message: "error 1" });
			insertSyncError(identity2, { message: "error 2" });

			const { body } = await jsonRequest(`/api/sync/errors?identity_id=${identity1}`);
			expect(body).toHaveLength(1);
			expect(body[0].message).toBe("error 1");
		});

		test("filters by resolved status", async () => {
			const identityId = createTestIdentity(db);
			insertSyncError(identityId, { message: "unresolved", resolved: 0 });
			insertSyncError(identityId, { message: "resolved", resolved: 1 });

			const { body: unresolved } = await jsonRequest("/api/sync/errors?resolved=0");
			expect(unresolved).toHaveLength(1);
			expect(unresolved[0].message).toBe("unresolved");

			const { body: resolved } = await jsonRequest("/api/sync/errors?resolved=1");
			expect(resolved).toHaveLength(1);
			expect(resolved[0].message).toBe("resolved");
		});

		test("respects limit parameter", async () => {
			const identityId = createTestIdentity(db);
			for (let i = 0; i < 5; i++) {
				insertSyncError(identityId, { message: `error ${i}` });
			}

			const { body } = await jsonRequest("/api/sync/errors?limit=2");
			expect(body).toHaveLength(2);
		});

		test("caps limit at 1000", async () => {
			// Just verify it doesn't crash with a high limit
			const { status } = await jsonRequest("/api/sync/errors?limit=9999");
			expect(status).toBe(200);
		});

		test("combines identity_id and resolved filters", async () => {
			const identity1 = createTestIdentity(db);
			const identity2 = createTestIdentity(db, { email: "other@example.com" });
			insertSyncError(identity1, { message: "a1-unresolved", resolved: 0 });
			insertSyncError(identity1, { message: "a1-resolved", resolved: 1 });
			insertSyncError(identity2, { message: "a2-unresolved", resolved: 0 });

			const { body } = await jsonRequest(`/api/sync/errors?identity_id=${identity1}&resolved=0`);
			expect(body).toHaveLength(1);
			expect(body[0].message).toBe("a1-unresolved");
		});
	});
});
