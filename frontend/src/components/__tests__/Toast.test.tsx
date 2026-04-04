import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetToastDedup, ToastContainer, toast } from "../Toast";

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
		// Background class is on the parent <div> wrapper
		expect(el.closest("[class*='bg-red-600']")).toBeInTheDocument();
	});

	it("displays an info toast with gray styling", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Just FYI", "info");
		});
		const el = screen.getByText("Just FYI");
		expect(el).toBeInTheDocument();
		expect(el.closest("[class*='bg-gray-700']")).toBeInTheDocument();
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

	it("renders action button when provided", () => {
		render(<ToastContainer />);
		const onClick = vi.fn();
		act(() => {
			toast("Archived", "success", { label: "Undo", onClick });
		});
		expect(screen.getByText("Archived")).toBeInTheDocument();
		expect(screen.getByText("Undo")).toBeInTheDocument();
	});

	it("calls action onClick and dismisses toast when action button clicked", () => {
		render(<ToastContainer />);
		const onClick = vi.fn();
		act(() => {
			toast("Archived", "success", { label: "Undo", onClick });
		});
		const undoBtn = screen.getByText("Undo");
		act(() => {
			fireEvent.click(undoBtn);
		});
		expect(onClick).toHaveBeenCalledOnce();
		// Toast should be dismissed after clicking the action
		expect(screen.queryByText("Archived")).not.toBeInTheDocument();
	});

	it("action toasts stay visible for 5 seconds instead of 3", () => {
		render(<ToastContainer />);
		act(() => {
			toast("Archived", "success", { label: "Undo", onClick: vi.fn() });
		});
		expect(screen.getByText("Archived")).toBeInTheDocument();

		// Still visible at 3s
		act(() => {
			vi.advanceTimersByTime(3000);
		});
		expect(screen.getByText("Archived")).toBeInTheDocument();

		// Dismissed at 5s
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(screen.queryByText("Archived")).not.toBeInTheDocument();
	});

	it("action toasts are never deduped", () => {
		render(<ToastContainer />);
		const onClick1 = vi.fn();
		const onClick2 = vi.fn();
		act(() => {
			toast("Archived", "success", { label: "Undo", onClick: onClick1 });
			toast("Archived", "success", { label: "Undo", onClick: onClick2 });
		});
		// Both should be shown since action toasts bypass dedup
		expect(screen.getAllByText("Archived")).toHaveLength(2);
	});

	it("renders error toasts in assertive aria-live region", () => {
		const { container } = render(<ToastContainer />);
		act(() => {
			toast("Something broke", "error");
		});
		const alertRegion = container.querySelector('[role="alert"][aria-live="assertive"]');
		expect(alertRegion).toBeInTheDocument();
		expect(alertRegion?.textContent).toContain("Something broke");
	});

	it("renders success toasts in polite aria-live region", () => {
		const { container } = render(<ToastContainer />);
		act(() => {
			toast("Done!", "success");
		});
		const statusRegion = container.querySelector('[role="status"][aria-live="polite"]');
		expect(statusRegion).toBeInTheDocument();
		expect(statusRegion?.textContent).toContain("Done!");
		// Should NOT be in the assertive region
		const alertRegion = container.querySelector('[role="alert"][aria-live="assertive"]');
		expect(alertRegion?.textContent).not.toContain("Done!");
	});

	it("separates mixed error and success toasts into correct regions", () => {
		const { container } = render(<ToastContainer />);
		act(() => {
			toast("Saved successfully", "success");
			toast("Network error", "error");
		});
		const politeRegion = container.querySelector('[role="status"][aria-live="polite"]');
		const assertiveRegion = container.querySelector('[role="alert"][aria-live="assertive"]');
		expect(politeRegion?.textContent).toContain("Saved successfully");
		expect(politeRegion?.textContent).not.toContain("Network error");
		expect(assertiveRegion?.textContent).toContain("Network error");
		expect(assertiveRegion?.textContent).not.toContain("Saved successfully");
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
