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
		encryption: {
			changePassword: vi.fn().mockResolvedValue({ ok: true }),
			rotateRecoveryKey: vi.fn().mockResolvedValue({
				recoveryMnemonic: Array(24).fill("word").join(" "),
			}),
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
		// "Settings" appears both as <h2> heading and SVG <title> — target the heading
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
		// fireEvent.click dispatches directly on the backdrop element, so
		// event.target === backdrop === event.currentTarget — the guard passes.
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
		// Form has heading "Add Account" (without +)
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
		expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Rotate Recovery Key" })).toBeInTheDocument();
	});

	it("shows validation error when new passwords do not match", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
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
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"wrongpassword!!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("Incorrect password")).toBeInTheDocument());
	});

	it("requires acknowledgement checkbox before Done button works", async () => {
		render(<Settings onClose={vi.fn()} />);
		await userEvent.click(screen.getByRole("button", { name: /security/i }));
		await userEvent.type(
			screen.getByPlaceholderText("Confirm your encryption password"),
			"mypassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /rotate recovery key/i }));
		await waitFor(() => expect(screen.getByText("New Recovery Phrase")).toBeInTheDocument());
		const doneBtn = screen.getByRole("button", { name: "Done" });
		expect(doneBtn).toBeDisabled();
		await userEvent.click(screen.getByRole("checkbox"));
		expect(doneBtn).toBeEnabled();
	});
});
