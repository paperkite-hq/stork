/**
 * Captures an animated screencast of the Stork UI for the README.
 *
 * Records a short interaction sequence (inbox → thread → search) against the
 * demo seed data, saves a WebM via Playwright's built-in video recorder, then
 * converts it to an optimized GIF using ffmpeg.
 *
 * Usage: npx tsx scripts/capture-screencast.ts
 * Output: docs/screencast.gif (and the intermediate .webm)
 *
 * Requirements: ffmpeg on PATH (for webm → gif conversion).
 *
 * Interaction philosophy: prefer clicks over keyboard events. The app's
 * keyboard shortcuts are bound to the window, but after clicking into a
 * message thread the browser may park focus inside the rendered-email iframe
 * and subsequent key events get trapped there. Clicks are immune to that.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { createApp } from "../src/api/server.js";
import { seedDemoData } from "../src/demo/seed.js";
import { createTestContext, createTestDb } from "../src/test-helpers/test-db.js";

const PORT = 13310;
const OUTPUT_DIR = join(import.meta.dirname, "..", "docs");
const VIDEO_DIR = join(OUTPUT_DIR, "screencast-video");
const GIF_PATH = join(OUTPUT_DIR, "screencast.gif");
const WEBM_PATH = join(OUTPUT_DIR, "screencast.webm");

const VIEWPORT = { width: 1024, height: 640 };
const GIF_WIDTH = 800;
const GIF_FPS = 12;

// Hard ceiling in case a single interaction hangs — without this, a stuck
// context stays open for as long as Playwright's video recorder keeps
// writing frames (previously produced a 50-minute recording).
const HARD_TIMEOUT_MS = 60_000;

function which(bin: string): string | null {
	try {
		return execFileSync("which", [bin], { encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
}

async function runInteractions(page: import("playwright").Page, baseUrl: string): Promise<void> {
	// 1. Inbox loads
	console.log("Capturing inbox load...");
	await page.goto(baseUrl);
	await page.waitForSelector("button", { timeout: 10_000 });
	await page.waitForTimeout(1600); // viewer takes in the inbox

	// 2. Open a threaded conversation
	console.log("Opening threaded conversation...");
	const threadBtn = page.getByRole("button", { name: /Q2 Infrastructure Migration Plan/ }).first();
	await threadBtn.click();
	await page.waitForTimeout(2600); // let the thread & expanded messages render

	// 3. Open a second conversation to convey in-inbox navigation
	console.log("Opening a second conversation...");
	const secondBtn = page.getByRole("button", { name: /Hetzner invoice/i }).first();
	await secondBtn.click();
	await page.waitForTimeout(2200);

	// 4. Search — click the search affordance, type slowly so the filtering is
	//    visible, then clear. Using the clickable search button rather than the
	//    "/" shortcut keeps us immune to iframe focus traps from step 2–3.
	console.log("Searching...");
	await page.getByRole("button", { name: /Search mail/i }).click();
	await page.waitForTimeout(700);
	const searchInput = page.getByPlaceholder(/Search messages/i);
	await searchInput.waitFor({ timeout: 5_000 });
	for (const ch of "invoice") {
		await searchInput.type(ch, { delay: 140 });
	}
	await page.waitForTimeout(1800); // let the viewer read the filtered results

	console.log("Done recording interactions.");
}

async function runScreencast() {
	if (!which("ffmpeg")) {
		console.error("ffmpeg not found on PATH. Install ffmpeg and retry.");
		process.exit(1);
	}

	if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
	if (existsSync(VIDEO_DIR)) rmSync(VIDEO_DIR, { recursive: true, force: true });
	mkdirSync(VIDEO_DIR, { recursive: true });

	// Start server with the same seed data as the public demo, so the screencast
	// mirrors what visitors see at stork-demo.paperkite.sh.
	const db = createTestDb();
	seedDemoData(db);
	const context = createTestContext(db);
	const { app } = createApp(context);
	if (context.scheduler) await context.scheduler.stop();
	const server = serve({ port: PORT, fetch: app.fetch });
	console.log(`Screencast server running on http://127.0.0.1:${PORT}`);

	const browser = await chromium.launch();
	const browserContext = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
	});
	const page = await browserContext.newPage();

	try {
		await Promise.race([
			runInteractions(page, `http://127.0.0.1:${PORT}`),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`interactions exceeded ${HARD_TIMEOUT_MS}ms`)),
					HARD_TIMEOUT_MS,
				),
			),
		]);
	} finally {
		// Must close the context before the video file is finalized on disk.
		await browserContext.close();
		await browser.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	// Playwright writes the video with a generated filename; find and rename it.
	const entries = readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
	if (entries.length === 0) throw new Error("No video produced by Playwright");
	const rawWebm = join(VIDEO_DIR, entries[0]);
	if (existsSync(WEBM_PATH)) rmSync(WEBM_PATH);
	renameSync(rawWebm, WEBM_PATH);
	rmSync(VIDEO_DIR, { recursive: true, force: true });
	console.log(`Saved ${WEBM_PATH}`);

	// Re-encode the raw Playwright WebM to something small enough to commit
	// (its VP8 stream is ~270 kbit/s but grows fast with idle time) and to
	// drop the audio track that's always empty.
	console.log("Re-encoding WebM for distribution size...");
	const distributableWebm = WEBM_PATH; // overwrite in place
	const tmpWebm = `${WEBM_PATH}.tmp.webm`;
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-i",
			WEBM_PATH,
			"-c:v",
			"libvpx-vp9",
			"-b:v",
			"700k",
			"-crf",
			"35",
			"-vf",
			`scale=${GIF_WIDTH}:-2,fps=${GIF_FPS}`,
			"-an",
			tmpWebm,
		],
		{ stdio: "inherit" },
	);
	renameSync(tmpWebm, distributableWebm);

	// Two-pass palette conversion gives much better colour fidelity than a
	// single-pass -vf fps=,scale=.
	console.log("Converting to GIF via ffmpeg...");
	const palette = join(OUTPUT_DIR, ".screencast-palette.png");
	const vf = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
	execFileSync(
		"ffmpeg",
		["-y", "-i", WEBM_PATH, "-vf", `${vf},palettegen=max_colors=128`, palette],
		{ stdio: "inherit" },
	);
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-i",
			WEBM_PATH,
			"-i",
			palette,
			"-lavfi",
			`${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
			"-loop",
			"0",
			GIF_PATH,
		],
		{ stdio: "inherit" },
	);
	rmSync(palette);

	console.log(`Saved ${GIF_PATH}`);
}

runScreencast()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Failed to capture screencast:", err);
		process.exit(1);
	});
