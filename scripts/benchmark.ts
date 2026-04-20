/**
 * Stork performance benchmark.
 *
 * Seeds a fresh encrypted on-disk database with N synthetic messages and
 * measures:
 *   - Insert throughput (msgs/sec) — proxy for sync ingest rate (the network
 *     round-trip of an IMAP fetch dominates real sync, but local storage is
 *     the component we own and can benchmark cleanly)
 *   - FTS5 search latency (cold + warm) for several query shapes
 *   - Final on-disk size (with zlib compression on html_body and encryption)
 *   - Resident set size at the end of the run
 *
 * Synthetic corpus: messages use a small vocabulary of real English words
 * plus unique per-message tokens, so FTS5 queries hit a realistic mix of
 * common and rare terms. html_body is a padded HTML block (~4 KB) per
 * message so the compression path is exercised.
 *
 * Usage:
 *   npx tsx scripts/benchmark.ts --size=50000 [--out=bench-50k.json]
 *
 * Output: human-readable summary to stdout; full JSON (optionally) to --out.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressText } from "../src/storage/compression.js";
import { openDatabase } from "../src/storage/db.js";

interface Args {
	size: number;
	out?: string;
	keep?: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { size: 50_000 };
	for (const a of argv.slice(2)) {
		if (a.startsWith("--size=")) args.size = Number(a.slice("--size=".length));
		else if (a.startsWith("--out=")) args.out = a.slice("--out=".length);
		else if (a === "--keep") args.keep = true;
	}
	if (!Number.isFinite(args.size) || args.size <= 0) {
		throw new Error(`Invalid --size=${args.size}`);
	}
	return args;
}

// Small vocabulary: ~100 common English words. Combined with per-message
// unique tokens this gives FTS5 a realistic index shape (zipfian term freq).
const VOCAB = [
	"the",
	"and",
	"for",
	"are",
	"but",
	"not",
	"you",
	"all",
	"can",
	"had",
	"her",
	"was",
	"one",
	"our",
	"out",
	"day",
	"get",
	"has",
	"him",
	"his",
	"how",
	"man",
	"new",
	"now",
	"old",
	"see",
	"two",
	"way",
	"who",
	"boy",
	"did",
	"its",
	"let",
	"put",
	"say",
	"she",
	"too",
	"use",
	"meeting",
	"project",
	"update",
	"quarterly",
	"report",
	"please",
	"review",
	"attached",
	"document",
	"confidential",
	"urgent",
	"priority",
	"invoice",
	"receipt",
	"payment",
	"account",
	"password",
	"security",
	"notification",
	"calendar",
	"schedule",
	"appointment",
	"reminder",
	"deadline",
	"draft",
	"proposal",
	"contract",
	"agreement",
	"renewal",
	"shipment",
	"delivery",
	"tracking",
	"order",
	"confirmation",
	"refund",
	"support",
	"ticket",
	"issue",
	"resolved",
	"pending",
	"approval",
	"travel",
	"booking",
	"hotel",
	"flight",
	"receipt",
	"expense",
	"weekly",
	"newsletter",
	"subscription",
	"unsubscribe",
	"offer",
	"discount",
	"coupon",
	"available",
	"download",
	"attachment",
	"photo",
	"database",
	"server",
	"cluster",
	"deployment",
];

function pickWord(rng: () => number): string {
	return VOCAB[Math.floor(rng() * VOCAB.length)];
}

// Deterministic mulberry32 PRNG — reproducible corpora across runs.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function buildTextBody(rng: () => number, uniqueToken: string): string {
	const parts: string[] = [];
	// ~120 words per message — representative of a short business email
	for (let i = 0; i < 120; i++) parts.push(pickWord(rng));
	// Inject one unique token so we can test "rare term" search latency
	parts.splice(Math.floor(parts.length / 2), 0, uniqueToken);
	return parts.join(" ");
}

function buildHtmlBody(text: string): string {
	// ~4 KB of HTML wrapping the text body — exercises zlib compression path
	const pad = "<p>"
		.concat("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40))
		.concat("</p>");
	return `<html><body><div class="msg">${text.replace(/\b/g, "")}</div>${pad}</body></html>`;
}

interface BenchResult {
	size: number;
	seedMs: number;
	insertPerSec: number;
	dbBytes: number;
	bytesPerMessage: number;
	rssMb: number;
	searches: Array<{
		name: string;
		query: string;
		coldMs: number;
		warmMs: number;
		warmP50Ms: number;
		warmP95Ms: number;
		hits: number;
	}>;
}

function ms(nsStart: bigint): number {
	return Number(process.hrtime.bigint() - nsStart) / 1e6;
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[i];
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	const tmp = join(tmpdir(), `stork-bench-${Date.now()}-${randomBytes(4).toString("hex")}`);
	mkdirSync(tmp, { recursive: true });

	try {
		const vaultKey = randomBytes(32);
		console.log(`[bench] corpus size: ${args.size.toLocaleString()} messages`);
		console.log(`[bench] data dir:    ${tmp}`);

		// --- Open encrypted DB ---
		const openStart = process.hrtime.bigint();
		const db = openDatabase("stork.db", tmp, vaultKey);
		const openMs = ms(openStart);
		console.log(`[bench] db open:     ${openMs.toFixed(1)} ms`);

		// --- Seed fixtures ---
		db.prepare(
			`INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
			 VALUES ('Bench', 'imap', '127.0.0.1', 993, 1, 'u', 'p')`,
		).run();
		const connectorId = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
		db.prepare(
			`INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, uid_validity)
			 VALUES (?, 'INBOX', 'INBOX', '/', '[]', 1)`,
		).run(connectorId);
		const folderId = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

		// --- Insert N synthetic messages ---
		const rng = mulberry32(0xc0ffee);
		const insert = db.prepare(`
			INSERT INTO messages (
				inbound_connector_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, date,
				text_body, html_body, flags, size, has_attachments
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 0)
		`);

		const insertMany = db.transaction((count: number, startUid: number) => {
			for (let i = 0; i < count; i++) {
				const uid = startUid + i;
				const uniqueToken = `uniq${uid.toString(36)}`;
				const text = buildTextBody(rng, uniqueToken);
				const html = buildHtmlBody(text);
				const compressedHtml = compressText(html);
				// Use a fixed historical date range so before:/after: queries are meaningful.
				const dayOffset = uid % 730; // spread across ~2 years
				const date = new Date(Date.UTC(2024, 0, 1) + dayOffset * 86_400_000).toISOString();
				const senderIdx = uid % 200;
				insert.run(
					connectorId,
					folderId,
					uid,
					`<msg-${uid}@bench.local>`,
					`Subject ${pickWord(rng)} ${pickWord(rng)} ${uid}`,
					`sender${senderIdx}@bench.local`,
					`Sender ${senderIdx}`,
					`["recipient@bench.local"]`,
					date,
					text,
					compressedHtml,
					text.length + html.length,
				);
			}
		});

		console.log(`[bench] seeding...`);
		const seedStart = process.hrtime.bigint();
		// Batch in 5k chunks so progress is observable on large corpora
		const BATCH = 5000;
		for (let i = 0; i < args.size; i += BATCH) {
			const n = Math.min(BATCH, args.size - i);
			insertMany(n, i + 1);
			if ((i + n) % 20_000 === 0 || i + n === args.size) {
				const done = i + n;
				const elapsed = ms(seedStart) / 1000;
				process.stdout.write(
					`\r[bench]   ${done.toLocaleString()} / ${args.size.toLocaleString()}  (${(done / elapsed).toFixed(0)} msgs/sec)   `,
				);
			}
		}
		process.stdout.write("\n");
		const seedMs = ms(seedStart);
		const insertPerSec = (args.size / seedMs) * 1000;
		console.log(
			`[bench] seed done:   ${(seedMs / 1000).toFixed(1)} s (${insertPerSec.toFixed(0)} msgs/sec)`,
		);

		// Flush WAL so file size measurement is accurate.
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		db.exec("PRAGMA optimize");

		// --- Measure DB size ---
		const dbBytes = statSync(join(tmp, "stork.db")).size;
		const bytesPerMessage = dbBytes / args.size;
		console.log(
			`[bench] db size:     ${(dbBytes / 1024 / 1024).toFixed(1)} MiB (${bytesPerMessage.toFixed(0)} B/msg)`,
		);

		// --- Close + reopen to measure cold search (clears SQLite page cache) ---
		db.close();

		const db2 = openDatabase("stork.db", tmp, vaultKey);

		// Clear OS page cache is privileged; we rely on close/reopen to clear
		// SQLite's own cache. First query after reopen is our "cold" measurement.
		const searches: BenchResult["searches"] = [];
		const queries: Array<{ name: string; query: string }> = [
			{ name: "common_term", query: "meeting" },
			{ name: "two_terms_and", query: "project update" },
			{ name: "rare_term", query: "uniq1a" }, // should hit exactly one doc
			{ name: "phrase", query: '"quarterly report"' },
			{ name: "prefix", query: "confid*" },
		];

		for (const q of queries) {
			// Cold: first execution after reopen (for that query)
			const coldStart = process.hrtime.bigint();
			const coldRows = db2
				.prepare(
					`SELECT m.id FROM messages_fts
					 JOIN messages m ON m.id = messages_fts.rowid
					 WHERE messages_fts MATCH ?
					 ORDER BY rank LIMIT 50`,
				)
				.all(q.query) as Array<{ id: number }>;
			const coldMs = ms(coldStart);

			// Warm: 10 repeated runs (same query, already cached)
			const warmSamples: number[] = [];
			for (let i = 0; i < 10; i++) {
				const s = process.hrtime.bigint();
				db2
					.prepare(
						`SELECT m.id FROM messages_fts
						 JOIN messages m ON m.id = messages_fts.rowid
						 WHERE messages_fts MATCH ?
						 ORDER BY rank LIMIT 50`,
					)
					.all(q.query);
				warmSamples.push(ms(s));
			}

			searches.push({
				name: q.name,
				query: q.query,
				coldMs,
				warmMs: warmSamples.reduce((a, b) => a + b, 0) / warmSamples.length,
				warmP50Ms: percentile(warmSamples, 50),
				warmP95Ms: percentile(warmSamples, 95),
				hits: coldRows.length,
			});

			console.log(
				`[bench] search ${q.name.padEnd(14)} cold ${coldMs.toFixed(1).padStart(6)} ms  warm p50 ${percentile(warmSamples, 50).toFixed(1).padStart(5)} ms  p95 ${percentile(warmSamples, 95).toFixed(1).padStart(5)} ms  (${coldRows.length} hits)`,
			);
		}

		db2.close();

		const rssMb = process.memoryUsage().rss / 1024 / 1024;
		console.log(`[bench] rss:         ${rssMb.toFixed(0)} MiB`);

		const result: BenchResult = {
			size: args.size,
			seedMs,
			insertPerSec,
			dbBytes,
			bytesPerMessage,
			rssMb,
			searches,
		};

		if (args.out) {
			const { writeFileSync } = await import("node:fs");
			writeFileSync(args.out, JSON.stringify(result, null, 2));
			console.log(`[bench] wrote ${args.out}`);
		}
	} finally {
		if (!args.keep) {
			rmSync(tmp, { recursive: true, force: true });
		} else {
			console.log(`[bench] kept data dir: ${tmp}`);
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
