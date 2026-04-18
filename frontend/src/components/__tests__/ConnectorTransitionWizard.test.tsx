import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorTransitionWizard } from "../settings/ConnectorTransitionWizard";

vi.mock("../../api", () => ({
	api: {
		connectors: {
			inbound: {
				syncedCount: vi.fn(),
			},
		},
	},
}));

import { api } from "../../api";

const mockApi = api as unknown as {
	connectors: { inbound: { syncedCount: ReturnType<typeof vi.fn> } };
};

const defaultProps = {
	connectorId: 42,
	connectorName: "Work IMAP",
	onConfirm: vi.fn(),
	onCancel: vi.fn(),
};

describe("ConnectorTransitionWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
	});

	it("renders the explain step first with dialog role", async () => {
		render(<ConnectorTransitionWizard {...defaultProps} />);
		expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
		expect(screen.getByText("Switch to Connector Mode")).toBeInTheDocument();
		expect(screen.getByText("What changes?")).toBeInTheDocument();
		// Cancel button shows on first step (no back)
		expect(screen.getByText("Cancel")).toBeInTheDocument();
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalledWith(42));
	});

	it("fetches synced count on mount using the provided connectorId", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 1234 });
		render(<ConnectorTransitionWizard {...defaultProps} connectorId={99} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalledWith(99));
	});

	it("treats failed syncedCount fetch as zero (skips clean step)", async () => {
		mockApi.connectors.inbound.syncedCount.mockRejectedValue(new Error("boom"));
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		// Skips clean step and goes straight to confirm
		expect(screen.getByText("Confirm Transition")).toBeInTheDocument();
	});

	it("calls onCancel when Cancel button is clicked on the first step", async () => {
		const onCancel = vi.fn();
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} onCancel={onCancel} />);
		await user.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("calls onCancel when Escape key is pressed", async () => {
		const onCancel = vi.fn();
		render(<ConnectorTransitionWizard {...defaultProps} onCancel={onCancel} />);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("does not call onCancel for non-Escape keys", () => {
		const onCancel = vi.fn();
		render(<ConnectorTransitionWizard {...defaultProps} onCancel={onCancel} />);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("skips the clean step when there are zero synced messages", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("Confirm Transition")).toBeInTheDocument();
		expect(screen.queryByText("Clean Your Server?")).not.toBeInTheDocument();
	});

	it("shows the clean step when there are synced messages on the server", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 250 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("Clean Your Server?")).toBeInTheDocument();
		expect(screen.getByText("250")).toBeInTheDocument();
	});

	it("formats synced count with thousands separator", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 12345 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("12,345")).toBeInTheDocument();
	});

	it("uses singular message wording when exactly one message is synced", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 1 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		// Text is split across multiple nodes; assert the paragraph textContent
		const matches = screen.getAllByText((_, el) => {
			const t = el?.textContent ?? "";
			return t.includes("1 message already synced that is still on your mail server");
		});
		expect(matches.length).toBeGreaterThan(0);
	});

	it("Back from the clean step returns to the explain step", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 10 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("Clean Your Server?")).toBeInTheDocument();
		await user.click(screen.getByText("Back"));
		expect(screen.getByText("Switch to Connector Mode")).toBeInTheDocument();
	});

	it("toggles between keep-on-server and remove-from-server choices", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 10 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));

		const keepRadio = screen.getByRole("radio", { name: /Keep them on the server/ });
		const removeRadio = screen.getByRole("radio", { name: /Remove them from the server/ });

		expect(keepRadio).toBeChecked();
		expect(removeRadio).not.toBeChecked();

		await user.click(removeRadio);
		expect(removeRadio).toBeChecked();
		expect(keepRadio).not.toBeChecked();
	});

	it("shows connector name and mode on the confirm step", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} connectorName="Personal Gmail" />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("Personal Gmail")).toBeInTheDocument();
		expect(screen.getByText("Mirror \u2192 Connector")).toBeInTheDocument();
	});

	it("confirm step hides the existing-message row when count is zero", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		expect(screen.queryByText(/Existing /)).not.toBeInTheDocument();
	});

	it("confirm step shows 'Keep on server' summary when user kept default", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 50 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next")); // -> clean
		await user.click(screen.getByText("Next")); // -> confirm
		expect(screen.getByText("Keep on server")).toBeInTheDocument();
	});

	it("confirm step shows 'Remove from server' summary when user selected that option", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 50 });
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		await user.click(screen.getByRole("radio", { name: /Remove them from the server/ }));
		await user.click(screen.getByText("Next"));
		expect(screen.getByText("Remove from server")).toBeInTheDocument();
	});

	it("calls onConfirm(false) when the user accepts with keep-server default", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
		const onConfirm = vi.fn();
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} onConfirm={onConfirm} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		await user.click(screen.getByText("Enable Connector Mode"));
		expect(onConfirm).toHaveBeenCalledWith(false);
	});

	it("calls onConfirm(true) when the user chose to remove from server", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 5 });
		const onConfirm = vi.fn();
		const user = userEvent.setup();
		render(<ConnectorTransitionWizard {...defaultProps} onConfirm={onConfirm} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		await user.click(screen.getByText("Next"));
		await user.click(screen.getByRole("radio", { name: /Remove them from the server/ }));
		await user.click(screen.getByText("Next"));
		await user.click(screen.getByText("Enable Connector Mode"));
		expect(onConfirm).toHaveBeenCalledWith(true);
	});

	it("shows all three step indicators when synced count > 0", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 3 });
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		// Three numbered indicators: 1, 2, 3 — but "1" is hidden by a checkmark once past; check that "3" is visible
		expect(screen.getByText("3")).toBeInTheDocument();
	});

	it("shows only two step indicators when synced count is zero", async () => {
		mockApi.connectors.inbound.syncedCount.mockResolvedValue({ count: 0 });
		render(<ConnectorTransitionWizard {...defaultProps} />);
		await waitFor(() => expect(mockApi.connectors.inbound.syncedCount).toHaveBeenCalled());
		// "2" appears (the confirm step), "3" should not
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.queryByText("3")).not.toBeInTheDocument();
	});
});
