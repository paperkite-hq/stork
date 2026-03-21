import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog";

const defaultProps = {
	title: "Delete Message",
	message: "Are you sure you want to delete this message?",
	onConfirm: vi.fn(),
	onCancel: vi.fn(),
};

describe("ConfirmDialog", () => {
	it("renders title and message", () => {
		render(<ConfirmDialog {...defaultProps} />);
		expect(screen.getByText("Delete Message")).toBeInTheDocument();
		expect(screen.getByText("Are you sure you want to delete this message?")).toBeInTheDocument();
	});

	it("renders default button labels", () => {
		render(<ConfirmDialog {...defaultProps} />);
		expect(screen.getByText("Cancel")).toBeInTheDocument();
		expect(screen.getByText("Confirm")).toBeInTheDocument();
	});

	it("renders custom button labels", () => {
		render(
			<ConfirmDialog {...defaultProps} confirmLabel="Yes, delete" cancelLabel="No, keep it" />,
		);
		expect(screen.getByText("No, keep it")).toBeInTheDocument();
		expect(screen.getByText("Yes, delete")).toBeInTheDocument();
	});

	it("calls onConfirm when confirm button is clicked", async () => {
		const onConfirm = vi.fn();
		render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
		await userEvent.click(screen.getByText("Confirm"));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("calls onCancel when cancel button is clicked", async () => {
		const onCancel = vi.fn();
		render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
		await userEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("has dialog role and aria-modal", () => {
		render(<ConfirmDialog {...defaultProps} />);
		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeInTheDocument();
		expect(dialog).toHaveAttribute("aria-modal", "true");
	});

	it("applies danger variant styling to confirm button", () => {
		render(<ConfirmDialog {...defaultProps} variant="danger" />);
		const confirmBtn = screen.getByText("Confirm");
		expect(confirmBtn.className).toContain("bg-red-600");
	});

	it("applies default variant styling to confirm button", () => {
		render(<ConfirmDialog {...defaultProps} variant="default" />);
		const confirmBtn = screen.getByText("Confirm");
		expect(confirmBtn.className).toContain("bg-stork-600");
	});

	it("auto-focuses the cancel button", () => {
		render(<ConfirmDialog {...defaultProps} />);
		expect(screen.getByText("Cancel")).toHaveFocus();
	});

	it("calls onCancel when Escape key is pressed", () => {
		const onCancel = vi.fn();
		render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
		const dialog = screen.getByRole("dialog");
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("does not call onCancel for non-Escape keys", () => {
		const onCancel = vi.fn();
		render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
		const dialog = screen.getByRole("dialog");
		fireEvent.keyDown(dialog, { key: "Enter" });
		expect(onCancel).not.toHaveBeenCalled();
	});
});
