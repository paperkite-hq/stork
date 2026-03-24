/**
 * Playwright config for documentation screenshot generation.
 * Uses a dedicated server with fixed timestamps for stable, realistic-looking output.
 *
 * Usage: npm run screenshots:generate
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "screenshots.spec.ts",
	timeout: 60_000,
	retries: 0,
	use: {
		headless: true,
		viewport: { width: 1440, height: 900 },
		screenshot: "on",
		deviceScaleFactor: 1,
	},
	projects: [
		{
			name: "screenshots",
			use: { browserName: "chromium", baseURL: "http://127.0.0.1:13300" },
		},
	],
	webServer: [
		{
			command: "npx tsx tests/e2e/start-screenshot-server.ts",
			port: 13300,
			reuseExistingServer: false,
			timeout: 15_000,
		},
	],
});
