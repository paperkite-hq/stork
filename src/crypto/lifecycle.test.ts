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
import { createApp } from "../api/server.js";
import type { ContainerContext } from "./lifecycle.js";
import { bootContainer, transitionToUnlocked } from "./lifecycle.js";

// ---------------------------------------------------------------------------
// Module mocks — names prefixed with "mock" so they survive vi.mock hoisting
// ---------------------------------------------------------------------------

const mockSchedulerStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSchedulerStart = vi.fn();
const mockSchedulerLoad = vi.fn();
const mockDbClose = vi.fn();
const mockR2PollerStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockR2PollerStart = vi.fn();
const mockR2PollerLoad = vi.fn();

// Callbacks captured when SyncScheduler is constructed; tests invoke them directly.
let mockCapturedOnSyncComplete:
	| ((identityId: number, result: { totalNew: number; totalErrors: number }) => void)
	| undefined;
let mockCapturedOnSyncRecordError:
	| ((
			identityId: number,
			error: { errorType: string; message: string; retriable: boolean; folderPath?: string | null },
	  ) => void)
	| undefined;
let mockCapturedOnSyncError: ((identityId: number, error: Error) => void) | undefined;

vi.mock("../sync/sync-scheduler.js", () => ({
	// Must use `function` (not arrow) so `new SyncScheduler(...)` works.
	SyncScheduler: vi.fn(function (
		this: unknown,
		_db: unknown,
		opts: {
			onSyncComplete?: (
				identityId: number,
				result: { totalNew: number; totalErrors: number },
			) => void;
			onSyncRecordError?: (
				identityId: number,
				error: {
					errorType: string;
					message: string;
					retriable: boolean;
					folderPath?: string | null;
				},
			) => void;
			onSyncError?: (identityId: number, error: Error) => void;
		},
	) {
		mockCapturedOnSyncComplete = opts.onSyncComplete;
		mockCapturedOnSyncRecordError = opts.onSyncRecordError;
		mockCapturedOnSyncError = opts.onSyncError;
		// Return a plain object — JS constructor returns this when a non-null object is returned.
		return {
			start: mockSchedulerStart,
			stop: mockSchedulerStop,
			loadConnectorsFromDb: mockSchedulerLoad,
		};
	}),
}));

vi.mock("../storage/db.js", () => ({
	openDatabase: vi.fn(() => ({ close: mockDbClose })),
}));

vi.mock("../sync/r2-poller.js", () => ({
	R2Poller: vi.fn(function (this: unknown) {
		return {
			start: mockR2PollerStart,
			stop: mockR2PollerStop,
			loadConnectorsFromDb: mockR2PollerLoad,
		};
	}),
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

	test("onSyncComplete callback logs identity id, new-message count, and error count", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockCapturedOnSyncComplete?.(42, {
			totalNew: 7,
			totalErrors: 2,
			aborted: false,
			folders: [],
		});

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("connector 42"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("7 new"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 errors"));
		consoleSpy.mockRestore();
	});

	test("onSyncRecordError callback logs errors inline with classification", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		mockCapturedOnSyncRecordError?.(42, {
			errorType: "message",
			message: "UID 100: no source available",
			retriable: true,
		});
		mockCapturedOnSyncRecordError?.(42, {
			errorType: "flags",
			message: 'Flag sync failed for "INBOX" (UIDs 1–50): NO: access denied',
			retriable: false,
		});

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("UID 100: no source available"),
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("(will retry)"));
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Flag sync failed"));
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("(permanent)"));
		consoleErrorSpy.mockRestore();
	});

	test("onSyncComplete shows interrupted message for aborted syncs", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockCapturedOnSyncComplete?.(42, {
			totalNew: 3,
			totalErrors: 5,
			aborted: true,
			folders: [],
		});

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("interrupted"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("aborted"));
		consoleSpy.mockRestore();
	});

	test("onSyncError callback logs connector id and error message", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		mockCapturedOnSyncError?.(13, new Error("connection refused"));

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("connector 13"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
		consoleSpy.mockRestore();
	});

	test("onSyncRecordError batches >3 consecutive identical errors and emits summary at sync complete", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		// Fire 5 identical flag-sync errors for the same folder
		for (let i = 0; i < 5; i++) {
			mockCapturedOnSyncRecordError?.(1, {
				errorType: "flags",
				folderPath: "Archive",
				message: `Flag sync failed for "Archive" (UIDs ${i * 50 + 1}–${(i + 1) * 50}): BAD: something`,
				retriable: true,
			});
		}

		// Only first 3 should be logged individually
		expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

		// Flush by completing sync
		mockCapturedOnSyncComplete?.(1, { totalNew: 0, totalErrors: 5, aborted: false, folders: [] });

		// Summary line should be emitted: 5 total batches
		const allCalls = consoleErrorSpy.mock.calls.map((c) => c[0] as string);
		const summaryCall = allCalls.find((msg) => msg.includes("5 batches failed"));
		expect(summaryCall).toBeDefined();
		expect(summaryCall).toContain('"Archive"');
		expect(summaryCall).toContain("(will retry)");

		consoleErrorSpy.mockRestore();
		consoleLogSpy.mockRestore();
	});

	test("onSyncRecordError flushes batch when error type changes", () => {
		const context = makeLockedContext();
		transitionToUnlocked(context, Buffer.alloc(32));

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// 4 identical flag errors → first 3 logged, 1 suppressed
		for (let i = 0; i < 4; i++) {
			mockCapturedOnSyncRecordError?.(1, {
				errorType: "flags",
				folderPath: "Archive",
				message: `Flag sync failed for "Archive": error`,
				retriable: true,
			});
		}
		expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

		// Different error type — should flush the batch with summary
		mockCapturedOnSyncRecordError?.(1, {
			errorType: "message",
			folderPath: "Archive",
			message: "UID 999: fetch error",
			retriable: false,
		});

		const calls = consoleErrorSpy.mock.calls.map((c) => c[0] as string);
		const summary = calls.find((msg) => msg.includes("batches failed"));
		expect(summary).toBeDefined();
		expect(summary).toContain("4 batches failed");

		// The new different error should also be logged individually
		expect(calls.some((msg) => msg.includes("UID 999"))).toBe(true);

		consoleErrorSpy.mockRestore();
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
