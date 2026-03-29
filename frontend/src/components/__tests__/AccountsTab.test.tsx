import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsTab } from "../settings/AccountsTab";

vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		accounts: {
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
	accounts: {
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

const mockAccounts = [
	{ id: 1, name: "Work", email: "work@example.com", imap_host: "imap.example.com" },
	{ id: 2, name: "Personal", email: "me@example.com", imap_host: null },
];

describe("AccountsTab", () => {
	const onEdit = vi.fn();
	const onRefetch = vi.fn();
	const onShowSync = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.accounts.syncStatus.mockResolvedValue([]);
	});

	it("shows empty state when no accounts and not adding", () => {
		render(
			<AccountsTab
				accounts={[]}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		expect(screen.getByText(/No accounts configured/i)).toBeInTheDocument();
	});

	it("renders account list", () => {
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		expect(screen.getByText("Work")).toBeInTheDocument();
		expect(screen.getByText("Personal")).toBeInTheDocument();
	});

	it("calls onEdit('new') when Add Account button clicked", () => {
		render(
			<AccountsTab
				accounts={[]}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		fireEvent.click(screen.getByText("+ Add Account"));
		expect(onEdit).toHaveBeenCalledWith("new");
	});

	it("renders AccountForm when editingAccountId is 'new'", async () => {
		render(
			<AccountsTab
				accounts={[]}
				editingAccountId="new"
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: /Add Account/i })).toBeInTheDocument(),
		);
	});

	it("renders AccountForm inline when editing an existing account", async () => {
		mockApi.accounts.get.mockResolvedValue({
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
				accounts={mockAccounts}
				editingAccountId={1}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		// Other account should still show as card
		expect(screen.getByText("Personal")).toBeInTheDocument();
		// The editing account renders as form (edit heading loaded async)
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: /Edit Account/i })).toBeInTheDocument(),
		);
	});

	it("shows delete confirm dialog and calls api.accounts.delete on confirm", async () => {
		mockApi.accounts.delete.mockResolvedValue({ ok: true });
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		// Confirm button uses confirmLabel prop
		const confirmButton = screen.getByRole("button", { name: "Delete Account" });
		expect(confirmButton).toBeInTheDocument();
		fireEvent.click(confirmButton);
		await waitFor(() => expect(mockApi.accounts.delete).toHaveBeenCalledWith(1));
		await waitFor(() => expect(onRefetch).toHaveBeenCalled());
	});

	it("cancels delete confirm dialog", () => {
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		expect(screen.getByRole("heading", { name: /Delete account/i })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(screen.queryByRole("heading", { name: /Delete account/i })).not.toBeInTheDocument();
	});

	it("calls onEdit with account id when Edit button clicked", () => {
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
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
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstSync] = screen.getAllByText("Sync Status");
		if (firstSync) fireEvent.click(firstSync);
		expect(onShowSync).toHaveBeenCalledWith(1);
	});

	it("calls onShowSync(null) when Sync Status clicked for already-shown account", () => {
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={1}
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
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
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
		mockApi.accounts.delete.mockRejectedValue(new Error("Server error"));
		render(
			<AccountsTab
				accounts={mockAccounts}
				editingAccountId={null}
				onEdit={onEdit}
				onRefetch={onRefetch}
				syncStatusAccountId={null}
				onShowSync={onShowSync}
			/>,
		);
		const [firstDelete] = screen.getAllByText("Delete");
		if (firstDelete) fireEvent.click(firstDelete);
		fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));
		await waitFor(() =>
			expect(mockToast).toHaveBeenCalledWith("Failed to delete account", "error"),
		);
	});
});
