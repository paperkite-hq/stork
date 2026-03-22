import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 30000,
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/e2e/**", "tests/e2e-container.test.ts", "**/node_modules/**"],
		coverage: {
			provider: "v8",
			// Only measure coverage for production source — exclude test helpers and type-only files
			include: ["src/**"],
			exclude: ["src/connectors/types.ts", "src/connectors/index.ts"],
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
