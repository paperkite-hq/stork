import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	useAsync,
	useDarkMode,
	useFocusTrap,
	useHistoryNavigation,
	useKeyboardShortcuts,
} from "../hooks";

describe("useAsync", () => {
	it("returns data on success", async () => {
		const { result } = renderHook(() => useAsync(() => Promise.resolve("hello"), []));
		expect(result.current.loading).toBe(true);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.data).toBe("hello");
		expect(result.current.error).toBeNull();
	});

	it("returns error message on failure", async () => {
		const { result } = renderHook(() =>
			useAsync(() => Promise.reject(new Error("fetch failed")), []),
		);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.data).toBeNull();
		expect(result.current.error).toBe("fetch failed");
	});

	it("cancels stale requests when deps change", async () => {
		let resolveFirst: (v: string) => void;
		const firstPromise = new Promise<string>((r) => {
			resolveFirst = r;
		});
		let callCount = 0;
		const fn = vi.fn((signal: AbortSignal) => {
			callCount++;
			if (callCount === 1) return firstPromise;
			return Promise.resolve("second");
		});

		const { result, rerender } = renderHook(({ dep }: { dep: number }) => useAsync(fn, [dep]), {
			initialProps: { dep: 1 },
		});

		// Trigger deps change before first resolves
		rerender({ dep: 2 });
		await waitFor(() => expect(result.current.data).toBe("second"));

		// Resolve the first — should be ignored (aborted)
		resolveFirst?.("first");
		// Give it a tick to process
		await new Promise((r) => setTimeout(r, 50));
		expect(result.current.data).toBe("second");
	});

	it("refetch re-fetches data", async () => {
		let count = 0;
		const { result } = renderHook(() => useAsync(() => Promise.resolve(`result-${++count}`), []));
		await waitFor(() => expect(result.current.data).toBe("result-1"));

		act(() => {
			result.current.refetch();
		});
		await waitFor(() => expect(result.current.data).toBe("result-2"));
	});
});

describe("useDarkMode", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.classList.remove("dark");
	});

	it("defaults to false when no stored preference and system prefers light", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: false,
		} as MediaQueryList);

		const { result } = renderHook(() => useDarkMode());
		expect(result.current[0]).toBe(false);
	});

	it("defaults to true when system prefers dark", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: true,
		} as MediaQueryList);

		const { result } = renderHook(() => useDarkMode());
		expect(result.current[0]).toBe(true);
	});

	it("reads stored preference from localStorage", () => {
		localStorage.setItem("stork-dark-mode", "true");
		const { result } = renderHook(() => useDarkMode());
		expect(result.current[0]).toBe(true);
	});

	it("persists preference to localStorage on toggle", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: false,
		} as MediaQueryList);

		const { result } = renderHook(() => useDarkMode());
		expect(result.current[0]).toBe(false);

		act(() => {
			result.current[1](); // toggle
		});

		expect(result.current[0]).toBe(true);
		expect(localStorage.getItem("stork-dark-mode")).toBe("true");
	});

	it("toggles the 'dark' class on documentElement", () => {
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: false,
		} as MediaQueryList);

		const { result } = renderHook(() => useDarkMode());
		expect(document.documentElement.classList.contains("dark")).toBe(false);

		act(() => {
			result.current[1]();
		});
		expect(document.documentElement.classList.contains("dark")).toBe(true);

		act(() => {
			result.current[1]();
		});
		expect(document.documentElement.classList.contains("dark")).toBe(false);
	});

	it("stored 'false' takes precedence over system dark preference", () => {
		localStorage.setItem("stork-dark-mode", "false");
		vi.spyOn(window, "matchMedia").mockReturnValue({
			matches: true,
		} as MediaQueryList);

		const { result } = renderHook(() => useDarkMode());
		expect(result.current[0]).toBe(false);
	});
});

