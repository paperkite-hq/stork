import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { MockImapServer, buildRawEmail } from "../../test-helpers/mock-imap-server.js";
import {
	addMessageLabel,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestInboundConnector,
	createTestLabel,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Identities API", () => {
	let db: Database.Database;
	let app: Hono;

	beforeEach(() => {
		db = createTestDb();
		const ctx = createTestContext(db);
		const result = createApp(ctx);
		app = result.app;
	});

	afterEach(async () => {
		db.close();
	});

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await app.request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Identities CRUD ──────────────────────────────────────
	describe("Identities CRUD", () => {
		test("GET /api/identities returns empty array initially", async () => {
			const { status, body } = await jsonRequest("/api/identities");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		});

		test("POST /api/identities creates an identity", async () => {
			db.prepare(`
				INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
				VALUES ('SMTP', 'smtp', 'smtp.example.com', 587, 0, 'user', 'pass')
			`).run();
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					outbound_connector_id: outboundId,
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);

			const { body: identities } = await jsonRequest("/api/identities");
			expect(identities).toHaveLength(1);
			expect(identities[0].name).toBe("Test");
			expect(identities[0].email).toBe("test@example.com");
		});

		test("POST /api/identities with outbound_connector_id creates identity", async () => {
			db.prepare(`
				INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
				VALUES ('SMTP', 'smtp', 'smtp.example.com', 587, 0, 'user', 'pass')
			`).run();
			const outboundId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					outbound_connector_id: outboundId,
				}),
			});
			expect(status).toBe(201);
			expect(body.id).toBeGreaterThan(0);
		});

		test("GET /api/identities/:id returns identity details", async () => {
			const identityId = createTestIdentity(db);
			const { status, body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(status).toBe(200);
			expect(body.id).toBe(identityId);
			expect(body.name).toBe("Test Identity");
		});

		test("GET /api/identities/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/identities/999");
			expect(status).toBe(404);
		});

		test("PUT /api/identities/:id updates fields", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.name).toBe("Updated Name");
		});

		test("PUT /api/identities/:id rejects empty update", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("GET /api/identities returns default_view on each identity", async () => {
			createTestIdentity(db);
			const { body } = await jsonRequest("/api/identities");
			expect(body).toHaveLength(1);
			expect(body[0].default_view).toBe("inbox");
		});

		test("GET /api/identities/:id returns default_view in detail", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.default_view).toBe("inbox");
		});

		test("PUT /api/identities/:id updates default_view", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ default_view: "unread" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.default_view).toBe("unread");
		});

		test("DELETE /api/identities/:id deletes identity", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "DELETE",
			});
			expect(status).toBe(200);

			const { body: accounts } = await jsonRequest("/api/identities");
			expect(accounts).toHaveLength(0);
		});

		test("DELETE /api/identities/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/identities/999", {
				method: "DELETE",
			});
			expect(status).toBe(404);
		});
	});

	// ─── Validation edge cases ───────────────────────────────
	describe("Validation", () => {
		test("POST /api/identities with missing required fields fails gracefully", async () => {
			const { status } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBeGreaterThanOrEqual(400);
		});

		test("POST /api/identities rejects non-existent outbound connector", async () => {
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "test@example.com",
					outbound_connector_id: 9999,
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("not found");
		});

		test("PUT /api/identities/:id ignores unknown fields", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Valid", unknown_field: "ignored" }),
			});
			expect(status).toBe(200);

			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.name).toBe("Valid");
		});

		test("PUT /api/identities/:id with only unknown fields returns 400", async () => {
			const identityId = createTestIdentity(db);
			const { status } = await jsonRequest(`/api/identities/${identityId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ unknown_field: "value" }),
			});
			expect(status).toBe(400);
		});

		test("GET /api/identities/:id does not expose passwords", async () => {
			const identityId = createTestIdentity(db);
			const { body } = await jsonRequest(`/api/identities/${identityId}`);
			expect(body.smtp_pass).toBeUndefined();
		});

		test("POST /api/identities rejects invalid email format", async () => {
			const { status, body } = await jsonRequest("/api/identities", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test",
					email: "not-an-email",
				}),
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid email");
		});
	});

	describe("POST /identities/test-connection", () => {
		let mockServer: MockImapServer;
		let mockPort: number;

		beforeAll(async () => {
			mockServer = new MockImapServer({
				user: "conntest",
				pass: "connpass",
				mailboxes: [
					{
						path: "INBOX",
						name: "INBOX",
						delimiter: "/",
						flags: [],
						uidValidity: 1,
						uidNext: 1,
						messages: [
							{
								uid: 1,
								flags: [],
								internalDate: "2026-01-01T00:00:00Z",
								source: buildRawEmail({
									from: "a@b.com",
									to: "c@d.com",
									subject: "test",
									body: "body",
									messageId: "<t@t>",
									date: "Wed, 01 Jan 2026 00:00:00 +0000",
								}),
							},
						],
					},
				],
			});
			mockPort = await mockServer.start();
		});

		afterAll(async () => {
			await mockServer.stop();
		});

		test("returns 400 when required fields are missing", async () => {
			const { status } = await jsonRequest("/api/identities/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(status).toBe(400);
		});

		test("returns ok:false with error for unreachable server", async () => {
			const { status, body } = await jsonRequest("/api/identities/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imap_host: "127.0.0.1",
					imap_port: 19999,
					imap_tls: false,
					imap_user: "user",
					imap_pass: "pass",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(false);
			expect(body.error).toBeDefined();
		});

		test("returns ok:true with mailbox count for valid credentials", async () => {
			const { status, body } = await jsonRequest("/api/identities/test-connection", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imap_host: "127.0.0.1",
					imap_port: mockPort,
					imap_tls: false,
					imap_user: "conntest",
					imap_pass: "connpass",
				}),
			});
			expect(status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.mailboxes).toBeGreaterThan(0);
		});
	});

	// ─── Route parameter validation ──────────────────────────
	describe("Route parameter validation", () => {
		test("GET /api/identities/abc returns 400 for non-numeric identityId", async () => {
			const { status, body } = await jsonRequest("/api/identities/abc");
			expect(status).toBe(400);
			expect(body.error).toMatch(/identityId/);
		});

		test("GET /api/identities/abc/labels returns 400", async () => {
			const { status, body } = await jsonRequest("/api/identities/abc/labels");
			expect(status).toBe(400);
			expect(body.error).toMatch(/identityId/);
		});

		test("GET /api/identities/:id/labels returns cached message_count and unread_count", async () => {
			const identityId = createTestIdentity(db);
			const inboundId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, inboundId, "INBOX");

			// Create a label with messages — set counts directly (simulating refreshLabelCounts)
			const labelId = createTestLabel(db, "INBOX");
			const msgId1 = createTestMessage(db, inboundId, folderId, 1, { flags: "" });
			const msgId2 = createTestMessage(db, inboundId, folderId, 2, { flags: "\\Seen" });
			addMessageLabel(db, msgId1, labelId);
			addMessageLabel(db, msgId2, labelId);
			// Update the cached counts directly (as refreshLabelCounts would)
			db.prepare("UPDATE labels SET message_count = 2, unread_count = 1 WHERE id = ?").run(labelId);

			const { status, body } = await jsonRequest(`/api/identities/${identityId}/labels`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].name).toBe("INBOX");
			expect(body[0].message_count).toBe(2);
			expect(body[0].unread_count).toBe(1);
		});

		test("GET /api/identities/1/folders/abc/messages returns 400 for non-numeric folderId", async () => {
			const { status, body } = await jsonRequest("/api/identities/1/folders/abc/messages");
			expect(status).toBe(400);
			expect(body.error).toMatch(/folderId/);
		});
	});
});
