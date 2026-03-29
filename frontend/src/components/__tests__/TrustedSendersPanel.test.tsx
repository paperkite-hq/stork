import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrustedSendersPanel } from "../settings/TrustedSendersPanel";

vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		trustedSenders: {
			list: vi.fn(),
			remove: vi.fn(),
		},
	},
}));

import { api } from "../../api";
import { toast } from "../Toast";
const mockApi = api as unknown as {
	trustedSenders: {
		list: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
	};
};
const mockToast = toast as ReturnType<typeof vi.fn>;

const mockSenders = [
	{ id: 1, sender_address: "alice@example.com" },
	{ id: 2, sender_address: "bob@example.com" },
];

describe("TrustedSendersPanel", () => {
	const onClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows loading state while fetching", () => {
		mockApi.trustedSenders.list.mockReturnValue(new Promise(() => {}));
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		expect(screen.getByText("Loading…")).toBeInTheDocument();
	});

	it("shows empty state when no trusted senders", async () => {
		mockApi.trustedSenders.list.mockResolvedValue([]);
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText(/No trusted senders yet/i)).toBeInTheDocument());
	});

	it("renders list of trusted senders", async () => {
		mockApi.trustedSenders.list.mockResolvedValue(mockSenders);
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
		expect(screen.getByText("bob@example.com")).toBeInTheDocument();
	});

	it("calls onClose when Close button clicked", async () => {
		mockApi.trustedSenders.list.mockResolvedValue([]);
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: /close trusted senders/i }));
		expect(onClose).toHaveBeenCalled();
	});

	it("shows confirm dialog when Remove button clicked", async () => {
		mockApi.trustedSenders.list.mockResolvedValue(mockSenders);
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: /remove alice@example\.com/i }));
		expect(screen.getByText(/Remove trusted sender/i)).toBeInTheDocument();
	});

	it("removes sender on confirm", async () => {
		mockApi.trustedSenders.list.mockResolvedValue(mockSenders);
		mockApi.trustedSenders.remove.mockResolvedValue({ ok: true });
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: /remove alice@example\.com/i }));
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		await waitFor(() =>
			expect(mockApi.trustedSenders.remove).toHaveBeenCalledWith(1, "alice@example.com"),
		);
		await waitFor(() =>
			expect(mockToast).toHaveBeenCalledWith(
				"Removed alice@example.com from trusted senders",
				"success",
			),
		);
	});

	it("shows error toast when remove fails", async () => {
		mockApi.trustedSenders.list.mockResolvedValue(mockSenders);
		mockApi.trustedSenders.remove.mockRejectedValue(new Error("fail"));
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: /remove alice@example\.com/i }));
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		await waitFor(() =>
			expect(mockToast).toHaveBeenCalledWith("Failed to remove trusted sender", "error"),
		);
	});

	it("cancels remove dialog without deleting", async () => {
		mockApi.trustedSenders.list.mockResolvedValue(mockSenders);
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: /remove alice@example\.com/i }));
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(mockApi.trustedSenders.remove).not.toHaveBeenCalled();
		expect(screen.queryByText(/Remove trusted sender/i)).not.toBeInTheDocument();
	});

	it("silently handles list fetch error", async () => {
		mockApi.trustedSenders.list.mockRejectedValue(new Error("network error"));
		render(<TrustedSendersPanel accountId={1} onClose={onClose} />);
		await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
		// Should show empty state (no crash)
		expect(screen.getByText(/No trusted senders yet/i)).toBeInTheDocument();
	});
});
