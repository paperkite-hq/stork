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
		css: false,
	},
});
