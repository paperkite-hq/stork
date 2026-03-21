import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../Settings";

// Mock the api module
vi.mock("../../api", () => ({
	api: {
		accounts: {
			list: vi
				.fn()
				.mockResolvedValue([
					{ id: 1, name: "Work Email", email: "work@example.com", imap_host: "imap.example.com" },
				]),
			get: vi.fn().mockResolvedValue({
				id: 1,
				name: "Work Email",
				email: "work@example.com",
				imap_host: "imap.example.com",
				imap_port: 993,
				imap_tls: 1,
				imap_user: "work@example.com",
				smtp_host: "smtp.example.com",
				smtp_port: 587,
				smtp_tls: 1,
				smtp_user: "work@example.com",
				sync_delete_from_server: 0,
			}),
			create: vi.fn().mockResolvedValue({ id: 2 }),
			update: vi.fn().mockResolvedValue({ ok: true }),
			delete: vi.fn().mockResolvedValue({ ok: true }),
			syncStatus: vi.fn().mockResolvedValue([
				{
					id: 1,
					name: "Inbox",
					path: "INBOX",
					message_count: 42,
					unread_count: 5,
					last_synced_at: new Date().toISOString(),
					last_uid: 100,
				},
			]),
		},
	},
}));

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
	};
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("Settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("renders settings dialog with title", () => {
		render(<Settings onClose={vi.fn()} />);
		expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
	});

	it("shows Accounts and General tabs", () => {
		render(<Settings onClose={vi.fn()} />);
		expect(screen.getByText("Accounts")).toBeInTheDocument();
		expect(screen.getByText("General")).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", async () => {
		const onClose = vi.fn();
		render(<Settings onClose={onClose} />);
		await userEvent.click(screen.getByTitle("Close"));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when Escape key is pressed", async () => {
		const onClose = vi.fn();
		render(<Settings onClose={onClose} />);
		await userEvent.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when clicking the backdrop", async () => {
		const onClose = vi.fn();
		render(<Settings onClose={onClose} />);
		const backdrop = screen.getByRole("dialog");
		fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("shows account list after loading", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Work Email")).toBeInTheDocument();
		});
		expect(screen.getByText(/work@example\.com/)).toBeInTheDocument();
	});

	it("shows Add Account button", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
	});

	it("shows Edit and Delete buttons for accounts", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Edit")).toBeInTheDocument();
		});
		expect(screen.getByText("Delete")).toBeInTheDocument();
	});

	it("shows Sync Status button for accounts", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Sync Status")).toBeInTheDocument();
		});
	});

	it("switches to General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		expect(screen.getByText("General Settings")).toBeInTheDocument();
		expect(screen.getByText("Theme")).toBeInTheDocument();
		expect(screen.getByText("Messages per page")).toBeInTheDocument();
	});

	it("shows keyboard shortcuts in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		expect(screen.getByText("Navigate messages")).toBeInTheDocument();
		expect(screen.getByText("Compose new message")).toBeInTheDocument();
	});

	it("shows theme select with options", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const themeSelect = screen.getByDisplayValue("System Default");
		expect(themeSelect).toBeInTheDocument();
	});

	it("shows notification checkbox in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		expect(screen.getByText("Enable desktop notifications for new mail")).toBeInTheDocument();
	});

	it("shows Save Preferences button in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		expect(screen.getByText("Save Preferences")).toBeInTheDocument();
	});

	it("shows account form when Add Account is clicked", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Account"));
		expect(screen.getByText("Cancel")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument();
	});

	it("shows no accounts message when account list is empty", async () => {
		const { api } = await import("../../api");
		(api.accounts.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(
				screen.getByText("No accounts configured. Add one to get started."),
			).toBeInTheDocument();
		});
	});

	// --- Additional coverage tests ---

	it("shows sync status panel when Sync Status is clicked", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Sync Status")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("Folder")).toBeInTheDocument();
			expect(screen.getByText("Messages")).toBeInTheDocument();
			expect(screen.getByText("Unread")).toBeInTheDocument();
		});
		// Folder data should appear
		expect(screen.getByText("Inbox")).toBeInTheDocument();
		expect(screen.getByText("42")).toBeInTheDocument();
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("toggles sync status panel off on second click", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Sync Status")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("Folder")).toBeInTheDocument();
		});
		// Click again to toggle off
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.queryByText("Folder")).not.toBeInTheDocument();
		});
	});

	it("shows empty sync status message when no folders synced", async () => {
		const { api } = await import("../../api");
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Sync Status")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("No folders synced yet")).toBeInTheDocument();
		});
	});

	it("opens edit form when Edit is clicked", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Edit")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Edit"));
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Edit Account" })).toBeInTheDocument();
		});
		// Form should be pre-filled with existing account data
		expect(screen.getByDisplayValue("Work Email")).toBeInTheDocument();
		// work@example.com appears in multiple fields — use getAllByDisplayValue
		expect(screen.getAllByDisplayValue("work@example.com").length).toBeGreaterThanOrEqual(1);
	});

	it("submits edit form and refreshes account list", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Edit")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Edit"));
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Edit Account" })).toBeInTheDocument();
		});
		// Click Save Changes
		await userEvent.click(screen.getByText("Save Changes"));
		await waitFor(() => {
			expect(api.accounts.update).toHaveBeenCalled();
		});
	});

	it("cancels edit form", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Edit")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Edit"));
		await waitFor(() => {
			expect(screen.getByText("Cancel")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Cancel"));
		await waitFor(() => {
			expect(screen.queryByRole("heading", { name: "Edit Account" })).not.toBeInTheDocument();
		});
	});

	it("shows add account form with correct fields", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument();
		});
		// Check all form fields render
		expect(screen.getByPlaceholderText("Work Email")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("imap.example.com")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("smtp.example.com")).toBeInTheDocument();
		expect(screen.getByText("Incoming Mail (IMAP)")).toBeInTheDocument();
		expect(screen.getByText("Outgoing Mail (SMTP)")).toBeInTheDocument();
		expect(screen.getByText("Sync Preferences")).toBeInTheDocument();
		expect(screen.getByText(/Sync deletions from server/)).toBeInTheDocument();
	});

	it("shows delete confirmation dialog and deletes account", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Delete")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Delete"));
		// Confirm dialog should appear
		await waitFor(() => {
			expect(screen.getByText("Delete account")).toBeInTheDocument();
			expect(screen.getByText(/Delete "Work Email"/)).toBeInTheDocument();
		});
		// Click Delete Account
		await userEvent.click(screen.getByText("Delete Account"));
		await waitFor(() => {
			expect(api.accounts.delete).toHaveBeenCalledWith(1);
		});
	});

	it("cancels delete confirmation", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Delete")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Delete"));
		await waitFor(() => {
			expect(screen.getByText("Delete account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByText("Delete account")).not.toBeInTheDocument();
		});
		expect(api.accounts.delete).not.toHaveBeenCalled();
	});

	it("saves dark theme preference", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const themeSelect = screen.getByDisplayValue("System Default");
		await userEvent.selectOptions(themeSelect, "dark");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-dark-mode", "true");
	});

	it("saves light theme preference", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const themeSelect = screen.getByDisplayValue("System Default");
		await userEvent.selectOptions(themeSelect, "light");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-dark-mode", "false");
	});

	it("saves system theme preference (removes key)", async () => {
		localStorageMock.setItem("stork-dark-mode", "true");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const themeSelect = screen.getByDisplayValue("Dark");
		await userEvent.selectOptions(themeSelect, "system");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.removeItem).toHaveBeenCalledWith("stork-dark-mode");
	});

	it("saves messages per page preference", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const pageSelect = screen.getByDisplayValue("50");
		await userEvent.selectOptions(pageSelect, "100");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-messages-per-page", "100");
	});

	it("saves notification toggle", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const checkbox = screen.getByRole("checkbox", {
			name: /Enable desktop notifications/,
		});
		await userEvent.click(checkbox); // toggle off
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-notifications", "false");
	});

	it("loads stored theme preference on mount", async () => {
		localStorageMock.setItem("stork-dark-mode", "false");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		expect(screen.getByDisplayValue("Light")).toBeInTheDocument();
	});

	it("shows Loading state when editing account data is loading", async () => {
		const { api } = await import("../../api");
		let resolveGet: (v: unknown) => void = () => {};
		(api.accounts.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((r) => {
				resolveGet = r;
			}),
		);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Edit")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Edit"));
		expect(screen.getByText("Loading...")).toBeInTheDocument();
		// Resolve to clean up
		resolveGet?.({
			id: 1,
			name: "Work Email",
			email: "work@example.com",
			imap_host: "imap.example.com",
			imap_port: 993,
			imap_tls: 1,
			imap_user: "work@example.com",
			smtp_host: null,
			smtp_port: 587,
			smtp_tls: 1,
			smtp_user: null,
			sync_delete_from_server: 0,
		});
	});

	it("shows TLS checkboxes in add account form", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Account"));
		const tlsCheckboxes = screen.getAllByRole("checkbox");
		// Should have at least IMAP TLS, SMTP TLS, and Sync deletions
		expect(tlsCheckboxes.length).toBeGreaterThanOrEqual(3);
		// IMAP TLS should be checked by default
		const imapTls = tlsCheckboxes.find((cb) =>
			cb.closest("label")?.textContent?.includes("Use TLS"),
		);
		expect(imapTls).toBeChecked();
	});

	it("changes messages per page selection", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByText("General"));
		const pageSelect = screen.getByDisplayValue("50");
		await userEvent.selectOptions(pageSelect, "25");
		expect((pageSelect as HTMLSelectElement).value).toBe("25");
	});

	it("shows formatRelative outputs for sync status times", async () => {
		const { api } = await import("../../api");
		const now = new Date();
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 10,
				unread_count: 1,
				last_synced_at: new Date(now.getTime() - 30000).toISOString(), // 30s ago
				last_uid: 50,
			},
			{
				id: 2,
				name: "Sent",
				path: "Sent",
				message_count: 5,
				unread_count: 0,
				last_synced_at: null, // Never synced
				last_uid: null,
			},
		]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Sync Status")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("Just now")).toBeInTheDocument();
			expect(screen.getByText("Never")).toBeInTheDocument();
		});
	});
});
