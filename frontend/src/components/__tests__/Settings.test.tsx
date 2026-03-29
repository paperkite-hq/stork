import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../Settings";

// Mock the api module
vi.mock("../../api", () => ({
	api: {
		testSmtp: vi.fn().mockResolvedValue({ ok: true }),
		connectors: {
			inbound: {
				list: vi.fn().mockResolvedValue([
					{
						id: 1,
						name: "My IMAP",
						type: "imap",
						imap_host: "imap.example.com",
						imap_user: "work@example.com",
					},
				]),
				get: vi.fn(),
				create: vi.fn().mockResolvedValue({ id: 1 }),
				update: vi.fn().mockResolvedValue({ ok: true }),
				delete: vi.fn().mockResolvedValue({ ok: true }),
				test: vi.fn().mockResolvedValue({ ok: true, mailboxes: 3 }),
			},
			outbound: {
				list: vi.fn().mockResolvedValue([]),
				get: vi.fn(),
				create: vi.fn().mockResolvedValue({ id: 1 }),
				update: vi.fn().mockResolvedValue({ ok: true }),
				delete: vi.fn().mockResolvedValue({ ok: true }),
				test: vi.fn().mockResolvedValue({ ok: true }),
			},
		},
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
				inbound_connector_id: 1,
				outbound_connector_id: null,
				sync_delete_from_server: 0,
				default_view: "inbox",
			}),
			create: vi.fn().mockResolvedValue({ id: 2 }),
			update: vi.fn().mockResolvedValue({ ok: true }),
			delete: vi.fn().mockResolvedValue({ ok: true }),
			testConnection: vi.fn().mockResolvedValue({ ok: true, mailboxes: 5 }),
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
		encryption: {
			changePassword: vi.fn().mockResolvedValue({ ok: true }),
			rotateRecoveryKey: vi.fn().mockResolvedValue({
				recoveryMnemonic: Array(24).fill("word").join(" "),
				pending: true,
			}),
			confirmRecoveryRotation: vi.fn().mockResolvedValue({ ok: true }),
			cancelRecoveryRotation: vi.fn().mockResolvedValue({ ok: true }),
			recoveryRotationStatus: vi.fn().mockResolvedValue({ pending: false }),
		},
		trustedSenders: {
			list: vi.fn().mockResolvedValue([]),
			add: vi.fn().mockResolvedValue({ id: 1 }),
			remove: vi.fn().mockResolvedValue({ ok: true }),
			check: vi.fn().mockResolvedValue({ trusted: false }),
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
		// Both mobile and desktop tab bars render — use getAllByText
		expect(screen.getAllByText("Accounts").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("General").length).toBeGreaterThanOrEqual(1);
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
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		expect(screen.getByText("General Settings")).toBeInTheDocument();
		expect(screen.getByText("Theme")).toBeInTheDocument();
		expect(screen.getByText("Messages per page")).toBeInTheDocument();
	});

	it("shows keyboard shortcuts in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		expect(screen.getByText("Navigate messages")).toBeInTheDocument();
		expect(screen.getByText("Compose new message")).toBeInTheDocument();
	});

	it("shows theme select with options", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const themeSelect = screen.getByDisplayValue("System Default");
		expect(themeSelect).toBeInTheDocument();
	});

	it("shows notification checkbox in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		expect(screen.getByText("Enable desktop notifications for new mail")).toBeInTheDocument();
	});

	it("shows Save Preferences button in General tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
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
		expect(screen.getByDisplayValue("work@example.com")).toBeInTheDocument();
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
		// Wait for connectors to load so Save Changes button is enabled
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeDisabled(),
		);
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
		expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
		expect(screen.getByText("Inbound Connector")).toBeInTheDocument();
		expect(screen.getByText("Outbound Connector")).toBeInTheDocument();
		expect(screen.getByText("Preferences")).toBeInTheDocument();
	});

	it("shows philosophy intro callout when adding a new account", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() => {
			expect(
				screen.getByText("⚡ Two minutes to understand how Stork thinks about email"),
			).toBeInTheDocument();
		});
		expect(screen.getByText(/your provider is just the delivery edge/i)).toBeInTheDocument();
		// "Mirror mode (default):" appears in the intro box; may also appear in status boxes
		const mirrorRefs = screen.getAllByText(/Mirror mode/i);
		expect(mirrorRefs.length).toBeGreaterThanOrEqual(1);
		const connectorRefs = screen.getAllByText(/Connector mode/i);
		expect(connectorRefs.length).toBeGreaterThanOrEqual(1);
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
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const themeSelect = screen.getByDisplayValue("System Default");
		await userEvent.selectOptions(themeSelect, "dark");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-dark-mode", "true");
	});

	it("saves light theme preference", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const themeSelect = screen.getByDisplayValue("System Default");
		await userEvent.selectOptions(themeSelect, "light");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-dark-mode", "false");
	});

	it("saves system theme preference (removes key)", async () => {
		localStorageMock.setItem("stork-dark-mode", "true");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const themeSelect = screen.getByDisplayValue("Dark");
		await userEvent.selectOptions(themeSelect, "system");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.removeItem).toHaveBeenCalledWith("stork-dark-mode");
	});

	it("saves messages per page preference", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const pageSelect = screen.getByDisplayValue("50");
		await userEvent.selectOptions(pageSelect, "100");
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-messages-per-page", "100");
	});

	it("saves notification toggle", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		const checkbox = screen.getByRole("checkbox", {
			name: /Enable desktop notifications/,
		});
		await userEvent.click(checkbox); // toggle off
		await userEvent.click(screen.getByText("Save Preferences"));
		expect(localStorageMock.setItem).toHaveBeenCalledWith("stork-notifications", "false");
	});

	it("shows permission-denied warning when notifications enabled but browser blocked", async () => {
		// Simulate browser permission denied
		const MockNotification = vi.fn();
		Object.assign(MockNotification, {
			permission: "denied",
			requestPermission: vi.fn().mockResolvedValue("denied"),
		});
		const original = global.Notification;
		// @ts-expect-error — mock
		global.Notification = MockNotification;

		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		// Notification is enabled by default (localStorage returns null → "not false")
		expect(screen.getByText(/Browser permission is blocked/)).toBeInTheDocument();

		global.Notification = original;
	});

	it("requests permission when enabling notifications from default state", async () => {
		const MockNotification = vi.fn();
		const requestPermission = vi.fn().mockResolvedValue("granted");
		Object.assign(MockNotification, { permission: "default", requestPermission });
		const original = global.Notification;
		// @ts-expect-error — mock
		global.Notification = MockNotification;

		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);

		// Default state: checkbox is enabled (localStorage not set → defaults to enabled).
		// Turn it off, then back on to trigger the requestPermission path.
		const checkbox = screen.getByRole("checkbox", { name: /Enable desktop notifications/ });
		await userEvent.click(checkbox); // off
		await userEvent.click(checkbox); // on again → should trigger requestPermission
		expect(requestPermission).toHaveBeenCalled();

		global.Notification = original;
	});

	it("loads stored theme preference on mount", async () => {
		localStorageMock.setItem("stork-dark-mode", "false");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
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

	it("does not show Connector mode checkbox in add account form (moved to ConnectorsTab)", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("+ Add Account")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument(),
		);
		const checkboxes = screen.queryAllByRole("checkbox");
		// Connector mode checkbox should NOT be in AccountForm — it moved to ConnectorsTab
		const connectorModeCheckbox = checkboxes.find((cb) =>
			cb.closest("label")?.textContent?.includes("Connector mode"),
		);
		expect(connectorModeCheckbox).toBeUndefined();
	});

	it("changes messages per page selection", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
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

	it("shows minutes-ago format for recent sync times", async () => {
		const { api } = await import("../../api");
		const now = new Date();
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 10,
				unread_count: 1,
				last_synced_at: new Date(now.getTime() - 45 * 60000).toISOString(), // 45 minutes ago
				last_uid: 50,
			},
		]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Sync Status")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("45m ago")).toBeInTheDocument();
		});
	});

	it("shows hours-ago format for sync times within the same day", async () => {
		const { api } = await import("../../api");
		const now = new Date();
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 10,
				unread_count: 1,
				last_synced_at: new Date(now.getTime() - 3 * 3600000).toISOString(), // 3 hours ago
				last_uid: 50,
			},
		]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Sync Status")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("3h ago")).toBeInTheDocument();
		});
	});

	it("shows days-ago format for sync times within the same week", async () => {
		const { api } = await import("../../api");
		const now = new Date();
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 10,
				unread_count: 1,
				last_synced_at: new Date(now.getTime() - 5 * 86400000).toISOString(), // 5 days ago
				last_uid: 50,
			},
		]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Sync Status")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			expect(screen.getByText("5d ago")).toBeInTheDocument();
		});
	});

	it("shows locale date string for sync times older than one week", async () => {
		const { api } = await import("../../api");
		const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
		(api.accounts.syncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				name: "Inbox",
				path: "INBOX",
				message_count: 10,
				unread_count: 1,
				last_synced_at: twoWeeksAgo.toISOString(),
				last_uid: 50,
			},
		]);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Sync Status")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Sync Status"));
		await waitFor(() => {
			// Should show locale date string (e.g. "3/7/2026")
			expect(screen.getByText(twoWeeksAgo.toLocaleDateString())).toBeInTheDocument();
		});
	});

	it("shows Security tab", () => {
		render(<Settings onClose={vi.fn()} />);
		// "Security" appears as tab button text and SVG title — use getAllByText
		expect(screen.getAllByText("Security").length).toBeGreaterThanOrEqual(1);
	});
});

