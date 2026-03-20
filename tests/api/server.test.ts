import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../src/api/server.js";
import { createTestContext, createTestDb } from "../helpers/test-db.js";

describe("Server", () => {
	let app: Hono;
	let scheduler: import("../../src/sync/sync-scheduler.js").SyncScheduler;

	beforeEach(() => {
		const db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
		if (!ctx.scheduler) throw new Error("scheduler not initialized");
		scheduler = ctx.scheduler;
	});

	afterEach(async () => {
		await scheduler.stop();
	});

	describe("GET /api/health", () => {
		test("returns status ok", async () => {
			const res = await app.request("/api/health");
			const body = await res.json();
			expect(res.status).toBe(200);
			expect(body).toEqual({ status: "ok", version: "0.1.0" });
		});
	});

	describe("CORS", () => {
		test("responses include CORS headers", async () => {
			const res = await app.request("/api/health");
			expect(res.headers.get("Access-Control-Allow-Origin")).toBeDefined();
		});
	});
});
