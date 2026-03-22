import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3-multiple-ciphers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContainerContext } from "../crypto/lifecycle.js";
import { isDemoMode } from "../demo/demo-mode.js";
import type { SyncScheduler } from "../sync/sync-scheduler.js";
import { accountRoutes } from "./routes/accounts.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { draftRoutes } from "./routes/drafts.js";
import { encryptionRoutes } from "./routes/encryption.js";
import { labelRoutes } from "./routes/labels.js";
import { messageRoutes } from "./routes/messages.js";
import { searchRoutes } from "./routes/search.js";
import { sendRoutes } from "./routes/send.js";
import { syncRoutes } from "./routes/sync.js";

export function createApp(context: ContainerContext): { app: Hono } {
	const app = new Hono();

	app.use("*", cors());

	// Content Security Policy — defense-in-depth against XSS.
	// Even if the HTML sanitizer misses something, these headers prevent
	// inline script execution and restrict resource loading.
	app.use("*", async (c, next) => {
		await next();
		// Only set CSP on HTML responses (the SPA shell)
		const ct = c.res.headers.get("content-type") ?? "";
		if (ct.includes("text/html")) {
			c.res.headers.set(
				"Content-Security-Policy",
				[
					"default-src 'self'",
					"script-src 'self'",
					"style-src 'self' 'unsafe-inline'",
					"img-src 'self' data: cid: https:",
					"font-src 'self'",
					"connect-src 'self'",
					"frame-src 'self' blob:",
					"object-src 'none'",
					"base-uri 'self'",
				].join("; "),
			);
		}
	});

	// Serve frontend static files
	app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
	app.get("/stork.svg", serveStatic({ root: "./frontend/dist", path: "stork.svg" }));

	const api = new Hono();

	// ── Demo mode indicator ─────────────────────────────────────────────────
	api.get("/demo", (c) => {
		return c.json({ demo: isDemoMode() });
	});

	// ── Always-accessible endpoints (health, status, setup, unlock) ─────────
	api.route("/", encryptionRoutes(context));

	// ── Lock middleware — blocks all data routes until unlocked ──────────────
	api.use("*", async (c, next) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		await next();
	});

	// ── Demo read-only middleware — blocks mutations on data routes ──────────
	if (isDemoMode()) {
		api.use("*", async (c, next) => {
			const method = c.req.method;
			if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
				return c.json({ error: "This is a read-only demo" }, 403);
			}
			await next();
		});
	}

	// ── Data routes (all require unlocked state via middleware above) ────────

	function getDb(): Database.Database {
		if (!context.db) throw new Error("db not available");
		return context.db;
	}

	function getScheduler(): SyncScheduler {
		if (!context.scheduler) throw new Error("scheduler not available");
		return context.scheduler;
	}

	api.route("/accounts", accountRoutes(getDb, getScheduler));
	api.route("/messages", messageRoutes(getDb));
	api.route("/labels", labelRoutes(getDb));
	api.route("/attachments", attachmentRoutes(getDb));
	api.route("/search", searchRoutes(getDb));
	api.route("/sync", syncRoutes(getScheduler, getDb));
	api.route("/send", sendRoutes(getDb));
	api.route("/drafts", draftRoutes(getDb));

	app.route("/api", api);

	// SPA fallback — serve index.html for all non-API, non-asset routes
	app.get("*", serveStatic({ root: "./frontend/dist", path: "index.html" }));

	return { app };
}
