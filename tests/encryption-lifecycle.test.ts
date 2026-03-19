import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/api/server.js";
import { keysFileExists } from "../src/crypto/keys.js";
import { bootContainer } from "../src/crypto/lifecycle.js";

let dataDir: string;

beforeEach(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-lifecycle-test-"));
});

afterEach(() => {
	fs.rmSync(dataDir, { recursive: true });
});

describe("container state machine", () => {
	test("starts in setup state when no keys file exists", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/status");
		const body = (await res.json()) as { state: string };
		expect(body.state).toBe("setup");
	});

	test("starts in locked state when keys file exists", async () => {
		// Initialize encryption first
		const { app: setupApp } = await bootContainer(dataDir, createApp);
		await setupApp.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "testpass123456!" }),
		});

		// Simulate container restart by booting a fresh instance
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/status");
		const body = (await res.json()) as { state: string };
		expect(body.state).toBe("locked");
	});

	test("data routes return 423 when locked", async () => {
		// Set up keys first
		const { app: setupApp } = await bootContainer(dataDir, createApp);
		await setupApp.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "testpass123456!" }),
		});

		// Boot locked
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/accounts");
		expect(res.status).toBe(423);
	});

	test("health endpoint always accessible regardless of state", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
	});
});

describe("POST /api/setup", () => {
	test("creates stork.keys and returns recovery mnemonic", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "goodpassword123!" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { recoveryMnemonic: string };
		expect(body.recoveryMnemonic).toBeTruthy();
		expect(body.recoveryMnemonic.split(/\s+/)).toHaveLength(24);
		expect(keysFileExists(dataDir)).toBe(true);
	});

	test("transitions to unlocked state after setup", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "goodpassword123!" }),
		});
		const res = await app.request("/api/status");
		const body = (await res.json()) as { state: string };
		expect(body.state).toBe("unlocked");
	});

	test("rejects short password", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "short" }),
		});
		expect(res.status).toBe(400);
	});

	test("returns 409 if already initialized", async () => {
		const { app } = await bootContainer(dataDir, createApp);
		await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "goodpassword123!" }),
		});
		// Try setup again on same instance
		const res2 = await app.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "goodpassword123!" }),
		});
		expect(res2.status).toBe(409);
	});
});

describe("POST /api/unlock", () => {
	test("unlocks with correct password", async () => {
		// Initialize
		const { app: init } = await bootContainer(dataDir, createApp);
		await init.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "correctpassword!" }),
		});

		// Boot locked, then unlock
		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "correctpassword!" }),
		});
		expect(res.status).toBe(200);

		const statusRes = await app.request("/api/status");
		const body = (await statusRes.json()) as { state: string };
		expect(body.state).toBe("unlocked");
	});

	test("returns 401 on wrong password", async () => {
		const { app: init } = await bootContainer(dataDir, createApp);
		await init.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "correctpassword!" }),
		});

		const { app } = await bootContainer(dataDir, createApp);
		const res = await app.request("/api/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "wrongpassword!" }),
		});
		expect(res.status).toBe(401);
	});

	test("data routes accessible after unlock", async () => {
		const { app: init } = await bootContainer(dataDir, createApp);
		await init.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "correctpassword!" }),
		});

		const { app } = await bootContainer(dataDir, createApp);
		await app.request("/api/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "correctpassword!" }),
		});
		const res = await app.request("/api/accounts");
		expect(res.status).toBe(200);
	});
});

describe("POST /api/change-password", () => {
	test("changes password and old password no longer works on next boot", async () => {
		const { app: init } = await bootContainer(dataDir, createApp);
		await init.request("/api/setup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "originalpass123!" }),
		});

		const res = await init.request("/api/change-password", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				currentPassword: "originalpass123!",
				newPassword: "brandnewpass456!",
			}),
		});
		expect(res.status).toBe(200);

		// Restart and try old password
		const { app } = await bootContainer(dataDir, createApp);
		const failRes = await app.request("/api/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "originalpass123!" }),
		});
		expect(failRes.status).toBe(401);

		// New password works
		const okRes = await app.request("/api/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "brandnewpass456!" }),
		});
		expect(okRes.status).toBe(200);
	});
});