describe("Settings — Security tab", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("shows change password and rotate recovery key sections", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Rotate Recovery Key" })).toBeInTheDocument();
	});

	it("shows validation error when new passwords do not match", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Your current encryption password"),
			"oldpassword123!",
		);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"different12345!",
		);
		await userEvent.click(screen.getByRole("button", { name: /change password/i }));
		expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
	});

	it("shows validation error when new password is too short", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Your current encryption password"),
			"oldpassword123!",
		);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "short");
		await userEvent.type(screen.getByPlaceholderText("Repeat your new password"), "short");
		await userEvent.click(screen.getByRole("button", { name: /change password/i }));
		expect(screen.getByText("New password must be at least 12 characters.")).toBeInTheDocument();
	});

	it("calls changePassword API on valid submit", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Your current encryption password"),
			"oldpassword123!",
		);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"newpassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /change password/i }));
		await waitFor(() =>
			expect(api.encryption.changePassword).toHaveBeenCalledWith(
				"oldpassword123!",
				"newpassword123!",
			),
		);
		expect(screen.getByText("Password changed successfully.")).toBeInTheDocument();
	});

	it("shows API error on change password failure", async () => {
		const { api } = await import("../../api");
		(api.encryption.changePassword as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Current password is incorrect"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Your current encryption password"),
			"wrongpassword!!",
		);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"newpassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /change password/i }));
		await waitFor(() =>
			expect(screen.getByText("Current password is incorrect")).toBeInTheDocument(),
		);
	});

	it("calls rotateRecoveryKey API and shows mnemonic", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() =>
			expect(api.encryption.rotateRecoveryKey).toHaveBeenCalledWith("mypassword123!"),
		);
		expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument();
		// All 24 words are "word" — verify mnemonic grid renders
		expect(screen.getAllByText("word").length).toBe(24);
	});

	it("shows API error on rotate recovery key failure", async () => {
		const { api } = await import("../../api");
		(api.encryption.rotateRecoveryKey as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Incorrect password"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"wrongpassword!!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("Incorrect password")).toBeInTheDocument());
	});

	it("requires acknowledgement checkbox before confirm button works", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument());
		const confirmBtn = screen.getByRole("button", { name: /confirm/i });
		expect(confirmBtn).toBeDisabled();
		await userEvent.click(screen.getByRole("checkbox"));
		expect(confirmBtn).toBeEnabled();
	});

	it("confirming rotation calls API and returns to rotate form", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument());
		// Acknowledge and confirm
		await userEvent.click(screen.getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
		await waitFor(() => expect(api.encryption.confirmRecoveryRotation).toHaveBeenCalled());
		// Should return to rotate recovery key form
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Rotate Recovery Key" })).toBeInTheDocument(),
		);
		expect(screen.queryByText("New Recovery Phrase")).not.toBeInTheDocument();
	});
});

