import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsHelp } from "../ShortcutsHelp";

describe("ShortcutsHelp", () => {
	it("renders all keyboard shortcuts", () => {
		render(<ShortcutsHelp onClose={() => {}} />);
		expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		expect(screen.getByText("Next message")).toBeInTheDocument();
		expect(screen.getByText("Previous message")).toBeInTheDocument();
		expect(screen.getByText("Reply")).toBeInTheDocument();
		expect(screen.getByText("Reply all")).toBeInTheDocument();
		expect(screen.getByText("Forward")).toBeInTheDocument();
		expect(screen.getByText("Compose new")).toBeInTheDocument();
		expect(screen.getByText("Search")).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", async () => {
		const onClose = vi.fn();
		render(<ShortcutsHelp onClose={onClose} />);

		const closeBtn = screen.getByTitle("Close");
		await userEvent.click(closeBtn);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when clicking the backdrop", () => {
		const onClose = vi.fn();
		render(<ShortcutsHelp onClose={onClose} />);
		const backdrop = screen.getByRole("dialog");
		fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("does not call onClose when clicking inside the modal content", () => {
		const onClose = vi.fn();
		render(<ShortcutsHelp onClose={onClose} />);
		fireEvent.click(screen.getByText("Keyboard Shortcuts"));
		expect(onClose).not.toHaveBeenCalled();
	});
});
