import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 60_000,
	retries: 0,
	use: {
		headless: true,
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "app",
			testMatch: "app.spec.ts",
			use: { browserName: "chromium", baseURL: "http://127.0.0.1:13200" },
		},
		{
			name: "encryption",
			testMatch: "encryption.spec.ts",
			use: { browserName: "chromium", baseURL: "http://127.0.0.1:13201" },
		},
	],
	webServer: [
		{
			command: "npx tsx tests/e2e/start-test-server.ts",
			port: 13200,
			reuseExistingServer: false,
			timeout: 15_000,
		},
		{
			command: "STORK_FAST_KDF=1 npx tsx tests/e2e/start-encryption-test-server.ts",
			port: 13201,
			reuseExistingServer: false,
			timeout: 15_000,
		},
	],
});