describe("Settings — Account form submission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("submits new account form via form submit event", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("+ Add Account")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument(),
		);
		// Wait for connectors to load (submit button becomes enabled)
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add Account" })).not.toBeDisabled(),
		);
		// Fill identity fields
		await userEvent.type(screen.getByPlaceholderText("Work Email"), "Personal");
		await userEvent.type(screen.getByPlaceholderText("you@example.com"), "me@test.com");
		// Submit the form
		const form = screen.getByRole("heading", { name: "Add Account" }).closest("form");
		if (form) fireEvent.submit(form);
		await waitFor(() => expect(api.accounts.create).toHaveBeenCalled());
	});

	it("stays in loading state when account details fetch fails", async () => {
		const { api } = await import("../../api");
		(api.accounts.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Account not found"),
		);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Edit"));
		// When loadAccount fails, loaded stays false — the form shows "Loading..."
		// but the error was set (even though it's not visible due to the early return)
		await waitFor(() => expect(api.accounts.get).toHaveBeenCalledWith(1));
		// The component stays in the loading state since loaded is never set to true
		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("shows error when update API fails", async () => {
		const { api } = await import("../../api");
		(api.accounts.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Update failed"),
		);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Edit"));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Edit Account" })).toBeInTheDocument(),
		);
		// Wait for connectors to load so Save Changes is enabled
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeDisabled(),
		);
		await userEvent.click(screen.getByText("Save Changes"));
		await waitFor(() => expect(screen.getByText("Update failed")).toBeInTheDocument());
	});

	it("shows error when create API fails", async () => {
		const { api } = await import("../../api");
		(api.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Missing required fields"),
		);
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("+ Add Account")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument(),
		);
		// Wait for connectors to load so the inbound connector is auto-selected
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add Account" })).not.toBeDisabled(),
		);
		// Submit the form directly to bypass HTML5 validation
		const form = screen.getByRole("heading", { name: "Add Account" }).closest("form");
		if (form) fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText("Missing required fields")).toBeInTheDocument());
	});
});

