import type Database from "better-sqlite3-multiple-ciphers";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../api/server.js";
import { upsertAttachmentBlob } from "../../storage/attachment-storage.js";
import {
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestInboundConnector,
	createTestMessage,
} from "../../test-helpers/test-db.js";

describe("Attachments API", () => {
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

	async function request(path: string, init?: RequestInit) {
		return app.request(path, init);
	}

	async function jsonRequest(path: string, init?: RequestInit) {
		const res = await request(path, init);
		const body = await res.json().catch(() => ({ error: "parse error" }));
		return { status: res.status, body };
	}

	// ─── Attachment listing and download ────────────────────
	describe("Listing and download", () => {
		test("GET /api/messages/:id/attachments returns attachments", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1, { hasAttachments: 1 });

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'test.pdf', 'application/pdf', 1024, X'48656C6C6F')
			`).run(msgId);

			const { status, body } = await jsonRequest(`/api/messages/${msgId}/attachments`);
			expect(status).toBe(200);
			expect(body).toHaveLength(1);
			expect(body[0].filename).toBe("test.pdf");
			expect(body[0].content_type).toBe("application/pdf");
		});

		test("GET /api/attachments/:id downloads binary", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'test.txt', 'text/plain', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("text/plain");
			expect(res.headers.get("Content-Disposition")).toContain("test.txt");
			const data = await res.arrayBuffer();
			expect(Buffer.from(data).toString()).toBe("Hello");
		});

		test("GET /api/attachments/:id returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/attachments/999");
			expect(status).toBe(404);
		});
	});

	// ─── Content-ID (cid:) endpoint ────────────────────────
	describe("By Content-ID", () => {
		test("GET /api/attachments/by-cid/:messageId/:contentId returns inline image", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data, content_id)
				VALUES (?, 'logo.png', 'image/png', 5, X'89504E47', 'logo123')
			`).run(msgId);

			const res = await request(`/api/attachments/by-cid/${msgId}/logo123`);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("image/png");
			expect(res.headers.get("Cache-Control")).toContain("max-age=86400");
			const data = await res.arrayBuffer();
			expect(data.byteLength).toBe(4);
		});

		test("GET /api/attachments/by-cid returns 404 for missing", async () => {
			const { status } = await jsonRequest("/api/attachments/by-cid/999/nonexistent");
			expect(status).toBe(404);
		});

		test("null content_type falls back to application/octet-stream", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data, content_id)
				VALUES (?, 'data.bin', NULL, 3, X'414243', 'cid-null')
			`).run(msgId);

			const res = await request(`/api/attachments/by-cid/${msgId}/cid-null`);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
		});

		test("null data returns empty response", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data, content_id)
				VALUES (?, 'empty.bin', 'application/octet-stream', 0, NULL, 'cid-empty')
			`).run(msgId);

			const res = await request(`/api/attachments/by-cid/${msgId}/cid-empty`);
			expect(res.status).toBe(200);
		});
	});

	// ─── Null data in download endpoint ─────────────────────
	describe("Null data handling", () => {
		test("GET /api/attachments/:id returns response for null data", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'empty.txt', 'text/plain', 0, NULL)
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("text/plain");
		});
	});

	// ─── Content-Disposition security ───────────────────────
	describe("Filename sanitization", () => {
		test("sanitizes path separators in attachment filename", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, '../../../etc/passwd', 'text/plain', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).not.toContain("/");
			expect(disposition).toContain("_");
		});

		test("sanitizes backslash in attachment filename", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'C:\\Windows\\evil.exe', 'application/octet-stream', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).not.toContain("\\");
		});

		test("sanitizes quotes in attachment filename", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, ?, 'text/plain', 5, X'48656C6C6F')
			`).run(msgId, 'file"name.txt');

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).toBe('attachment; filename="filename.txt"');
		});

		test("null filename falls back to 'attachment'", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, NULL, 'application/octet-stream', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).toContain("attachment");
		});

		test("null content_type falls back to application/octet-stream", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'data.bin', NULL, 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
		});

		test("RFC 5987: includes filename* for non-ASCII filenames", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);
			const unicodeName = "дайджест.pdf"; // Russian

			db.prepare(
				"INSERT INTO attachments (message_id, filename, content_type, size, data) VALUES (?, ?, 'application/pdf', 5, X'48656C6C6F')",
			).run(msgId, unicodeName);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			// ASCII fallback should replace Cyrillic with underscores
			expect(disposition).toContain('filename="________.pdf"');
			// RFC 5987 parameter should contain the percent-encoded UTF-8 name
			expect(disposition).toContain("filename*=UTF-8''");
			expect(disposition).toContain(encodeURIComponent(unicodeName));
		});

		test("ASCII-only filename does not include filename*", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			db.prepare(`
				INSERT INTO attachments (message_id, filename, content_type, size, data)
				VALUES (?, 'report.pdf', 'application/pdf', 5, X'48656C6C6F')
			`).run(msgId);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			expect(disposition).toBe('attachment; filename="report.pdf"');
			expect(disposition).not.toContain("filename*");
		});
	});

	// ─── Content-addressable de-duplication ─────────────────
	describe("Attachment de-duplication", () => {
		test("upsertAttachmentBlob stores content once for identical data", () => {
			const data = Buffer.from("identical content");
			const hash1 = upsertAttachmentBlob(db, data);
			const hash2 = upsertAttachmentBlob(db, data);

			expect(hash1).toBe(hash2);

			const blobCount = (
				db
					.prepare("SELECT COUNT(*) as n FROM attachment_blobs WHERE content_hash = ?")
					.get(hash1) as { n: number }
			).n;
			expect(blobCount).toBe(1);
		});

		test("upsertAttachmentBlob stores different content as separate blobs", () => {
			const hash1 = upsertAttachmentBlob(db, Buffer.from("content A"));
			const hash2 = upsertAttachmentBlob(db, Buffer.from("content B"));

			expect(hash1).not.toBe(hash2);

			const totalBlobs = (
				db.prepare("SELECT COUNT(*) as n FROM attachment_blobs").get() as { n: number }
			).n;
			expect(totalBlobs).toBe(2);
		});

		test("GET /api/attachments/:id serves data via content_hash", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			const content = Buffer.from("Hello via hash");
			const hash = upsertAttachmentBlob(db, content);

			db.prepare(
				"INSERT INTO attachments (message_id, filename, content_type, size, content_hash) VALUES (?, ?, ?, ?, ?)",
			).run(msgId, "hash-file.txt", "text/plain", content.length, hash);

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			const body = await res.arrayBuffer();
			expect(Buffer.from(body).toString()).toBe("Hello via hash");
		});

		test("same file attached to two messages is stored once in attachment_blobs", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msg1 = createTestMessage(db, identityId, folderId, 1);
			const msg2 = createTestMessage(db, identityId, folderId, 2);

			const content = Buffer.from("shared attachment");
			const hash1 = upsertAttachmentBlob(db, content);
			const hash2 = upsertAttachmentBlob(db, content);
			expect(hash1).toBe(hash2);

			db.prepare(
				"INSERT INTO attachments (message_id, filename, content_type, size, content_hash) VALUES (?, ?, ?, ?, ?)",
			).run(msg1, "shared.pdf", "application/pdf", content.length, hash1);
			db.prepare(
				"INSERT INTO attachments (message_id, filename, content_type, size, content_hash) VALUES (?, ?, ?, ?, ?)",
			).run(msg2, "shared.pdf", "application/pdf", content.length, hash2);

			// Only one blob row despite two attachment rows
			const blobCount = (
				db.prepare("SELECT COUNT(*) as n FROM attachment_blobs").get() as { n: number }
			).n;
			expect(blobCount).toBe(1);

			// Both attachment rows can serve the correct data
			const att1Id = Number(
				(db.prepare("SELECT id FROM attachments WHERE message_id = ?").get(msg1) as { id: number })
					.id,
			);
			const att2Id = Number(
				(db.prepare("SELECT id FROM attachments WHERE message_id = ?").get(msg2) as { id: number })
					.id,
			);

			const res1 = await request(`/api/attachments/${att1Id}`);
			const res2 = await request(`/api/attachments/${att2Id}`);
			expect(Buffer.from(await res1.arrayBuffer()).toString()).toBe("shared attachment");
			expect(Buffer.from(await res2.arrayBuffer()).toString()).toBe("shared attachment");
		});

		test("legacy attachment with inline data still serves correctly", async () => {
			const identityId = createTestInboundConnector(db);
			const folderId = createTestFolder(db, identityId, "INBOX");
			const msgId = createTestMessage(db, identityId, folderId, 1);

			// Insert legacy-style row: data in column, no content_hash
			db.prepare(
				"INSERT INTO attachments (message_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)",
			).run(msgId, "legacy.txt", "text/plain", 6, Buffer.from("legacy"));

			const attId = Number(
				(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
			);

			const res = await request(`/api/attachments/${attId}`);
			expect(res.status).toBe(200);
			expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("legacy");
		});
	});
});
