import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsTab } from "../settings/AccountsTab";

vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		identities: {
			delete: vi.fn(),
			get: vi.fn(),
			syncStatus: vi.fn().mockResolvedValue([]),
		},
		connectors: {
			inbound: { list: vi.fn().mockResolvedValue([]) },
			outbound: { list: vi.fn().mockResolvedValue([]) },
		},
		trustedSenders: {
			list: vi.fn().mockResolvedValue([]),
		},
	},
}));

import { api } from "../../api";
import { toast } from "../Toast";
const mockApi = api as unknown as {
	identities: {
		delete: ReturnType<typeof vi.fn>;
		get: ReturnType<typeof vi.fn>;
		syncStatus: ReturnType<typeof vi.fn>;
	};
	connectors: {
		inbound: { list: ReturnType<typeof vi.fn> };
		outbound: { list: ReturnType<typeof vi.fn> };
	};
	trustedSenders: { list: ReturnType<typeof vi.fn> };
};
const mockToast = toast as ReturnType<typeof vi.fn>;

const mockIdentities = [
	{ id: 1, name: "Work", email: "work@example.com" },
	{ id: 2, name: "Personal", email: "me@example.com" },
];

describe("AccountsTab", () => {
	const onEdit = vi.fn();
	const onRefetch = vi.fn();
	const onShowSync = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.identities.syncStatus.mockResolvedValue([]);
	});

	it("shows empty state when no identities and not adding", () => {
		render(
			<AccountsTab
				identities={[]}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		expect(screen.getByText(/No email identities configured/i)).toBeInTheDocument();
	});

	it("renders identity list", () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		expect(screen.getByText("Work")).toBeInTheDocument();
		expect(screen.getByText("Personal")).toBeInTheDocument();
	});

	it("calls onEdit('new') when Add Identity button clicked", () => {
		render(
			<AccountsTab
				identities={[]}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		fireEvent.click(screen.getByText("+ Add Email Identity"));
		expect(onEdit).toHaveBeenCalledWith("new");
	});

	it("renders IdentityForm when editingIdentityId is 'new'", async () => {
		render(
			<AccountsTab
				identities={[]}
				editingIdentityId="new"
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: /Add Email Identity/i })).toBeInTheDocument(),
		);
	});

	it("renders IdentityForm inline when editing an existing identity", async () => {
		mockApi.identities.get.mockResolvedValue({
			id: 1,
			name: "Work",
			email: "work@example.com",
			inbound_connector_id: null,
			outbound_connector_id: null,
			sync_delete_from_server: 0,
			default_view: "inbox",
		});
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={1}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		// Other identity should still show as card
		expect(screen.getByText("Personal")).toBeInTheDocument();
		// The editing identity renders as form (edit heading loaded async)
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: /Edit Email Identity/i })).toBeInTheDocument(),
		);
	});

	it("shows delete confirm dialog and calls api.identities.delete on confirm", async () => {
		mockApi.identities.delete.mockResolvedValue({ ok: true });
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		// Confirm button uses confirmLabel prop — scope to dialog to avoid ambiguity
		const dialog = screen.getByRole("dialog");
		const confirmButton = within(dialog).getByRole("button", { name: "Delete" });
		expect(confirmButton).toBeInTheDocument();
		fireEvent.click(confirmButton);
		await waitFor(() => expect(mockApi.identities.delete).toHaveBeenCalledWith(1));
		await waitFor(() => expect(onRefetch).toHaveBeenCalled());
	});

	it("cancels delete confirm dialog", () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		expect(screen.getByRole("heading", { name: /Delete email identity/i })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(
			screen.queryByRole("heading", { name: /Delete email identity/i }),
		).not.toBeInTheDocument();
	});

	it("calls onEdit with identity id when Edit button clicked", () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstEdit] = screen.getAllByText("Edit");
		if (firstEdit) fireEvent.click(firstEdit);
		expect(onEdit).toHaveBeenCalledWith(1);
	});

	it("calls onShowSync when Sync Status button clicked", () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstSync] = screen.getAllByText("Sync Status");
		if (firstSync) fireEvent.click(firstSync);
		expect(onShowSync).toHaveBeenCalledWith(1);
	});

	it("calls onShowSync(null) when Sync Status clicked for already-shown identity", () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={1}
				onShowSync={onShowSync}
			/>,
		);
		const [firstSync] = screen.getAllByText("Sync Status");
		if (firstSync) fireEvent.click(firstSync);
		expect(onShowSync).toHaveBeenCalledWith(null);
	});

	it("toggles trusted senders panel on button click", async () => {
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstTs] = screen.getAllByTitle("Manage senders whose remote images are always loaded");
		if (firstTs) fireEvent.click(firstTs);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /close trusted senders/i })).toBeInTheDocument(),
		);
	});

	it("shows error toast when delete fails", async () => {
		mockApi.identities.delete.mockRejectedValue(new Error("Server error"));
		render(
			<AccountsTab
				identities={mockIdentities}
				editingIdentityId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusIdentityId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		const dialog = screen.getByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(mockToast).toHaveBeenCalledWith("Failed to delete email identity", "error"),
		);
	});
});
