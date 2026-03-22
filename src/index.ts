import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./api/server.js";
import { bootContainer } from "./crypto/lifecycle.js";
import { bootDemoDatabase, isDemoMode } from "./demo/demo-mode.js";

const DATA_DIR = process.env.STORK_DATA_DIR || "./data";
const PORT = Number(process.env.STORK_PORT || 3100);

mkdirSync(DATA_DIR, { recursive: true });

let app: ReturnType<typeof createApp>["app"];
let shutdown: () => Promise<void>;

if (isDemoMode()) {
	// Demo mode: unencrypted DB, pre-seeded data, no IMAP sync
	const db = bootDemoDatabase(DATA_DIR);
	const context = {
		state: "unlocked" as const,
		dataDir: DATA_DIR,
		db,
		scheduler: null,
		_vaultKeyInMemory: null,
	};
	const result = createApp(context);
	app = result.app;
	shutdown = async () => {
		console.log("\nShutting down demo...");
		db.close();
		process.exit(0);
	};
} else {
	const result = await bootContainer(DATA_DIR, createApp);
	app = result.app;
	shutdown = result.shutdown;
}

// ANSI color/style helpers
const c1 = "\x1b[96m\x1b[1m"; // bright cyan bold
const c2 = "\x1b[36m\x1b[1m"; // cyan bold
const c3 = "\x1b[94m\x1b[1m"; // bright blue bold
const c4 = "\x1b[34m\x1b[1m"; // blue bold
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

console.log(`
${c1}███████╗████████╗ ██████╗ ██████╗ ██╗  ██╗${reset}
${c2}██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗██║ ██╔╝${reset}
${c2}███████╗   ██║   ██║   ██║██████╔╝█████╔╝ ${reset}
${c3}╚════██║   ██║   ██║   ██║██╔══██╗██╔═██╗ ${reset}
${c4}███████║   ██║   ╚██████╔╝██║  ██║██║  ██╗${reset}
${c4}╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝${reset}
${dim}  self-hosted mail client${reset}
`);
console.log(`  ${bold}➜  Local:${reset}   http://localhost:${PORT}`);
console.log(`  ${bold}➜  Data: ${reset}   ${DATA_DIR}`);
console.log();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

serve({ port: PORT, fetch: app.fetch });
