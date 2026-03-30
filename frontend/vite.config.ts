import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		proxy: {
			"/api": "http://localhost:3100",
		},
	},
	build: {
		outDir: "dist",
	},
	test: {
		environment: "happy-dom",
		setupFiles: ["./src/test-setup.ts"],
		globals: true,
		testTimeout: 10000,
		css: false,
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/test-setup.ts", "src/main.tsx", "src/index.css"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
});