describe("Settings — Security tab recovery rotation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("shows error when confirm rotation API fails", async () => {
		const { api } = await import("../../api");
		(api.encryption.confirmRecoveryRotation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Confirmation failed — wrong password"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
		await waitFor(() =>
			expect(screen.getByText("Confirmation failed — wrong password")).toBeInTheDocument(),
		);
		// Should still show the mnemonic (not dismissed)
		expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument();
	});

	it("cancels rotation and returns to rotate form", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument());
		// Click Cancel
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(api.encryption.cancelRecoveryRotation).toHaveBeenCalled());
		// Should return to rotate form
		expect(screen.getByRole("heading", { name: "Rotate Recovery Key" })).toBeInTheDocument();
		expect(screen.queryByText("New Recovery Phrase")).not.toBeInTheDocument();
	});

	it("shows pending rotation warning on mount", async () => {
		const { api } = await import("../../api");
		(api.encryption.recoveryRotationStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			pending: true,
		});
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await waitFor(() =>
			expect(
				screen.getByText(/A recovery key rotation was started but not confirmed/),
			).toBeInTheDocument(),
		);
	});

	it("cancels pending rotation via inline button", async () => {
		const { api } = await import("../../api");
		(api.encryption.recoveryRotationStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			pending: true,
		});
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		await waitFor(() =>
			expect(screen.getByText("Cancel the pending rotation")).toBeInTheDocument(),
		);
		await userEvent.click(screen.getByText("Cancel the pending rotation"));
		await waitFor(() => expect(api.encryption.cancelRecoveryRotation).toHaveBeenCalled());
		// Warning should disappear
		await waitFor(() =>
			expect(screen.queryByText(/A recovery key rotation was started/)).not.toBeInTheDocument(),
		);
	});
});

describe("Settings — tab navigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("switches between all three tabs", async () => {
		render(<Settings onClose={vi.fn()} />);
		// Start on Accounts tab
		await waitFor(() => expect(screen.getByText("Email Accounts")).toBeInTheDocument());
		// Switch to General
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		expect(screen.getByText("General Settings")).toBeInTheDocument();
		// Switch to Security
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
		// Switch back to Accounts
		await userEvent.click(screen.getAllByText("Accounts")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Email Accounts")).toBeInTheDocument());
	});
});

