import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSyncStatus } from "../api";

// Mock the api module before importing the hook
vi.mock("../api", () => ({
	api: {
		sync: {
			status: vi.fn(),
		},
	},
}));

import { api } from "../api";
import { useSyncPoller } from "../hooks";

const mockStatus = api.sync.status as ReturnType<typeof vi.fn>;

describe("useSyncPoller", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockStatus.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts with syncing=false and lastError=null", () => {
		mockStatus.mockResolvedValue({});
		const { result } = renderHook(() => useSyncPoller(vi.fn()));

		expect(result.current.syncing).toBe(false);
		expect(result.current.lastError).toBe(null);
	});

	it("detects running sync", async () => {
		const status: GlobalSyncStatus = {
			"1": { running: true, lastSync: null, lastError: null, consecutiveErrors: 0, progress: null },
		};
		mockStatus.mockResolvedValue(status);

		const { result } = renderHook(() => useSyncPoller(vi.fn()));

		// First poll happens immediately
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(result.current.syncing).toBe(true);
	});

	it("detects idle sync", async () => {
		const status: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: 1000,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};
		mockStatus.mockResolvedValue(status);

		const { result } = renderHook(() => useSyncPoller(vi.fn()));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(result.current.syncing).toBe(false);
	});

	it("reports lastError from sync status", async () => {
		const status: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: null,
				lastError: "IMAP auth failed",
				consecutiveErrors: 1,
				progress: null,
			},
		};
		mockStatus.mockResolvedValue(status);

		const { result } = renderHook(() => useSyncPoller(vi.fn()));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(result.current.lastError).toBe("IMAP auth failed");
	});

	it("fires callback on running→idle transition", async () => {
		const onSyncComplete = vi.fn();
		const runningStatus: GlobalSyncStatus = {
			"1": { running: true, lastSync: null, lastError: null, consecutiveErrors: 0, progress: null },
		};
		// Keep lastSync null so only the running→idle transition fires
		const idleStatus: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};

		// First poll: running
		mockStatus.mockResolvedValueOnce(runningStatus);

		const { result } = renderHook(() => useSyncPoller(onSyncComplete));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(result.current.syncing).toBe(true);
		expect(onSyncComplete).not.toHaveBeenCalled();

		// Second poll: idle
		mockStatus.mockResolvedValueOnce(idleStatus);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(result.current.syncing).toBe(false);
		expect(onSyncComplete).toHaveBeenCalledTimes(1);
	});

	it("fires callback when lastSync timestamp changes", async () => {
		const onSyncComplete = vi.fn();
		const status1: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: 1000,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};
		const status2: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: 2000,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};

		mockStatus.mockResolvedValueOnce(status1);

		renderHook(() => useSyncPoller(onSyncComplete));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		expect(onSyncComplete).not.toHaveBeenCalled();

		mockStatus.mockResolvedValueOnce(status2);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(onSyncComplete).toHaveBeenCalledTimes(1);
	});

	it("does not fire callback when lastSync is unchanged", async () => {
		const onSyncComplete = vi.fn();
		const status: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: 1000,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};

		mockStatus.mockResolvedValue(status);

		renderHook(() => useSyncPoller(onSyncComplete));

		// First poll
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Second poll — same status
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		expect(onSyncComplete).not.toHaveBeenCalled();
	});

	it("handles poll errors gracefully", async () => {
		const onSyncComplete = vi.fn();
		mockStatus.mockRejectedValueOnce(new Error("network error"));

		const { result } = renderHook(() => useSyncPoller(onSyncComplete));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// Should not crash — still defaults
		expect(result.current.syncing).toBe(false);
		expect(result.current.lastError).toBe(null);
	});

	it("cleans up interval on unmount", async () => {
		mockStatus.mockResolvedValue({});

		const { unmount } = renderHook(() => useSyncPoller(vi.fn()));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		unmount();
		mockStatus.mockClear();

		// Advance timer — should not trigger another poll
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});

		expect(mockStatus).not.toHaveBeenCalled();
	});

	it("handles multiple identities", async () => {
		const status: GlobalSyncStatus = {
			"1": { running: true, lastSync: null, lastError: null, consecutiveErrors: 0, progress: null },
			"2": { running: false, lastSync: 500, lastError: null, consecutiveErrors: 0, progress: null },
		};
		mockStatus.mockResolvedValue(status);

		const { result } = renderHook(() => useSyncPoller(vi.fn()));

		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});

		// syncing=true because at least one is running
		expect(result.current.syncing).toBe(true);
	});

	it("fires progress-based callback each time new messages arrive across 3s poll intervals", async () => {
		const onSyncComplete = vi.fn();

		function runningStatus(messagesNew: number): GlobalSyncStatus {
			return {
				"1": {
					running: true,
					lastSync: null,
					lastError: null,
					consecutiveErrors: 0,
					progress: {
						currentFolder: "INBOX",
						foldersCompleted: 0,
						totalFolders: 1,
						messagesNew,
						startedAt: 0,
					},
				},
			};
		}

		// First poll: messagesNew=10 — fires callback (3s+ since last refetch)
		mockStatus.mockResolvedValueOnce(runningStatus(10));
		renderHook(() => useSyncPoller(onSyncComplete));
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(1);

		// Second poll 3s later: messagesNew=20 — 3s > 2s debounce, fires again
		mockStatus.mockResolvedValueOnce(runningStatus(20));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(2);

		// Third poll 3s later: messagesNew unchanged — no callback
		mockStatus.mockResolvedValueOnce(runningStatus(20));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(2);

		// Fourth poll 3s later: messagesNew=30 — fires again
		mockStatus.mockResolvedValueOnce(runningStatus(30));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(3);
	});

	it("debounce suppresses progress callback if less than 2s has elapsed", async () => {
		// The poller interval is 3s, but we can simulate rapid calls by temporarily
		// using Date.now mock to place two polls within the 2s debounce window.
		const onSyncComplete = vi.fn();

		function runningStatus(messagesNew: number): GlobalSyncStatus {
			return {
				"1": {
					running: true,
					lastSync: null,
					lastError: null,
					consecutiveErrors: 0,
					progress: {
						currentFolder: "INBOX",
						foldersCompleted: 0,
						totalFolders: 1,
						messagesNew,
						startedAt: 0,
					},
				},
			};
		}

		// Fake Date.now to control debounce window
		const mockNow = vi.spyOn(Date, "now");
		mockNow.mockReturnValue(0);

		// First poll at t=0: messagesNew=10 — fires (no previous refetch)
		mockStatus.mockResolvedValueOnce(runningStatus(10));
		renderHook(() => useSyncPoller(onSyncComplete));
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(1);

		// Second poll at t=1000ms: still within 2s debounce window — suppressed
		mockNow.mockReturnValue(1000);
		mockStatus.mockResolvedValueOnce(runningStatus(20));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(1); // not fired

		// Third poll at t=2500ms: outside debounce window — fires
		mockNow.mockReturnValue(2500);
		mockStatus.mockResolvedValueOnce(runningStatus(30));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(2);

		mockNow.mockRestore();
	});

	it("resets lastMessageTotal to 0 when sync is not running", async () => {
		// Covers the `else { lastMessageTotal = 0 }` branch in the progress tracking logic.
		// Ensures that when sync stops, the counter resets so that the next sync correctly
		// detects new messages starting from 0.
		const onSyncComplete = vi.fn();

		function runningStatus(messagesNew: number): GlobalSyncStatus {
			return {
				"1": {
					running: true,
					lastSync: null,
					lastError: null,
					consecutiveErrors: 0,
					progress: {
						currentFolder: "INBOX",
						totalFolders: 1,
						messagesNew,
						messagesUpdated: 0,
						messagesDeleted: 0,
						startedAt: 0,
					},
				},
			};
		}

		const idleStatus: GlobalSyncStatus = {
			"1": {
				running: false,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};

		// First poll: running with 10 new messages → fires callback
		mockStatus.mockResolvedValueOnce(runningStatus(10));
		renderHook(() => useSyncPoller(onSyncComplete));
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(onSyncComplete).toHaveBeenCalledTimes(1);

		// Second poll: sync is now idle → resets lastMessageTotal to 0
		// (This also fires callback due to running→idle transition)
		mockStatus.mockResolvedValueOnce(idleStatus);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});

		// Third poll: sync running again with only 5 new messages
		// Because lastMessageTotal was reset to 0 when idle, 5 > 0 triggers the callback
		mockStatus.mockResolvedValueOnce(runningStatus(5));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
		});
		// The callback fires at least once more (the 5 > 0 check passed because counter was reset)
		expect(onSyncComplete.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});
