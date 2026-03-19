import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDarkMode, useKeyboardShortcuts } from "../hooks";

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
