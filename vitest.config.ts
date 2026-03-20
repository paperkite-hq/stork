import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 30000,
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/e2e/**", "tests/e2e-container.test.ts", "**/node_modules/**"],
	},
	resolve: {
		conditions: ["node", "import", "default"],
	},
});