describe("useKeyboardShortcuts", () => {
	it("fires the matching handler on keydown", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});

		expect(handler).toHaveBeenCalledOnce();
	});

	it("does not fire for unregistered keys", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores keydown in INPUT elements", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		const input = document.createElement("input");
		document.body.appendChild(input);

		act(() => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
		});

		expect(handler).not.toHaveBeenCalled();
		document.body.removeChild(input);
	});

	it("ignores keydown in TEXTAREA elements", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);

		act(() => {
			textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
		});

		expect(handler).not.toHaveBeenCalled();
		document.body.removeChild(textarea);
	});

	it("ignores keydown in SELECT elements", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		const select = document.createElement("select");
		document.body.appendChild(select);

		act(() => {
			select.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
		});

		expect(handler).not.toHaveBeenCalled();
		document.body.removeChild(select);
	});

	it("ignores keydown in contentEditable elements", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: handler }));

		const div = document.createElement("div");
		div.contentEditable = "true";
		document.body.appendChild(div);

		act(() => {
			div.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
		});

		expect(handler).not.toHaveBeenCalled();
		document.body.removeChild(div);
	});

	it("removes event listener on unmount", () => {
		const handler = vi.fn();
		const { unmount } = renderHook(() => useKeyboardShortcuts({ j: handler }));

		unmount();

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores keydown when Ctrl is held (e.g. Ctrl+C to copy)", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ c: handler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }));
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores keydown when Meta/Cmd is held", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ c: handler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true }));
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores keydown when Alt is held", () => {
		const handler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ f: handler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", altKey: true }));
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it("handles multiple shortcuts", () => {
		const jHandler = vi.fn();
		const kHandler = vi.fn();
		renderHook(() => useKeyboardShortcuts({ j: jHandler, k: kHandler }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
		});

		expect(jHandler).toHaveBeenCalledOnce();
		expect(kHandler).toHaveBeenCalledOnce();
	});
});

describe("useFocusTrap", () => {
	function TestModal({ onClose }: { onClose?: () => void }) {
		const ref = useRef<HTMLDivElement>(null);
		useFocusTrap(ref);
		return (
			<div ref={ref} data-testid="modal">
				<button type="button">First</button>
				<input type="text" placeholder="Middle" />
				<button type="button" onClick={onClose}>
					Last
				</button>
			</div>
		);
	}

	it("traps Tab at the last element, cycling to first", async () => {
		render(<TestModal />);
		const lastBtn = screen.getByText("Last");
		lastBtn.focus();
		expect(document.activeElement).toBe(lastBtn);

		await userEvent.tab();
		// Should cycle to the first focusable element
		expect(document.activeElement).toBe(screen.getByText("First"));
	});

	it("traps Shift+Tab at the first element, cycling to last", async () => {
		render(<TestModal />);
		const firstBtn = screen.getByText("First");
		firstBtn.focus();
		expect(document.activeElement).toBe(firstBtn);

		await userEvent.tab({ shift: true });
		expect(document.activeElement).toBe(screen.getByText("Last"));
	});

	it("restores focus to previously focused element on unmount", () => {
		// Create an external button and focus it
		const externalBtn = document.createElement("button");
		externalBtn.textContent = "External";
		document.body.appendChild(externalBtn);
		externalBtn.focus();
		expect(document.activeElement).toBe(externalBtn);

		const { unmount } = render(<TestModal />);
		// Modal should auto-focus first element
		expect(document.activeElement).not.toBe(externalBtn);

		unmount();
		// Focus should be restored
		expect(document.activeElement).toBe(externalBtn);
		document.body.removeChild(externalBtn);
	});

	it("auto-focuses first focusable element on mount", () => {
		render(<TestModal />);
		expect(document.activeElement).toBe(screen.getByText("First"));
	});
});

