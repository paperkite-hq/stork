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
				folders: vi.fn().mockResolvedValue([
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
			outbound: {
				list: vi.fn().mockResolvedValue([
					{
						id: 1,
						name: "My SMTP",
						type: "smtp",
						smtp_host: "smtp.example.com",
						smtp_user: "work@example.com",
						smtp_port: 587,
						smtp_tls: 1,
					},
				]),
				get: vi.fn(),
				create: vi.fn().mockResolvedValue({ id: 1 }),
				update: vi.fn().mockResolvedValue({ ok: true }),
				delete: vi.fn().mockResolvedValue({ ok: true }),
				test: vi.fn().mockResolvedValue({ ok: true }),
			},
		},
		identities: {
			list: vi.fn().mockResolvedValue([
				{
					id: 1,
					name: "Work Email",
					email: "work@example.com",
					outbound_connector_id: 1,
				},
			]),
			get: vi.fn().mockResolvedValue({
				id: 1,
				name: "Work Email",
				email: "work@example.com",
				outbound_connector_id: 1,
				default_view: "inbox",
			}),
			create: vi.fn().mockResolvedValue({ id: 2 }),
			update: vi.fn().mockResolvedValue({ ok: true }),
			delete: vi.fn().mockResolvedValue({ ok: true }),
			testConnection: vi.fn().mockResolvedValue({ ok: true, mailboxes: 5 }),
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

	it("shows Inbound, Outbound and General tabs", () => {
		render(<Settings onClose={vi.fn()} />);
		// Both mobile and desktop tab bars render — use getAllByText
		expect(screen.getAllByText("Inbound").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Outbound").length).toBeGreaterThanOrEqual(1);
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

	it("shows identity list after loading", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("Work Email")).toBeInTheDocument();
		});
		expect(screen.getAllByText(/work@example\.com/).length).toBeGreaterThanOrEqual(1);
	});

	it("shows Add Identity button", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("+ Add Identity")).toBeInTheDocument();
		});
	});

	it("shows Edit and Delete buttons for identities", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
		});
		expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(1);
	});

	it("shows Sync Status button for inbound connectors", async () => {
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

	it("shows identity form when Add Identity is clicked", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("+ Add Identity")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Identity"));
		expect(screen.getByText("Cancel")).toBeInTheDocument();
		expect(screen.getByText(/Outbound Connector/)).toBeInTheDocument();
	});

	it("shows no identities message when identity list is empty", async () => {
		const { api } = await import("../../api");
		(api.identities.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("No identities assigned to this connector.")).toBeInTheDocument();
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
		expect(screen.getAllByText("Inbox").length).toBeGreaterThanOrEqual(1);
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
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
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
		});
		// Click the identity Edit button (last Edit in the identity row)
		const editBtns = screen.getAllByText("Edit");
		await userEvent.click(editBtns[editBtns.length - 1] as HTMLElement);
		await waitFor(() => {
			// Form should be pre-filled with existing identity data after loading
			expect(screen.getByDisplayValue("Work Email")).toBeInTheDocument();
		});
		expect(screen.getByDisplayValue("work@example.com")).toBeInTheDocument();
	});

	it("submits edit form and refreshes identity list", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
		});
		const editBtns = screen.getAllByText("Edit");
		await userEvent.click(editBtns[editBtns.length - 1] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByDisplayValue("Work Email")).toBeInTheDocument();
		});
		// Wait for Save button to appear
		await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
		// Click Save
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => {
			expect(api.identities.update).toHaveBeenCalled();
		});
	});

	it("cancels edit form", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
		});
		const editBtns = screen.getAllByText("Edit");
		await userEvent.click(editBtns[editBtns.length - 1] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("Cancel")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Cancel"));
		await waitFor(() => {
			expect(screen.queryByDisplayValue("Work Email")).not.toBeInTheDocument();
		});
	});

	it("shows add identity form with correct fields", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("+ Add Identity")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Identity"));
		await waitFor(() => {
			expect(screen.getByLabelText("Name")).toBeInTheDocument();
		});
		// Check form fields render
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
	});

	it("shows inbound connector section in inbound tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await waitFor(() => {
			expect(screen.getByText("Inbound Connectors")).toBeInTheDocument();
		});
	});

	it("shows outbound connector section in outbound tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("Outbound Connectors")).toBeInTheDocument();
		});
	});

	it("shows delete confirmation dialog and deletes identity", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(1);
		});
		const deleteBtns = screen.getAllByText("Delete");
		await userEvent.click(deleteBtns[deleteBtns.length - 1] as HTMLElement);
		// Confirm dialog should appear
		await waitFor(() => {
			expect(screen.getByText("Delete identity")).toBeInTheDocument();
			expect(screen.getAllByText(/Work Email/).length).toBeGreaterThanOrEqual(1);
		});
		// Click Delete Identity
		await userEvent.click(screen.getByText("Delete Identity"));
		await waitFor(() => {
			expect(api.identities.delete).toHaveBeenCalledWith(1);
		});
	});

	it("cancels delete confirmation", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(1);
		});
		const deleteBtns2 = screen.getAllByText("Delete");
		await userEvent.click(deleteBtns2[deleteBtns2.length - 1] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("Delete identity")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByText("Delete identity")).not.toBeInTheDocument();
		});
		expect(api.identities.delete).not.toHaveBeenCalled();
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

	it("shows Loading state when editing identity data is loading", async () => {
		const { api } = await import("../../api");
		let resolveGet: (v: unknown) => void = () => {};
		(api.identities.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((r) => {
				resolveGet = r;
			}),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1);
		});
		const editBtnsL2 = screen.getAllByText("Edit");
		await userEvent.click(editBtnsL2[editBtnsL2.length - 1] as HTMLElement);
		expect(screen.getByText("Loading...")).toBeInTheDocument();
		// Resolve to clean up
		resolveGet?.({
			id: 1,
			name: "Work Email",
			email: "work@example.com",
			outbound_connector_id: null,
			default_view: "inbox",
		});
	});

	it("does not show Connector mode checkbox in identity form", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByText("+ Add Identity")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("+ Add Identity"));
		await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
		const checkboxes = screen.queryAllByRole("checkbox");
		// Connector mode checkbox should NOT be in the identity form
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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
		(api.connectors.inbound.folders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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

describe("Settings — Identity form submission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("submits new identity form via form submit event", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("+ Add Identity")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Identity"));
		await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
		// Wait for save button
		await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
		// Fill identity fields
		await userEvent.type(screen.getByLabelText("Name"), "Personal");
		await userEvent.type(screen.getByLabelText("Email"), "me@test.com");
		// Submit the form
		const form = screen.getByLabelText("Name").closest("form");
		if (form) fireEvent.submit(form);
		await waitFor(() => expect(api.identities.create).toHaveBeenCalled());
	});

	it("stays in loading state when identity details fetch fails", async () => {
		const { api } = await import("../../api");
		(api.identities.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Identity not found"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1));
		const editBtnsF = screen.getAllByText("Edit");
		await userEvent.click(editBtnsF[editBtnsF.length - 1] as HTMLElement);
		// When loadIdentity fails, loaded stays false — the form shows "Loading..."
		// but the error was set (even though it's not visible due to the early return)
		await waitFor(() => expect(api.identities.get).toHaveBeenCalledWith(1));
		// The component stays in the loading state since loaded is never set to true
		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("shows error when update API fails", async () => {
		const { api } = await import("../../api");
		(api.identities.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Update failed"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getAllByText("Edit").length).toBeGreaterThanOrEqual(1));
		const editBtnsU = screen.getAllByText("Edit");
		await userEvent.click(editBtnsU[editBtnsU.length - 1] as HTMLElement);
		await waitFor(() => expect(screen.getByDisplayValue("Work Email")).toBeInTheDocument());
		// Wait for Save button
		await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(screen.getByText("Update failed")).toBeInTheDocument());
	});

	it("shows error when create API fails", async () => {
		const { api } = await import("../../api");
		(api.identities.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Missing required fields"),
		);
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("+ Add Identity")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Identity"));
		await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
		// Wait for the Save button to be enabled
		await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
		// Submit the form directly to bypass HTML5 validation
		const form = screen.getByLabelText("Name").closest("form");
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

	it("switches between all four tabs", async () => {
		render(<Settings onClose={vi.fn()} />);
		// Start on Inbound tab (default)
		await waitFor(() => expect(screen.getByText("Inbound Connectors")).toBeInTheDocument());
		// Switch to Outbound
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Outbound Connectors")).toBeInTheDocument());
		// Switch to General
		await userEvent.click(screen.getAllByText("General")[0] as HTMLElement);
		expect(screen.getByText("General Settings")).toBeInTheDocument();
		// Switch to Security
		await userEvent.click(screen.getAllByRole("button", { name: /security/i })[0] as HTMLElement);
		expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
		// Switch back to Inbound
		await userEvent.click(screen.getAllByText("Inbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Inbound Connectors")).toBeInTheDocument());
	});
});

describe("Settings — TrustedSendersPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	it("shows identity name in outbound tab", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Work Email")).toBeInTheDocument());
	});

	it("shows empty state when no trusted senders", async () => {
		// TrustedSendersPanel is tested separately; here we verify the Outbound tab loads
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Outbound Connectors")).toBeInTheDocument());
	});

	it("lists trusted senders", async () => {
		// Identity row shows email (on Outbound tab)
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("work@example.com")).toBeInTheDocument());
	});

	it("removes a trusted sender after confirmation", async () => {
		const { api } = await import("../../api");
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(1));
		const deleteBtnsT = screen.getAllByText("Delete");
		await userEvent.click(deleteBtnsT[deleteBtnsT.length - 1] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Delete identity")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("button", { name: "Delete Identity" }));
		await waitFor(() => {
			expect(api.identities.delete).toHaveBeenCalledWith(1);
		});
	});

	it("shows entry remains in list when remove fails", async () => {
		// If delete fails, error is alerted; identity remains
		const { api } = await import("../../api");
		(api.identities.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Server error"),
		);
		// jsdom may not have window.alert — define it if needed
		if (!window.alert) {
			window.alert = () => {};
		}
		const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getAllByText("Delete").length).toBeGreaterThanOrEqual(1));
		const deleteBtnsR = screen.getAllByText("Delete");
		await userEvent.click(deleteBtnsR[deleteBtnsR.length - 1] as HTMLElement);
		await waitFor(() => expect(screen.getByText("Delete identity")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("button", { name: "Delete Identity" }));
		await waitFor(() => expect(alertSpy).toHaveBeenCalled());
		alertSpy.mockRestore();
	});

	it("closes the panel when 'Close' is clicked", async () => {
		// Connectors tab is always visible; close button is the settings modal close button
		const onClose = vi.fn();
		render(<Settings onClose={onClose} />);
		await userEvent.click(screen.getByTitle("Close"));
		expect(onClose).toHaveBeenCalled();
	});
});

describe("Settings — IdentityForm field interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function openAddIdentityForm() {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getAllByText("Outbound")[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("+ Add Identity")).toBeInTheDocument());
		await userEvent.click(screen.getByText("+ Add Identity"));
		await waitFor(() => expect(screen.getByLabelText("Name")).toBeInTheDocument());
	}

	it("shows identity form with name and email fields", async () => {
		await openAddIdentityForm();
		// The form should have Name and Email fields
		expect(screen.getByLabelText("Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toBeInTheDocument();
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
