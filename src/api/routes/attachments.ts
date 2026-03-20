import type Database from "@signalapp/better-sqlite3";
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
		return new Response(attachment.data, {
			headers: {
				"Content-Type": contentType,
				"Content-Disposition": `attachment; filename="${safeName}"`,
			},
		});
	});

	return api;
}