describe("useHistoryNavigation", () => {
	beforeEach(() => {
		// Reset history state
		history.replaceState(null, "");
	});

	it("replaces initial history entry with current state when accountId becomes non-null", () => {
		const onNavigate = vi.fn();
		const { rerender } = renderHook(
			(props: {
				accountId: number | null;
				labelId: number | null;
				messageId: number | null;
			}) =>
				useHistoryNavigation({
					...props,
					onNavigate,
				}),
			{ initialProps: { accountId: null, labelId: null, messageId: null } },
		);

		// accountId is null — should not set state yet
		expect(history.state).toBeNull();

		// Rerender with a valid accountId
		rerender({ accountId: 1, labelId: 5, messageId: null });
		expect(history.state).toEqual({
			accountId: 1,
			labelId: 5,
			messageId: null,
			searchActive: undefined,
		});
	});

	it("pushes new state when navigation changes after initialization", () => {
		const onNavigate = vi.fn();
		const pushSpy = vi.spyOn(history, "pushState");

		const { rerender } = renderHook(
			(props: {
				accountId: number | null;
				labelId: number | null;
				messageId: number | null;
			}) =>
				useHistoryNavigation({
					...props,
					onNavigate,
				}),
			{ initialProps: { accountId: 1, labelId: 5, messageId: null } },
		);

		// Clear the calls from initialization
		pushSpy.mockClear();

		// Change navigation state
		rerender({ accountId: 1, labelId: 10, messageId: null });
		expect(pushSpy).toHaveBeenCalledWith(
			{ accountId: 1, labelId: 10, messageId: null, searchActive: undefined },
			"",
		);

		pushSpy.mockRestore();
	});

	it("does not push duplicate state", () => {
		const onNavigate = vi.fn();
		const pushSpy = vi.spyOn(history, "pushState");

		const { rerender } = renderHook(
			(props: {
				accountId: number | null;
				labelId: number | null;
				messageId: number | null;
			}) =>
				useHistoryNavigation({
					...props,
					onNavigate,
				}),
			{ initialProps: { accountId: 1, labelId: 5, messageId: null } },
		);

		pushSpy.mockClear();

		// Re-render with same state — should not push
		rerender({ accountId: 1, labelId: 5, messageId: null });
		expect(pushSpy).not.toHaveBeenCalled();

		pushSpy.mockRestore();
	});

	it("calls onNavigate on popstate event", () => {
		const onNavigate = vi.fn();

		renderHook(() =>
			useHistoryNavigation({
				accountId: 1,
				labelId: 5,
				messageId: null,
				onNavigate,
			}),
		);

		// Simulate a popstate event (browser back/forward)
		const navState = { accountId: 1, labelId: 3, messageId: 42, searchActive: false };
		act(() => {
			const event = new PopStateEvent("popstate", { state: navState });
			window.dispatchEvent(event);
		});

		expect(onNavigate).toHaveBeenCalledWith(navState);
	});

	it("ignores popstate with null state", () => {
		const onNavigate = vi.fn();

		renderHook(() =>
			useHistoryNavigation({
				accountId: 1,
				labelId: 5,
				messageId: null,
				onNavigate,
			}),
		);

		act(() => {
			const event = new PopStateEvent("popstate", { state: null });
			window.dispatchEvent(event);
		});

		expect(onNavigate).not.toHaveBeenCalled();
	});

	it("does not push state after popstate (prevents circular navigation)", () => {
		const onNavigate = vi.fn();
		const pushSpy = vi.spyOn(history, "pushState");

		const { rerender } = renderHook(
			(props: {
				accountId: number | null;
				labelId: number | null;
				messageId: number | null;
			}) =>
				useHistoryNavigation({
					...props,
					onNavigate,
				}),
			{ initialProps: { accountId: 1, labelId: 5, messageId: null } },
		);

		pushSpy.mockClear();

		// Simulate popstate
		const navState = { accountId: 1, labelId: 3, messageId: null };
		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate", { state: navState }));
		});

		// Rerender with the navigated state (simulating what the App would do after onNavigate)
		rerender({ accountId: 1, labelId: 3, messageId: null });

		// Should NOT push (isPopstateRef prevents it)
		expect(pushSpy).not.toHaveBeenCalled();

		pushSpy.mockRestore();
	});
});
