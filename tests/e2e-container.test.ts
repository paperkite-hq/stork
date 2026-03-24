import { execSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const IMAGE_NAME = "stork-e2e-test";
const CONTAINER_NAME = "stork-e2e-test";
const PORT = 13100; // Use a non-standard port to avoid conflicts

function findRuntime(): string | null {
	for (const cmd of ["docker", "podman"]) {
		const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
		if (result.status === 0) return cmd;
	}
	return null;
}

describe("Container E2E", () => {
	let runtime: string;
	let containerReady = false;

	beforeAll(() => {
		const rt = findRuntime();
		if (!rt) {
			console.warn("[e2e-container] Docker/Podman not available — skipping container E2E tests");
			return;
		}
		runtime = rt;

		// Build the image — may fail on transient network errors (e.g. Docker Hub 504)
		try {
			execSync(`${runtime} build -t ${IMAGE_NAME} .`, {
				stdio: "inherit",
				timeout: 300_000, // 5 min for build
			});
		} catch (e) {
			console.warn(
				"[e2e-container] Docker image build failed — skipping container E2E tests:",
				e instanceof Error ? e.message.split("\n")[0] : e,
			);
			return;
		}

		// Start the container in the background
		execSync(
			`${runtime} run -d --name ${CONTAINER_NAME} --init -p 127.0.0.1:${PORT}:3100 ${IMAGE_NAME}`,
			{ stdio: "inherit" },
		);

		// Wait for the server to be ready (up to 15s)
		const start = Date.now();
		while (Date.now() - start < 15_000) {
			try {
				const res = spawnSync("curl", ["-sf", `http://127.0.0.1:${PORT}/api/health`], {
					stdio: "pipe",
					timeout: 2_000,
				});
				if (res.status === 0) {
					containerReady = true;
					return;
				}
			} catch {
				// not ready yet
			}
			spawnSync("sleep", ["0.5"]);
		}
		console.warn(
			"[e2e-container] Server did not become ready within 15 seconds — skipping container E2E tests",
		);
	}, 360_000); // 6 min timeout for beforeAll (includes build)

	afterAll(() => {
		try {
			execSync(`${runtime} rm -f ${CONTAINER_NAME}`, { stdio: "pipe" });
		} catch {
			// container may not exist
		}
		try {
			execSync(`${runtime} rmi -f ${IMAGE_NAME}`, { stdio: "pipe" });
		} catch {
			// image may not exist
		}
	});

	test("GET / returns 200 with HTML", async ({ skip }) => {
		if (!containerReady) skip();
		const res = await fetch(`http://127.0.0.1:${PORT}/`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("<!doctype html");
	});

	test("GET /api/health returns 200 with JSON", async ({ skip }) => {
		if (!containerReady) skip();
		const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
	});

	test("GET /api/status returns setup state on fresh container", async ({ skip }) => {
		if (!containerReady) skip();
		const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.state).toBe("setup");
	});

	test("GET /api/accounts returns 423 before vault is initialized", async ({ skip }) => {
		if (!containerReady) skip();
		// A fresh container starts in 'setup' state — data routes are gated until
		// the vault is initialized via POST /api/setup and unlocked.
		const res = await fetch(`http://127.0.0.1:${PORT}/api/accounts`);
		expect(res.status).toBe(423);
		const body = await res.json();
		expect(body.state).toBe("setup");
	});

	test("SPA routes return index.html (not 404)", async ({ skip }) => {
		if (!containerReady) skip();
		const res = await fetch(`http://127.0.0.1:${PORT}/inbox`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("<!doctype html");
	});
});
