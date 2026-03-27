/**
 * Starts a stork server seeded with the same demo data used by the hosted
 * demo instance. Ensures documentation screenshots match what users actually
 * see in the live demo.
 */
import { serve } from "@hono/node-server";
import { createApp } from "../../src/api/server.js";
import { seedDemoData } from "../../src/demo/seed.js";
import { createTestContext, createTestDb } from "../../src/test-helpers/test-db.js";

const PORT = 13300;
const db = createTestDb();
seedDemoData(db);

const context = createTestContext(db);
const { app } = createApp(context);

if (context.scheduler) await context.scheduler.stop();

console.log(`Screenshot server starting on http://127.0.0.1:${PORT}`);

serve({ port: PORT, fetch: app.fetch });
