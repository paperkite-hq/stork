import type Database from "@signalapp/better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import { createTestContext, createTestDb } from "../helpers/test-db.js";

describe("Sync API", () => {
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

	describe("GET /api/sync/status", () => {
		test("returns sync info", async () => {
			const { status, body } = await jsonRequest("/api/sync/status");
			expect(status).toBe(200);
			expect(typeof body).toBe("object");
		});
	});

	describe("POST /api/accounts/:id/sync", () => {
		test("returns 500 when account not registered with scheduler", async () => {
			const { status, body } = await jsonRequest("/api/accounts/99999/sync", {
				method: "POST",
			});
			expect(status).toBe(500);
			expect(body.error).toBeDefined();
		});
	});
});
