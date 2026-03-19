import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer, toast } from "../Toast";

describe("ToastContainer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
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
