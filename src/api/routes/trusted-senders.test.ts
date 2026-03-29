import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { createTestContext, createTestDb } from "../../test-helpers/test-db.js";

describe("Trusted Senders API", () => {
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

	test("GET /api/trusted-senders returns empty array initially", async () => {
		const { status, body } = await jsonRequest("/api/trusted-senders");
		expect(status).toBe(200);
		expect(body).toEqual([]);
	});

	test("POST /api/trusted-senders adds a trusted sender", async () => {
		const { status, body } = await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "news@example.com" }),
		});
		expect(status).toBe(201);
		expect(body.id).toBeGreaterThan(0);

		const { body: senders } = await jsonRequest("/api/trusted-senders");
		expect(senders).toHaveLength(1);
		expect(senders[0].sender_address).toBe("news@example.com");
	});

	test("POST normalizes sender address to lowercase", async () => {
		await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "News@Example.COM" }),
		});

		const { body: senders } = await jsonRequest("/api/trusted-senders");
		expect(senders[0].sender_address).toBe("news@example.com");
	});

	test("POST rejects missing sender_address", async () => {
		const { status } = await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(status).toBe(400);
	});

	test("POST rejects invalid email (no @)", async () => {
		const { status } = await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "notanemail" }),
		});
		expect(status).toBe(400);
	});

	test("POST returns 409 for duplicate sender", async () => {
		await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "news@example.com" }),
		});
		const { status, body } = await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "news@example.com" }),
		});
		expect(status).toBe(409);
		expect(body.error).toMatch(/already trusted/i);
	});

	test("GET /api/trusted-senders/check returns trusted status", async () => {
		await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "trusted@example.com" }),
		});

		const { body: yes } = await jsonRequest(
			"/api/trusted-senders/check?sender=trusted@example.com",
		);
		expect(yes.trusted).toBe(true);

		const { body: no } = await jsonRequest("/api/trusted-senders/check?sender=unknown@example.com");
		expect(no.trusted).toBe(false);
	});

	test("GET check requires sender param", async () => {
		const { status } = await jsonRequest("/api/trusted-senders/check");
		expect(status).toBe(400);
	});

	test("DELETE /api/trusted-senders/:id removes by ID", async () => {
		const { body: created } = await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "temp@example.com" }),
		});

		const { status } = await jsonRequest(`/api/trusted-senders/${created.id}`, {
			method: "DELETE",
		});
		expect(status).toBe(200);

		const { body: senders } = await jsonRequest("/api/trusted-senders");
		expect(senders).toHaveLength(0);
	});

	test("DELETE /api/trusted-senders/:id returns 404 for missing", async () => {
		const { status } = await jsonRequest("/api/trusted-senders/999", {
			method: "DELETE",
		});
		expect(status).toBe(404);
	});

	// ─── Route parameter validation ────────────────────────
	test("DELETE /api/trusted-senders/abc returns 400 for non-numeric id", async () => {
		const { status, body } = await jsonRequest("/api/trusted-senders/abc", {
			method: "DELETE",
		});
		expect(status).toBe(400);
		expect(body.error).toMatch(/id/);
	});

	test("trusted senders are global (not per-identity)", async () => {
		await jsonRequest("/api/trusted-senders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sender_address: "shared@example.com" }),
		});

		const { body: senders } = await jsonRequest("/api/trusted-senders");
		expect(senders).toHaveLength(1);
		expect(senders[0].sender_address).toBe("shared@example.com");
	});
});