describe("Settings — TrustedSendersPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("opens trusted senders panel when 'Trusted Senders' button is clicked", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);

		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());

		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() => {
			expect(api.trustedSenders.list).toHaveBeenCalledWith(1);
		});
		// The panel heading is a <h4> with "Trusted Senders"
		expect(screen.getByRole("heading", { name: "Trusted Senders" })).toBeInTheDocument();
	});

	it("shows empty state when no trusted senders", async () => {
		const { api } = await import("../../api");
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() => {
			expect(screen.getByText(/No trusted senders yet/i)).toBeInTheDocument();
		});
	});

	it("lists trusted senders", async () => {
		const { api } = await import("../../api");
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ id: 1, sender_address: "newsletter@example.com", created_at: new Date().toISOString() },
			{ id: 2, sender_address: "updates@company.com", created_at: new Date().toISOString() },
		]);

		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() => {
			expect(screen.getByText("newsletter@example.com")).toBeInTheDocument();
			expect(screen.getByText("updates@company.com")).toBeInTheDocument();
		});
	});

	it("removes a trusted sender after confirmation", async () => {
		const { api } = await import("../../api");
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ id: 1, sender_address: "newsletter@example.com", created_at: new Date().toISOString() },
		]);

		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() => {
			expect(screen.getByText("newsletter@example.com")).toBeInTheDocument();
		});

		// Click Remove
		await userEvent.click(screen.getByRole("button", { name: /Remove newsletter@example.com/i }));

		// Confirm dialog should appear
		expect(screen.getByText(/Remove trusted sender/i)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Remove" }));

		await waitFor(() => {
			expect(api.trustedSenders.remove).toHaveBeenCalledWith(1, "newsletter@example.com");
		});
	});

	it("shows entry remains in list when remove fails", async () => {
		const { api } = await import("../../api");
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ id: 1, sender_address: "bad@example.com", created_at: new Date().toISOString() },
		]);
		(api.trustedSenders.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Server error"),
		);

		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() => {
			expect(screen.getByText("bad@example.com")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByRole("button", { name: /Remove bad@example.com/i }));
		expect(screen.getByText(/Remove trusted sender/i)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Remove" }));

		await waitFor(() => {
			expect(api.trustedSenders.remove).toHaveBeenCalledWith(1, "bad@example.com");
		});
		// Entry should still be in the list (removal failed)
		await waitFor(() => {
			expect(screen.getByText("bad@example.com")).toBeInTheDocument();
		});
	});

	it("closes the panel when 'Close' is clicked", async () => {
		const { api } = await import("../../api");
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle(/Manage senders/i));

		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Trusted Senders" })).toBeInTheDocument(),
		);
		await waitFor(() => expect(screen.getByText(/No trusted senders yet/i)).toBeInTheDocument());

		await userEvent.click(screen.getByRole("button", { name: "Close trusted senders" }));
		expect(screen.queryByText(/No trusted senders yet/i)).not.toBeInTheDocument();
	});
});

describe("Settings — AccountForm field interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function openAddAccountForm() {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("+ Add Account")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Account"));
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument(),
		);
	}

	it("shows default view select in add account form preferences", async () => {
		await openAddAccountForm();
		// The Preferences fieldset should have a default view selector
		expect(screen.getByText("Preferences")).toBeInTheDocument();
		const viewSelect = screen.getByLabelText(/Default view on open/i) as HTMLSelectElement;
		expect(viewSelect).toBeInTheDocument();
		expect(viewSelect.value).toBe("inbox");
	});

	it("switches to General tab via desktop sidebar tab button", async () => {
		// Both mobile and desktop tab bars render; index 0 is mobile, index 1 is desktop.
		// Click the desktop TabButton (second occurrence) to cover those onClick handlers.
		render(<Settings onClose={vi.fn()} />);
		const generalButtons = screen.getAllByText("General");
		// Click the desktop tab button (if multiple exist — mobile appears before desktop)
		const desktopBtn = generalButtons[generalButtons.length - 1] as HTMLElement;
		await userEvent.click(desktopBtn);
		expect(screen.getByText("General Settings")).toBeInTheDocument();
	});

	it("switches to Security tab via desktop sidebar tab button", async () => {
		render(<Settings onClose={vi.fn()} />);
		const securityButtons = screen.getAllByText("Security");
		const desktopBtn = securityButtons[securityButtons.length - 1] as HTMLElement;
		await userEvent.click(desktopBtn);
		// SecurityTab renders the Security section heading
		expect(screen.getAllByText("Change Password").length).toBeGreaterThan(0);
	});
});
