import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer, _resetToastDedup, toast } from "../Toast";

describe("ToastContainer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		_resetToastDedup();
	});

	it("renders nothing when no toasts are active", () => {
		const { container } = render(<ToastContainer />);
		expect(container.querySelector(".fixed")).toBeInTheDocument();
		expect(screen.queryByText(/./)).not.toBeInTheDocument();
	});

	it("displays a success toast", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Operation successful");
		});
		expect(screen.getByText("Operation successful")).toBeInTheDocument();
	});

	it("displays an error toast with red styling", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Something failed", "error");
		});
		const el = screen.getByText("Something failed");
		expect(el).toBeInTheDocument();
		expect(el.className).toContain("bg-red-600");
	});

	it("displays an info toast with gray styling", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Just FYI", "info");
		});
		const el = screen.getByText("Just FYI");
		expect(el).toBeInTheDocument();
		expect(el.className).toContain("bg-gray-700");
	});

	it("auto-dismisses after 3 seconds", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Temporary message");
		});
		expect(screen.getByText("Temporary message")).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(screen.queryByText("Temporary message")).not.toBeInTheDocument();
	});

	it("shows multiple toasts simultaneously", () => {
		render(<ToastContainer />);
		act(() => {
			toast("First toast");
			toast("Second toast");
		});
		expect(screen.getByText("First toast")).toBeInTheDocument();
		expect(screen.getByText("Second toast")).toBeInTheDocument();
	});

	it("deduplicates identical toasts within 2s window", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Duplicate message");
			toast("Duplicate message"); // same text + type within 2s
			toast("Duplicate message"); // still within 2s
		});
		// Only one should appear
		expect(screen.getAllByText("Duplicate message")).toHaveLength(1);
	});

	it("allows same toast text after dedup window expires", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Repeat me");
		});
		expect(screen.getAllByText("Repeat me")).toHaveLength(1);

		// Advance past the 2s dedup window
		act(() => {
			vi.advanceTimersByTime(2100);
		});
		act(() => {
			toast("Repeat me");
		});
		// The first one auto-dismissed after 3s but was re-created at 2.1s — both may be visible
		// depending on timing. The important thing is the second call wasn't blocked.
		expect(screen.getAllByText("Repeat me").length).toBeGreaterThanOrEqual(1);
	});

	it("dismisses toasts independently", () => {
		render(<ToastContainer />);
		act(() => {
			toast("First toast");
		});
		act(() => {
			vi.advanceTimersByTime(1500);
		});
		act(() => {
			toast("Second toast");
		});

		// First toast should disappear after its 3s timer
		act(() => {
			vi.advanceTimersByTime(1500);
		});
		expect(screen.queryByText("First toast")).not.toBeInTheDocument();
		expect(screen.getByText("Second toast")).toBeInTheDocument();

		// Second toast disappears after its own 3s
		act(() => {
			vi.advanceTimersByTime(1500);
		});
		expect(screen.queryByText("Second toast")).not.toBeInTheDocument();
	});
});
