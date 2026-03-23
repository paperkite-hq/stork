import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 30000,
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		exclude: ["tests/e2e/**", "**/node_modules/**"],
		coverage: {
			provider: "v8",
			// Only measure coverage for production source — exclude test helpers and type-only files
			include: ["src/**"],
			exclude: [
				"src/connectors/types.ts",
				"src/connectors/index.ts",
				"src/**/*.test.ts",
				"src/test-helpers/**",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
	resolve: {
		conditions: ["node", "import", "default"],
	},
});
