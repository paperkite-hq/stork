import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { GlobalSyncStatus, MessageSummary } from "./api";
import { api } from "./api";
import { toast } from "./components/Toast";

/** Simple data-fetching hook with loading/error states.
 *  Cancels in-flight requests via AbortController when deps change,
 *  preventing stale responses from overwriting fresh ones. */
export function useAsync<T>(
	fn: (signal: AbortSignal) => Promise<T>,
	deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fn is intentionally controlled by caller-provided deps
	const refetch = useCallback(() => {
		// Abort any previous in-flight request
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setLoading(true);
		setError(null);
		fn(controller.signal)
			.then((result) => {
				if (!controller.signal.aborted) setData(result);
			})
			.catch((e: Error) => {
				if (!controller.signal.aborted) setError(e.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
	}, deps);

	useEffect(() => {
		refetch();
		return () => {
			abortRef.current?.abort();
		};
	}, [refetch]);

	return { data, loading, error, refetch };
}

/** Dark mode hook — persists to localStorage */
export function useDarkMode(): [boolean, () => void] {
	const [dark, setDark] = useState(() => {
		if (typeof window === "undefined") return false;
		const stored = localStorage.getItem("stork-dark-mode");
		if (stored !== null) return stored === "true";
		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	});

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
		localStorage.setItem("stork-dark-mode", String(dark));
	}, [dark]);

	return [dark, () => setDark((d) => !d)];
}

/**
 * Polls sync status and fires a callback when any account transitions
 * from running → idle (i.e., a sync cycle just completed).
 */
export function useSyncPoller(onSyncComplete: () => void): {
	syncing: boolean;
	lastError: string | null;
	syncStatus: GlobalSyncStatus | null;
} {
	const [syncing, setSyncing] = useState(false);
	const [lastError, setLastError] = useState<string | null>(null);
	const [syncStatus, setSyncStatus] = useState<GlobalSyncStatus | null>(null);
	const prevStatusRef = useRef<GlobalSyncStatus | null>(null);
	const onSyncCompleteRef = useRef(onSyncComplete);
	onSyncCompleteRef.current = onSyncComplete;
	// Tracks the last time we fired a progress-based refetch to debounce rapid updates.
	// Initialized to -Infinity so the first progress update always fires immediately.
	const lastProgressRefetchRef = useRef(Number.NEGATIVE_INFINITY);

	useEffect(() => {
		let active = true;
		// Track the last total message count to detect new messages during sync
		let lastMessageTotal = 0;

		async function poll() {
			if (!active) return;
			try {
				const status = await api.sync.status();
				const anyRunning = Object.values(status).some((s) => s.running);
				setSyncing(anyRunning);
				setSyncStatus(status);

				// Check for errors
				const errors = Object.values(status)
					.filter((s) => s.lastError)
					.map((s) => s.lastError);
				setLastError(errors.length > 0 ? (errors[0] ?? null) : null);

				// Detect transition: was running → now idle (sync just completed)
				const prev = prevStatusRef.current;
				if (prev) {
					const wasRunning = Object.values(prev).some((s) => s.running);
					if (wasRunning && !anyRunning) {
						onSyncCompleteRef.current();
					}
					// Also detect new data: lastSync changed
					for (const [id, s] of Object.entries(status)) {
						const prevS = prev[id];
						if (prevS && s.lastSync && prevS.lastSync !== s.lastSync) {
							onSyncCompleteRef.current();
							break;
						}
					}
				}

				// During active sync, refetch when new messages have been synced
				// so the UI shows messages progressively instead of only at the end.
				// Debounced to at most once per 2s to avoid flooding during fast downloads.
				if (anyRunning) {
					const currentTotal = Object.values(status).reduce(
						(sum, s) => sum + (s.progress?.messagesNew ?? 0),
						0,
					);
					const now = Date.now();
					if (currentTotal > lastMessageTotal && now - lastProgressRefetchRef.current >= 2000) {
						lastMessageTotal = currentTotal;
						lastProgressRefetchRef.current = now;
						onSyncCompleteRef.current();
					}
				} else {
					lastMessageTotal = 0;
				}

				prevStatusRef.current = status;
			} catch {
				// Ignore poll errors — server may be briefly unavailable
			}
		}

		poll();
		const interval = setInterval(poll, 3000);
		return () => {
			active = false;
			clearInterval(interval);
		};
	}, []);

	return { syncing, lastError, syncStatus };
}

/** Keyboard shortcut hook — uses a ref so the handler always sees the latest
 *  shortcuts without re-registering the event listener on every render. */
export function useKeyboardShortcuts(shortcuts: Record<string, (e: KeyboardEvent) => void>) {
	const shortcutsRef = useRef(shortcuts);
	shortcutsRef.current = shortcuts;

	useEffect(() => {
		function handler(e: KeyboardEvent) {
			// Don't intercept browser shortcuts (Ctrl+C, Ctrl+V, etc.)
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			// Don't fire shortcuts when typing in inputs
			const tag = (e.target as HTMLElement).tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if ((e.target as HTMLElement).isContentEditable) return;

			const fn = shortcutsRef.current[e.key];
			if (fn) fn(e);
		}
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);
}

/**
 * Manages bulk message selection state and actions (delete, mark read/unread, move).
 * Extracted from App.tsx to reduce component complexity.
 */
export function useBulkSelection(opts: {
	messages: MessageSummary[];
	selectedMessageId: number | null;
	setSelectedMessageId: (id: number | null) => void;
	refetchMessages: () => void;
	refetchLabels: () => void;
}) {
	const { messages, selectedMessageId, setSelectedMessageId, refetchMessages, refetchLabels } =
		opts;
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

	const toggle = useCallback((id: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(messages.map((m) => m.id)));
	}, [messages]);

	const clear = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const bulkDelete = useCallback(async () => {
		const ids = [...selectedIds];
		if (ids.length === 0) return;
		try {
			await api.messages.bulk(ids, "delete");
			setSelectedIds(new Set());
			if (ids.includes(selectedMessageId ?? -1)) setSelectedMessageId(null);
			refetchMessages();
			refetchLabels();
			toast(`Deleted ${ids.length} message${ids.length !== 1 ? "s" : ""}`, "success");
		} catch (err) {
			toast(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
		}
	}, [selectedIds, selectedMessageId, setSelectedMessageId, refetchMessages, refetchLabels]);

	const markRead = useCallback(async () => {
		const ids = [...selectedIds];
		if (ids.length === 0) return;
		try {
			await api.messages.bulk(ids, "flag", { add: ["\\Seen"] });
			setSelectedIds(new Set());
			refetchMessages();
			toast(`Marked ${ids.length} message${ids.length !== 1 ? "s" : ""} as read`, "success");
		} catch (err) {
			toast(
				`Failed to mark read: ${err instanceof Error ? err.message : "Unknown error"}`,
				"error",
			);
		}
	}, [selectedIds, refetchMessages]);

	const markUnread = useCallback(async () => {
		const ids = [...selectedIds];
		if (ids.length === 0) return;
		try {
			await api.messages.bulk(ids, "flag", { remove: ["\\Seen"] });
			setSelectedIds(new Set());
			refetchMessages();
			toast(`Marked ${ids.length} message${ids.length !== 1 ? "s" : ""} as unread`, "success");
		} catch (err) {
			toast(
				`Failed to mark unread: ${err instanceof Error ? err.message : "Unknown error"}`,
				"error",
			);
		}
	}, [selectedIds, refetchMessages]);

	const move = useCallback(
		async (folderId: number) => {
			const ids = [...selectedIds];
			if (ids.length === 0) return;
			try {
				await api.messages.bulk(ids, "move", { folder_id: folderId });
				setSelectedIds(new Set());
				if (ids.includes(selectedMessageId ?? -1)) setSelectedMessageId(null);
				refetchMessages();
				refetchLabels();
				toast(`Moved ${ids.length} message${ids.length !== 1 ? "s" : ""}`, "success");
			} catch (err) {
				toast(`Failed to move: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
			}
		},
		[selectedIds, selectedMessageId, setSelectedMessageId, refetchMessages, refetchLabels],
	);

	return {
		selectedIds,
		setSelectedIds,
		toggle,
		selectAll,
		clear,
		bulkDelete,
		markRead,
		markUnread,
		move,
	};
}

/**
 * Traps keyboard focus within a container element — Tab and Shift+Tab cycle
 * through focusable elements without escaping the modal. Also restores focus
 * to the previously-focused element on unmount.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
	const previousFocusRef = useRef<Element | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Save the currently focused element to restore on unmount
		previousFocusRef.current = document.activeElement;

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== "Tab") return;
			const el = containerRef.current;
			if (!el) return;

			const focusable = el.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			if (focusable.length === 0) return;

			const first = focusable[0] as HTMLElement | undefined;
			const last = focusable[focusable.length - 1] as HTMLElement | undefined;
			if (!first || !last) return;

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}

		container.addEventListener("keydown", handleKeyDown);

		// Auto-focus the first focusable element if nothing inside is focused yet
		if (!container.contains(document.activeElement)) {
			const first = container.querySelector<HTMLElement>(
				'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			first?.focus();
		}

		return () => {
			container.removeEventListener("keydown", handleKeyDown);
			// Restore focus to the element that was focused before the modal opened
			if (previousFocusRef.current instanceof HTMLElement) {
				previousFocusRef.current.focus();
			}
		};
	}, [containerRef]);
}
