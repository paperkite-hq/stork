import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	retries: 0,
	use: {
		baseURL: "http://127.0.0.1:13200",
		headless: true,
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
	webServer: {
		command: "bun run tests/e2e/start-test-server.ts",
		port: 13200,
		reuseExistingServer: false,
		timeout: 15_000,
	},
});
