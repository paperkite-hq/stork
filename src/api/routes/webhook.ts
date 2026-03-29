import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import type { ContainerContext } from "../../crypto/lifecycle.js";
import { storeInboundEmail } from "../../storage/email-storage.js";

interface InboundConnectorRow {
	id: number;
	cf_email_webhook_secret: string | null;
}

/** Expected payload from a Cloudflare Email Worker */
interface CloudflareEmailPayload {
	from: string;
	to: string;
	raw: string;
	rawSize: number;
}

/**
 * Webhook routes for push-based inbound connectors.
 *
 * These routes are mounted BEFORE the lock middleware so they can reject
 * requests with a proper 503 when the container is locked rather than a
 * generic 423. Messages are only stored when the container is unlocked.
 */
export function webhookRoutes(context: ContainerContext): Hono {
	const api = new Hono();

	/**
	 * POST /api/webhook/cloudflare-email/:connectorId
	 *
	 * Receives an email from a Cloudflare Email Worker and stores it for all
	 * accounts linked to the given inbound connector.
	 *
	 * Authentication: Bearer token in Authorization header, matched against
	 * cf_email_webhook_secret stored in inbound_connectors.
	 *
	 * Expected body (JSON):
	 *   { from: string, to: string, raw: string (base64), rawSize: number }
	 */
	api.post("/cloudflare-email/:connectorId", async (c) => {
		if (context.state !== "unlocked" || !context.db) {
			return c.json({ error: "Service unavailable: container is locked" }, 503);
		}

		const db = context.db;

		// Parse connector ID
		const connectorIdStr = c.req.param("connectorId");
		const connectorId = Number(connectorIdStr);
		if (!Number.isInteger(connectorId) || connectorId <= 0) {
			return c.json({ error: "Invalid connector ID" }, 400);
		}

		// Look up the connector
		const connector = db
			.prepare(
				"SELECT id, cf_email_webhook_secret FROM inbound_connectors WHERE id = ? AND type = 'cloudflare-email'",
			)
			.get(connectorId) as InboundConnectorRow | undefined;

		if (!connector) {
			return c.json({ error: "Connector not found" }, 404);
		}

		if (!connector.cf_email_webhook_secret) {
			return c.json({ error: "Connector is not fully configured" }, 400);
		}

		// Validate Authorization header
		const authHeader = c.req.header("Authorization") ?? "";
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
		if (!timingSafeEqual(token, connector.cf_email_webhook_secret)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Parse body
		let payload: CloudflareEmailPayload;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		if (!payload.raw || typeof payload.raw !== "string") {
			return c.json({ error: "Missing required field: raw" }, 400);
		}

		// Parse and store the email
		let result: { stored: number };
		try {
			result = await storeInboundEmail(db, connectorId, payload);
		} catch (err) {
			return c.json(
				{
					error: `Failed to parse email: ${err instanceof Error ? err.message : String(err)}`,
				},
				400,
			);
		}

		return c.json({ ok: true, stored: result.stored });
	});

	return api;
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
