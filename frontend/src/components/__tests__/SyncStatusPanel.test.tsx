import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusPanel } from "../settings/SyncStatusPanel";

vi.mock("../../api", () => ({
	api: {
		connectors: {
			inbound: {
				folders: vi.fn(),
			},
		},
	},
}));

import { api } from "../../api";

const mockApi = api as unknown as {
	connectors: { inbound: { folders: ReturnType<typeof vi.fn> } };
};

describe("SyncStatusPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows loading state while fetching", async () => {
		mockApi.connectors.inbound.folders.mockReturnValue(new Promise(() => {}));
		render(<SyncStatusPanel connectorId={1} />);
		expect(screen.getByText("Loading sync status...")).toBeInTheDocument();
	});

	it("renders folder rows with message counts and relative time", async () => {
		const pastDate = new Date(Date.now() - 3_600_000).toISOString(); // 1h ago
		mockApi.connectors.inbound.folders.mockResolvedValue([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 42,
				unread_count: 5,
				last_synced_at: pastDate,
				last_uid: 100,
			},
		]);
		render(<SyncStatusPanel connectorId={1} />);
		await waitFor(() => expect(screen.getByText("Inbox")).toBeInTheDocument());
		expect(screen.getByText("42")).toBeInTheDocument();
		expect(screen.getByText("5")).toBeInTheDocument();
		// Relative time should show "1h ago" (or similar, not "Never")
		expect(screen.queryByText("Never")).not.toBeInTheDocument();
	});

	it("shows Never when last_synced_at is null", async () => {
		mockApi.connectors.inbound.folders.mockResolvedValue([
			{
				id: 2,
				name: "Sent",
				path: "Sent",
				message_count: 10,
				unread_count: 0,
				last_synced_at: null,
				last_uid: null,
			},
		]);
		render(<SyncStatusPanel connectorId={1} />);
		await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
		expect(screen.getByText("Never")).toBeInTheDocument();
	});

	it("shows empty-state message when no folders are synced yet", async () => {
		mockApi.connectors.inbound.folders.mockResolvedValue([]);
		render(<SyncStatusPanel connectorId={1} />);
		await waitFor(() => expect(screen.getByText("No folders synced yet")).toBeInTheDocument());
	});

	it("shows empty-state message when folders is null (API returns null)", async () => {
		// Exercises the null-coalescing branch
		mockApi.connectors.inbound.folders.mockResolvedValue(null);
		render(<SyncStatusPanel connectorId={1} />);
		await waitFor(() => expect(screen.getByText("No folders synced yet")).toBeInTheDocument());
	});
});
