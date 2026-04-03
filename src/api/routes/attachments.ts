import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { parseIntParam } from "../validation.js";

export function attachmentRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/:attachmentId", (c) => {
		const attachmentId = parseIntParam(c, "attachmentId", c.req.param("attachmentId"));
		if (attachmentId instanceof Response) return attachmentId;
		const attachment = getDb()
			.prepare(
				`SELECT a.filename, a.content_type, b.data
				FROM attachments a
				JOIN attachment_blobs b ON b.content_hash = a.content_hash
				WHERE a.id = ?`,
			)
			.get(attachmentId) as
			| { filename: string | null; content_type: string | null; data: Buffer | null }
			| undefined;
		if (!attachment) return c.json({ error: "Attachment not found" }, 404);

		const contentType = attachment.content_type ?? "application/octet-stream";
		const rawName = attachment.filename ?? "attachment";
		const safeName = rawName
			.replace(/[/\\]/g, "_")
			.replace(/["\r\n]/g, "")
			.replace(/[^\x20-\x7E]/g, "_");
		// RFC 5987: if the original name contains non-ASCII characters, include
		// filename*=UTF-8''<pct-encoded> so modern browsers use the real name.
		const hasNonAscii = /[^\x20-\x7E]/.test(rawName);
		const contentDisposition = hasNonAscii
			? `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
			: `attachment; filename="${safeName}"`;
		return new Response(attachment.data ? new Uint8Array(attachment.data) : null, {
			headers: {
				"Content-Type": contentType,
				"Content-Disposition": contentDisposition,
			},
		});
	});

	// Serve inline images by Content-ID (for cid: URL resolution in HTML emails)
	api.get("/by-cid/:messageId/:contentId", (c) => {
		const messageId = parseIntParam(c, "messageId", c.req.param("messageId"));
		if (messageId instanceof Response) return messageId;
		const contentId = c.req.param("contentId");
		const attachment = getDb()
			.prepare(
				`SELECT a.content_type, b.data
				FROM attachments a
				JOIN attachment_blobs b ON b.content_hash = a.content_hash
				WHERE a.message_id = ? AND a.content_id = ?`,
			)
			.get(messageId, contentId) as
			| { content_type: string | null; data: Buffer | null }
			| undefined;
		if (!attachment) return c.json({ error: "Attachment not found" }, 404);

		const contentType = attachment.content_type ?? "application/octet-stream";
		return new Response(attachment.data ? new Uint8Array(attachment.data) : null, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "private, max-age=86400",
			},
		});
	});

	return api;
}
