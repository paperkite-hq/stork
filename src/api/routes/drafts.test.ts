import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import {
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Drafts API", () => {
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

	// ─── Draft CRUD ─────────────────────────────────────────────
	describe("Draft CRUD", () => {
		let accountId: number;

		beforeEach(() => {
			accountId = createTestAccount(db);
		});

		test("creates a draft", async () => {
			const { status, body } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					to_addresses: "alice@example.com",
					subject: "Draft subject",
					text_body: "Draft body text",
					compose_mode: "new",
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("lists drafts for an account", async () => {
			// Create two drafts
			await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "Draft 1",
					compose_mode: "new",
				}),
			});
			await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "Draft 2",
					compose_mode: "reply",
				}),
			});

			const { status, body } = await jsonRequest(`/api/drafts?account_id=${accountId}`);
			expect(status).toBe(200);
			expect(body).toHaveLength(2);
		});

		test("gets a single draft", async () => {
			const { body: created } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					to_addresses: "bob@example.com",
					subject: "Full draft",
					text_body: "Full body",
					compose_mode: "new",
				}),
			});

			const { status, body } = await jsonRequest(`/api/drafts/${created.id}`);
			expect(status).toBe(200);
			expect(body.subject).toBe("Full draft");
			expect(body.to_addresses).toBe("bob@example.com");
			expect(body.text_body).toBe("Full body");
		});

		test("updates a draft", async () => {
			const { body: created } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "Original",
					compose_mode: "new",
				}),
			});

			const { status, body } = await jsonRequest(`/api/drafts/${created.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					subject: "Updated subject",
					text_body: "New body",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);

			// Verify update
			const { body: fetched } = await jsonRequest(`/api/drafts/${created.id}`);
			expect(fetched.subject).toBe("Updated subject");
			expect(fetched.text_body).toBe("New body");
		});

		test("deletes a draft", async () => {
			const { body: created } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "To delete",
					compose_mode: "new",
				}),
			});

			const { status } = await jsonRequest(`/api/drafts/${created.id}`, { method: "DELETE" });
			expect(status).toBe(200);

			// Verify deleted
			const { status: getStatus } = await jsonRequest(`/api/drafts/${created.id}`);
			expect(getStatus).toBe(404);
		});

		test("returns 404 for non-existent draft", async () => {
			const { status } = await jsonRequest("/api/drafts/99999");
			expect(status).toBe(404);
		});

		test("requires account_id on create", async () => {
			const { status, body } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subject: "No account" }),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("account_id");
		});

		test("requires account_id on list", async () => {
			const { status, body } = await jsonRequest("/api/drafts");
			expect(status).toBe(400);
		});

		test("returns 400 on update with no fields", async () => {
			const { body: created } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "Original",
					compose_mode: "new",
				}),
			});

			const { status, body } = await jsonRequest(`/api/drafts/${created.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("No fields");
		});

		test("returns 404 on update non-existent draft", async () => {
			const { status } = await jsonRequest("/api/drafts/99999", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subject: "Updated" }),
			});
			expect(status).toBe(404);
		});

		test("returns 404 on delete non-existent draft", async () => {
			const { status } = await jsonRequest("/api/drafts/99999", { method: "DELETE" });
			expect(status).toBe(404);
		});

		test("updates the references field (quoted column name)", async () => {
			const { body: created } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					subject: "Thread draft",
					compose_mode: "reply",
				}),
			});

			const { status } = await jsonRequest(`/api/drafts/${created.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					references: "<orig@example.com> <reply@example.com>",
				}),
			});
			expect(status).toBe(200);

			const { body: fetched } = await jsonRequest(`/api/drafts/${created.id}`);
			expect(fetched.references).toBe("<orig@example.com> <reply@example.com>");
		});

		test("creates reply draft with original message reference", async () => {
			const folderId = createTestFolder(db, accountId, "INBOX");
			const msgId = createTestMessage(db, accountId, folderId, 1, {
				subject: "Original message",
				messageId: "<orig@example.com>",
			});

			const { status, body } = await jsonRequest("/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					account_id: accountId,
					to_addresses: "sender@example.com",
					subject: "Re: Original message",
					text_body: "Reply body",
					in_reply_to: "<orig@example.com>",
					references: "<orig@example.com>",
					original_message_id: msgId,
					compose_mode: "reply",
				}),
			});
			expect(status).toBe(201);

			const { body: fetched } = await jsonRequest(`/api/drafts/${body.id}`);
			expect(fetched.compose_mode).toBe("reply");
			expect(fetched.in_reply_to).toBe("<orig@example.com>");
			expect(fetched.original_message_id).toBe(msgId);
		});
	});
});
