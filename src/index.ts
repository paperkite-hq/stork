import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./api/server.js";
import { bootContainer } from "./crypto/lifecycle.js";

const DATA_DIR = process.env.STORK_DATA_DIR || "./data";
const PORT = Number(process.env.STORK_PORT || 3100);

mkdirSync(DATA_DIR, { recursive: true });

const { app, shutdown } = await bootContainer(DATA_DIR, createApp);

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
