import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";

export function attachmentRoutes(getDb: () => Database.Database): Hono {
	const api = new Hono();

	api.get("/:attachmentId", (c) => {
		const attachmentId = Number(c.req.param("attachmentId"));
		const attachment = getDb()
			.prepare("SELECT filename, content_type, data FROM attachments WHERE id = ?")
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
		return new Response(attachment.data ? new Uint8Array(attachment.data) : null, {
			headers: {
				"Content-Type": contentType,
				"Content-Disposition": `attachment; filename="${safeName}"`,
			},
		});
	});

	// Serve inline images by Content-ID (for cid: URL resolution in HTML emails)
	api.get("/by-cid/:messageId/:contentId", (c) => {
		const messageId = Number(c.req.param("messageId"));
		const contentId = c.req.param("contentId");
		const attachment = getDb()
			.prepare("SELECT content_type, data FROM attachments WHERE message_id = ? AND content_id = ?")
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
