/**
 * Unit tests for the bootContainer shutdown path and transitionToUnlocked scheduler callbacks.
 *
 * These cover lines that integration tests cannot easily reach:
 *   - shutdown() body (lines 54-67): never invoked by API-level tests
 *   - onSyncComplete / onSyncError callbacks (lines 87-92): fire only when IMAP sync runs,
 *     not exercised during setup or unlock flows
 *
 * We mock openDatabase and SyncScheduler so we can:
 *   a) call transitionToUnlocked without a real SQLCipher database
 *   b) capture the scheduler callbacks and invoke them directly
 *   c) test shutdown() without side-effecting the real DB or scheduler
 *
 * NOTE: vitest hoists vi.mock() calls to the top of the file.  Variables accessible
 * inside a vi.mock factory must start with "mock" (vitest hoisting restriction).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../src/api/server.js";
import { bootContainer, transitionToUnlocked } from "../../src/crypto/lifecycle.js";
import type { ContainerContext } from "../../src/crypto/lifecycle.js";

// ---------------------------------------------------------------------------
// Module mocks — names prefixed with "mock" so they survive vi.mock hoisting
// ---------------------------------------------------------------------------

const mockSchedulerStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSchedulerStart = vi.fn();
const mockSchedulerLoad = vi.fn();
const mockDbClose = vi.fn();

// Callbacks captured when SyncScheduler is constructed; tests invoke them directly.
let mockCapturedOnSyncComplete:
	| ((accountId: number, result: { totalNew: number; totalErrors: number }) => void)
	| undefined;
let mockCapturedOnSyncError: ((accountId: number, error: Error) => void) | undefined;

vi.mock("../../src/sync/sync-scheduler.js", () => ({
	// Must use `function` (not arrow) so `new SyncScheduler(...)` works.
	SyncScheduler: vi.fn(function (
		this: unknown,
		_db: unknown,
		opts: {
			onSyncComplete?: (
				accountId: number,
				result: { totalNew: number; totalErrors: number },
			) => void;
			onSyncError?: (accountId: number, error: Error) => void;
		},
	) {
		mockCapturedOnSyncComplete = opts.onSyncComplete;
		mockCapturedOnSyncError = opts.onSyncError;
		// Return a plain object — JS constructor returns this when a non-null object is returned.
		return {
			start: mockSchedulerStart,
			stop: mockSchedulerStop,
			loadAccountsFromDb: mockSchedulerLoad,
		};
	}),
}));

vi.mock("../../src/storage/db.js", () => ({
	openDatabase: vi.fn(() => ({ close: mockDbClose })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let dataDir: string;

beforeEach(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-lifecycle-unit-"));
	mockCapturedOnSyncComplete = undefined;
	mockCapturedOnSyncError = undefined;
	vi.clearAllMocks();
	mockSchedulerStop.mockResolvedValue(undefined);
});

afterEach(() => {
	fs.rmSync(dataDir, { recursive: true });
});

/**
 * Boot a container and run POST /api/setup so that transitionToUnlocked fires,
 * populating context.scheduler and context.db (via mocks).  Returns the shutdown fn.
 */
async function bootAndSetup() {
	const { app, shutdown } = await bootContainer(dataDir, createApp);
	const res = await app.request("/api/setup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: "testpassword123!" }),
	});
	expect(res.status).toBe(201);
	return shutdown;
}

// ---------------------------------------------------------------------------
// shutdown() — no active scheduler or db (container never unlocked)
// ---------------------------------------------------------------------------

describe("shutdown — setup state (no scheduler, no db)", () => {
	test("calls process.exit(0)", async () => {
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as unknown as (
				code?: string | number | null | undefined,
			) => never);

		const { shutdown } = await bootContainer(dataDir, createApp);
		await shutdown();

		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// shutdown() — after unlock (scheduler and db are active)
// ---------------------------------------------------------------------------

describe("shutdown — after unlock (scheduler and db active)", () => {
	test("stops the scheduler before calling process.exit(0)", async () => {
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as unknown as (
				code?: string | number | null | undefined,
			) => never);

		const shutdown = await bootAndSetup();
		await shutdown();

		expect(mockSchedulerStop).toHaveBeenCalledOnce();
		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});

	test("closes the database before calling process.exit(0)", async () => {
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as unknown as (
				code?: string | number | null | undefined,
			) => never);

		const shutdown = await bootAndSetup();
		await shutdown();

		expect(mockDbClose).toHaveBeenCalledOnce();
		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// transitionToUnlocked — scheduler callback bodies
// ---------------------------------------------------------------------------

describe("transitionToUnlocked — scheduler callbacks", () => {
	/**
	 * We call transitionToUnlocked directly with a manually-constructed context
	 * (state="locked") and a zero vault key.  openDatabase and SyncScheduler are
	 * mocked, so no real SQLCipher or IMAP code runs.
	 */
	function makeLockedContext(): ContainerContext {
		return {
			state: "locked",
			dataDir,
			db: null,
			scheduler: null,
			_vaultKeyInMemory: null,
		};
	}

	test("onSyncComplete callback logs account id, new-message count, and error count", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockCapturedOnSyncComplete?.(42, { totalNew: 7, totalErrors: 2 });

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("account 42"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("7 new"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 errors"));
		consoleSpy.mockRestore();
	});

	test("onSyncError callback logs account id and error message", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		mockCapturedOnSyncError?.(13, new Error("connection refused"));

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("account 13"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
		consoleSpy.mockRestore();
	});

	test("second transitionToUnlocked call is a no-op when already unlocked", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		// First call should have captured callbacks
		const firstComplete = mockCapturedOnSyncComplete;
		expect(firstComplete).toBeDefined();

		// Reset captured values; second call must not re-construct the scheduler
		mockCapturedOnSyncComplete = undefined;
		transitionToUnlocked(context, Buffer.alloc(32));

		expect(mockCapturedOnSyncComplete).toBeUndefined(); // SyncScheduler not called again
	});
});
