/**
 * Starts a stork server in "setup" state for encryption E2E tests.
 * Uses real crypto (with STORK_FAST_KDF=1) and a temp data directory.
 * Includes a test-only POST /api/__test/lock endpoint to reset state.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { encryptionRoutes } from "../../src/api/routes/encryption.js";
import type { ContainerContext } from "../../src/crypto/lifecycle.js";

// Must set STORK_FAST_KDF before importing keys.ts (it reads env at module load)
process.env.STORK_FAST_KDF = "1";

const PORT = 13201; // Different port from the main E2E server
const dataDir = mkdtempSync(join(tmpdir(), "stork-e2e-enc-"));

const context: ContainerContext = {
	state: "setup",
	dataDir,
	db: null,
	scheduler: null,
	_vaultKeyInMemory: null,
};

const app = new Hono();

const api = new Hono();

// Encryption routes (setup, unlock, change-password, etc.)
api.route("/", encryptionRoutes(context));

// Test-only: force state back to "locked" so we can test the unlock flow
api.post("/__test/lock", (c) => {
	if (context.state !== "unlocked") {
		return c.json({ error: `Cannot lock from state: ${context.state}` }, 409);
	}
	// Close db and scheduler if open
	if (context.scheduler) {
		context.scheduler.stop().catch(() => {});
		context.scheduler = null;
	}
	if (context.db) {
		context.db.close();
		context.db = null;
	}
	context.state = "locked";
	return c.json({ ok: true, state: "locked" });
});

app.route("/api", api);

// SPA fallback — serve frontend for non-API routes
import { serveStatic } from "@hono/node-server/serve-static";
app.use("/assets/*", serveStatic({ root: "./frontend/dist" }));
app.get("/stork.svg", serveStatic({ root: "./frontend/dist", path: "stork.svg" }));
app.get("*", serveStatic({ root: "./frontend/dist", path: "index.html" }));

console.log(
	`Encryption E2E test server starting on http://127.0.0.1:${PORT} (dataDir: ${dataDir})`,
);

serve({ port: PORT, fetch: app.fetch });
