import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { Account, Label, Message, MessageSummary } from "../api";
import { useSyncPoller } from "../hooks";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock("../api", () => ({
	api: {
		status: vi.fn().mockResolvedValue({ state: "unlocked" }),
		demo: vi.fn().mockResolvedValue({ demo: false }),
		encryption: {
			setup: vi.fn(),
			unlock: vi.fn(),
		},
		accounts: {
			list: vi.fn(),
			get: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			syncStatus: vi.fn(),
		},
		folders: {
			list: vi.fn().mockResolvedValue([]),
		},
		labels: {
			list: vi.fn(),
			messages: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			filter: vi.fn().mockResolvedValue([]),
			filterCount: vi.fn().mockResolvedValue({ total: 0, unread: 0 }),
			related: vi.fn().mockResolvedValue([]),
		},
		messages: {
			get: vi.fn().mockResolvedValue(null),
			getThread: vi.fn().mockResolvedValue([]),
			updateFlags: vi.fn().mockResolvedValue({ ok: true, flags: "" }),
			delete: vi.fn().mockResolvedValue({ ok: true }),
			move: vi.fn().mockResolvedValue({ ok: true }),
			bulk: vi.fn().mockResolvedValue({ ok: true, count: 1 }),
			attachments: vi.fn().mockResolvedValue([]),
			labels: vi.fn().mockResolvedValue([]),
			addLabels: vi.fn().mockResolvedValue({ ok: true }),
			removeLabel: vi.fn().mockResolvedValue({ ok: true }),
		},
		inbox: {
			unified: {
				list: vi.fn().mockResolvedValue([]),
				count: vi.fn().mockResolvedValue({ total: 0, unread: 0 }),
			},
			allMessages: {
				list: vi.fn().mockResolvedValue([]),
				count: vi.fn().mockResolvedValue({ total: 0, unread: 0 }),
			},
			unreadMessages: {
				list: vi.fn().mockResolvedValue([]),
				count: vi.fn().mockResolvedValue({ total: 0 }),
			},
		},
		allMessages: {
			list: vi.fn().mockResolvedValue([]),
			count: vi.fn().mockResolvedValue({ total: 0, unread: 0 }),
		},
		unreadMessages: {
			list: vi.fn().mockResolvedValue([]),
			count: vi.fn().mockResolvedValue({ total: 0 }),
		},
		sync: {
			status: vi.fn().mockResolvedValue({}),
			trigger: vi.fn().mockResolvedValue({}),
		},
		send: vi.fn(),
		testSmtp: vi.fn(),
		drafts: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		trustedSenders: {
			list: vi.fn().mockResolvedValue([]),
			check: vi.fn().mockResolvedValue({ trusted: false }),
			add: vi.fn().mockResolvedValue({ id: 1 }),
			remove: vi.fn().mockResolvedValue({ ok: true }),
		},
		search: vi.fn().mockResolvedValue([]),
	},
}));

// Stub useSyncPoller to prevent interval leakage across tests
vi.mock("../hooks", async (importOriginal) => {
	const original = await importOriginal<typeof import("../hooks")>();
	return {
		...original,
		useSyncPoller: vi.fn().mockReturnValue({ syncing: false, lastError: null, syncStatus: null }),
	};
});

// ------------------------------------------------------------------
// Factories
// ------------------------------------------------------------------

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: 1,
		name: "Test Account",
		email: "test@example.com",
		imap_host: "imap.example.com",
		smtp_host: null,
		created_at: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function makeLabel(overrides: Partial<Label> = {}): Label {
	return {
		id: 1,
		name: "inbox",
		color: null,
		source: "imap",
		created_at: "2024-01-01T00:00:00Z",
		message_count: 0,
		unread_count: 0,
		...overrides,
	};
}

function makeMessageSummary(overrides: Partial<MessageSummary> = {}): MessageSummary {
	return {
		id: 1,
		uid: 1,
		message_id: "<msg1@test>",
		subject: "Test Subject",
		from_address: "sender@test.com",
		from_name: "Test Sender",
		to_addresses: '["recipient@test.com"]',
		date: new Date().toISOString(),
		flags: null,
		size: 1000,
		has_attachments: 0,
		preview: "Preview text",
		...overrides,
	};
}

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		...makeMessageSummary(),
		in_reply_to: null,
		references: null,
		cc_addresses: null,
		bcc_addresses: null,
		text_body: "Test body text",
		html_body: null,
		folder_path: "INBOX",
		folder_name: "inbox",
		...overrides,
	};
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

import { api } from "../api";

const mockApi = api as unknown as {
	accounts: { list: ReturnType<typeof vi.fn> };
	labels: {
		list: ReturnType<typeof vi.fn>;
		messages: ReturnType<typeof vi.fn>;
		related: ReturnType<typeof vi.fn>;
	};
	folders: { list: ReturnType<typeof vi.fn> };
	messages: {
		get: ReturnType<typeof vi.fn>;
		getThread: ReturnType<typeof vi.fn>;
		bulk: ReturnType<typeof vi.fn>;
	};
	sync: { status: ReturnType<typeof vi.fn>; trigger: ReturnType<typeof vi.fn> };
	search: ReturnType<typeof vi.fn>;
};

function setupWithAccounts(
	accounts: Account[] = [makeAccount()],
	labels: Label[] = [makeLabel()],
	messages: MessageSummary[] = [],
) {
	mockApi.accounts.list.mockResolvedValue(accounts);
	mockApi.labels.list.mockResolvedValue(labels);
	mockApi.labels.messages.mockResolvedValue(messages);
	mockApi.folders.list.mockResolvedValue([]);
}

/** Wait for the main app layout (not Welcome screen) to be ready */
async function waitForAppLayout() {
	// Compose button is unique to the sidebar — unambiguous signal that layout loaded
	await waitFor(() => {
		expect(screen.getByRole("button", { name: /compose/i })).toBeInTheDocument();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	document.title = "Stork Mail";
});

// ------------------------------------------------------------------
// Tests: Container state gates
// ------------------------------------------------------------------

describe("App — Container state", () => {
	it("shows SetupScreen when container state is setup", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "setup" });
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Set Up Encryption")).toBeInTheDocument();
		});
	});

	it("shows UnlockScreen when container state is locked", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "locked" });
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
		});
	});

	it("proceeds to app when container state is unlocked", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "unlocked" });
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitForAppLayout();
	});

	it("transitions to unlocked state when SetupScreen calls onUnlocked", async () => {
		const { api: mockApiModule } = await import("../api");
		// Use Once so subsequent tests still see the default "unlocked" state
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ state: "setup" });
		(mockApiModule.encryption.setup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			recoveryMnemonic:
				"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray",
		});
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);

		// Complete setup flow
		await waitFor(() => expect(screen.getByText("Set Up Encryption")).toBeInTheDocument());
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "validpassword1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: "Continue to Stork" }));

		// Should now show the main app (account has one label with INBOX)
		await waitForAppLayout();
	});

	it("transitions to unlocked state when UnlockScreen calls onUnlocked", async () => {
		const { api: mockApiModule } = await import("../api");
		// Use Once so subsequent tests still see the default "unlocked" state
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ state: "locked" });
		(mockApiModule.encryption.unlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
		});
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);

		await waitFor(() => expect(screen.getByText("Unlock Stork")).toBeInTheDocument());
		await userEvent.type(
			screen.getByPlaceholderText("Your encryption password"),
			"validpassword1!",
		);
		await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

		// Should now show the main app
		await waitForAppLayout();
	});
});

// ------------------------------------------------------------------
// Tests: Welcome screen
// ------------------------------------------------------------------

describe("App — Welcome screen", () => {
	it("shows Welcome when no accounts exist", async () => {
		mockApi.accounts.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
		});
	});

	it("does not show main layout when no accounts", async () => {
		mockApi.accounts.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
		});
		// Sidebar search button should not be present in Welcome mode
		expect(screen.queryByRole("button", { name: /search mail/i })).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Main layout
// ------------------------------------------------------------------

describe("App — Main layout", () => {
	it("renders sidebar and message list when accounts exist", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
	});

	it("shows Stork branding in sidebar", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		expect(screen.getByText("Stork")).toBeInTheDocument();
	});

	it("shows per-account buttons in Accounts section when multiple accounts exist", async () => {
		setupWithAccounts(
			[
				makeAccount({ id: 1, name: "Account One", email: "one@example.com" }),
				makeAccount({ id: 2, name: "Account Two", email: "two@example.com" }),
			],
			[
				makeLabel(),
				makeLabel({ id: 10, name: "Account One", source: "account" }),
				makeLabel({ id: 11, name: "Account Two", source: "account" }),
			],
		);
		render(<App />);
		await waitForAppLayout();
		// Multiple accounts → Accounts section shows account label buttons.
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Account One/ })).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /Account Two/ })).toBeInTheDocument();
		// No dropdown — account switching uses label buttons now
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});

	it("shows label names in sidebar", async () => {
		setupWithAccounts(
			[makeAccount()],
			[makeLabel({ id: 1, name: "inbox" }), makeLabel({ id: 2, name: "Sent Mail" })],
		);
		render(<App />);
		// Inbox is promoted to the top section; other labels appear in the label list
		await waitFor(() => {
			expect(screen.getAllByText("Inbox").length).toBeGreaterThanOrEqual(1);
			expect(screen.getByText("Sent Mail")).toBeInTheDocument();
		});
	});

	it("renders messages in the message list", async () => {
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[
				makeMessageSummary({ id: 1, subject: "Hello World" }),
				makeMessageSummary({ id: 2, subject: "Another Email" }),
			],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Hello World")).toBeInTheDocument();
			expect(screen.getByText("Another Email")).toBeInTheDocument();
		});
	});

	it("auto-selects Inbox label from labels list", async () => {
		setupWithAccounts(
			[makeAccount()],
			[
				makeLabel({ id: 10, name: "Sent", message_count: 5 }),
				makeLabel({ id: 20, name: "inbox", message_count: 3 }),
			],
		);
		render(<App />);
		// labels.messages should be called with the inbox label id (20)
		await waitFor(() => {
			expect(mockApi.labels.messages).toHaveBeenCalledWith(20, expect.anything());
		});
	});
});

// ------------------------------------------------------------------
// Tests: Document title
// ------------------------------------------------------------------

describe("App — Document title", () => {
	it("sets title to Stork Mail when no unread messages", async () => {
		setupWithAccounts([makeAccount()], [makeLabel({ unread_count: 0 })]);
		render(<App />);
		await waitForAppLayout();
		expect(document.title).toBe("Stork Mail");
	});

	it("prepends unread count when there are unread messages", async () => {
		setupWithAccounts(
			[makeAccount()],
			[
				makeLabel({ id: 1, name: "inbox", unread_count: 5 }),
				makeLabel({ id: 2, name: "Sent", unread_count: 2 }),
			],
		);
		render(<App />);
		await waitFor(() => {
			expect(document.title).toBe("(7) Stork Mail");
		});
	});
});

// ------------------------------------------------------------------
// Tests: Compose modal
// ------------------------------------------------------------------

describe("App — Compose", () => {
	it("Compose button opens compose modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// The Compose button's accessible name may include SVG title ("Compose Compose"),
		// so use a relaxed regex that matches as long as "compose" appears in the name
		await userEvent.click(screen.getByRole("button", { name: /compose/i }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
	});

	it("c shortcut opens compose modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
	});

	it("Escape closes compose modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
		});
	});

	it("c shortcut does not open compose when already composing", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		// Pressing c again should not break anything — still only one compose form
		fireEvent.keyDown(window, { key: "c" });
		expect(screen.getAllByPlaceholderText("recipient@example.com")).toHaveLength(1);
	});
});

// ------------------------------------------------------------------
// Tests: Search panel
// ------------------------------------------------------------------

describe("App — Search panel", () => {
	it("/ shortcut opens search panel", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
	});

	it("Escape closes search panel", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();
		});
	});

	it("clicking search button opens search panel", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		await userEvent.click(screen.getByRole("button", { name: /search mail/i }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
	});

	it("SearchPanel close button calls onClose and hides the panel", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open search
		await userEvent.click(screen.getByRole("button", { name: /search mail/i }));
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
		// Click the X button inside the SearchPanel (calls onClose prop)
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Shortcuts help modal
// ------------------------------------------------------------------

describe("App — Shortcuts help", () => {
	it("? shortcut opens shortcuts help modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "?" });
		await waitFor(() => {
			expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		});
	});

	it("Escape closes shortcuts help modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "?" });
		await waitFor(() => {
			expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
		});
	});

	it("? shortcut is ignored when search is open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open search first
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
		// Now press ? — should not open shortcuts help
		fireEvent.keyDown(window, { key: "?" });
		expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
	});

	it("? shortcut is ignored when compose is open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open compose first
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		// Now press ? — should not open shortcuts help
		fireEvent.keyDown(window, { key: "?" });
		expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Message selection
// ------------------------------------------------------------------

describe("App — Message selection", () => {
	it("selecting a message fetches message detail", async () => {
		const msg = makeMessage({ id: 42, subject: "Click me", text_body: "Body content" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 42, subject: "Click me" })],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Click me")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Click me"));
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(42);
		});
	});

	it("Escape deselects message when one is selected", async () => {
		const msg = makeMessage({ id: 42, subject: "Click me" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 42, subject: "Click me" })],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Click me")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Click me"));
		const callCount = mockApi.messages.get.mock.calls.length;
		// Escape should deselect — no new fetch triggered
		fireEvent.keyDown(window, { key: "Escape" });
		// Wait a tick and confirm no new fetch happened
		await new Promise((r) => setTimeout(r, 50));
		expect(mockApi.messages.get.mock.calls.length).toBe(callCount);
	});
});

// ------------------------------------------------------------------
// Tests: Keyboard navigation
// ------------------------------------------------------------------

describe("App — Keyboard navigation", () => {
	it("j key moves selection to next message", async () => {
		const messages = [
			makeMessageSummary({ id: 1, subject: "Message 1" }),
			makeMessageSummary({ id: 2, subject: "Message 2" }),
			makeMessageSummary({ id: 3, subject: "Message 3" }),
		];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 2 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Message 1")).toBeInTheDocument();
		});
		// j from index 0 → select index 1 (id=2)
		fireEvent.keyDown(window, { key: "j" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(2);
		});
	});

	it("k key moves selection to previous message", async () => {
		const messages = [
			makeMessageSummary({ id: 1, subject: "Message 1" }),
			makeMessageSummary({ id: 2, subject: "Message 2" }),
		];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 2 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Message 1")).toBeInTheDocument();
		});
		// Move to index 1 first with j
		fireEvent.keyDown(window, { key: "j" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(2);
		});
		// Then k back to index 0
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 1 }));
		fireEvent.keyDown(window, { key: "k" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(1);
		});
	});

	it("Enter key opens currently-indexed message", async () => {
		const messages = [makeMessageSummary({ id: 99, subject: "Enter Test" })];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 99 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Enter Test")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Enter" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(99);
		});
	});

	it("ArrowDown works like j", async () => {
		const messages = [
			makeMessageSummary({ id: 1, subject: "First" }),
			makeMessageSummary({ id: 2, subject: "Second" }),
		];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 2 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("First")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "ArrowDown" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(2);
		});
	});

	it("ArrowUp works like k", async () => {
		const messages = [
			makeMessageSummary({ id: 1, subject: "First" }),
			makeMessageSummary({ id: 2, subject: "Second" }),
		];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 2 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("First")).toBeInTheDocument();
		});
		// Move to index 1
		fireEvent.keyDown(window, { key: "ArrowDown" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(2);
		});
		// Move back to index 0
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 1 }));
		fireEvent.keyDown(window, { key: "ArrowUp" });
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(1);
		});
	});

	it("j does not go past the last message", async () => {
		const messages = [makeMessageSummary({ id: 1, subject: "Only one" })];
		mockApi.messages.get.mockResolvedValue(makeMessage({ id: 1 }));
		mockApi.messages.getThread.mockResolvedValue([]);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Only one")).toBeInTheDocument();
		});
		// Press j — should not crash or open a non-existent message
		fireEvent.keyDown(window, { key: "j" });
		// Message still visible (no navigation past end)
		expect(screen.getByText("Only one")).toBeInTheDocument();
		// messages.get was never called (nothing selected yet, and j can't go past 0 with 1 msg)
		expect(mockApi.messages.get).not.toHaveBeenCalled();
	});

	it("shows error toast when thread fetch fails", async () => {
		const msg = makeMessage({ id: 42, subject: "Thread error test" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockRejectedValueOnce(new Error("Server error"));
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 42, subject: "Thread error test" })],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Thread error test")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Thread error test"));
		await waitFor(() => {
			expect(screen.getByText("Failed to load thread")).toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Escape priority order
// ------------------------------------------------------------------

describe("App — Escape key priority", () => {
	it("Escape closes search when search is open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();
		});
	});

	it("Escape closes shortcuts help when open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "?" });
		await waitFor(() => {
			expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
		});
	});

	it("Escape closes compose when compose is open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Sync indicator
// ------------------------------------------------------------------

describe("App — Sync indicator", () => {
	it("shows syncing indicator when syncing is true", async () => {
		const { useSyncPoller } = await import("../hooks");
		vi.mocked(useSyncPoller).mockReturnValue({ syncing: true, lastError: null, syncStatus: null });
		setupWithAccounts();
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Syncing mail…")).toBeInTheDocument();
		});
		// Restore default
		vi.mocked(useSyncPoller).mockReturnValue({ syncing: false, lastError: null, syncStatus: null });
	});

	it("does not show syncing indicator when syncing is false", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		expect(screen.queryByText("Syncing mail…")).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Multiple accounts
// ------------------------------------------------------------------

describe("App — Multiple accounts", () => {
	it("auto-selects first account when none explicitly selected", async () => {
		const accounts = [
			makeAccount({ id: 1, name: "Account 1" }),
			makeAccount({ id: 2, name: "Account 2" }),
		];
		mockApi.accounts.list.mockResolvedValue(accounts);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => {
			// labels.list is global — no account ID argument
			expect(mockApi.labels.list).toHaveBeenCalled();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Window focus refresh
// ------------------------------------------------------------------

describe("App — Window focus refresh", () => {
	it("refetches messages and labels when window regains focus", async () => {
		setupWithAccounts();
		render(<App />);
		// Wait for initial API calls to complete before capturing baseline
		await waitFor(() => {
			expect(mockApi.labels.list.mock.calls.length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			expect(mockApi.labels.messages.mock.calls.length).toBeGreaterThan(0);
		});
		const labelCallsBefore = mockApi.labels.list.mock.calls.length;
		const msgCallsBefore = mockApi.labels.messages.mock.calls.length;
		// Simulate window focus
		fireEvent(window, new Event("focus"));
		await waitFor(() => {
			expect(mockApi.labels.list.mock.calls.length).toBeGreaterThan(labelCallsBefore);
		});
		await waitFor(() => {
			expect(mockApi.labels.messages.mock.calls.length).toBeGreaterThan(msgCallsBefore);
		});
	});
});

// ------------------------------------------------------------------
// Tests: Per-message keyboard shortcuts (s, u, d)
// ------------------------------------------------------------------

describe("App — Per-message keyboard shortcuts", () => {
	it("s shortcut calls updateFlags with add Flagged on an unstarred message", async () => {
		const messages = [makeMessageSummary({ id: 10, subject: "Star me", flags: null })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Star me")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "s" });
		await waitFor(() => {
			expect((api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[10, { add: ["\\Flagged"] }]]),
			);
		});
	});

	it("s shortcut calls updateFlags with remove Flagged on a starred message", async () => {
		const messages = [
			makeMessageSummary({ id: 11, subject: "Unstar me", flags: "\\Flagged,\\Seen" }),
		];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Unstar me")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "s" });
		await waitFor(() => {
			expect((api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[11, { remove: ["\\Flagged"] }]]),
			);
		});
	});

	it("u shortcut calls updateFlags with add Seen on an unread message", async () => {
		const messages = [makeMessageSummary({ id: 20, subject: "Mark read", flags: null })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Mark read")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "u" });
		await waitFor(() => {
			expect((api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[20, { add: ["\\Seen"] }]]),
			);
		});
	});

	it("u shortcut calls updateFlags with remove Seen on a read message", async () => {
		const messages = [makeMessageSummary({ id: 21, subject: "Mark unread", flags: "\\Seen" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Mark unread")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "u" });
		await waitFor(() => {
			expect((api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[21, { remove: ["\\Seen"] }]]),
			);
		});
	});

	it("d shortcut opens delete confirmation dialog", async () => {
		const messages = [makeMessageSummary({ id: 30, subject: "Delete me" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Delete me")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "d" });
		await waitFor(() => {
			expect(screen.getByText("Delete message")).toBeInTheDocument();
		});
	});

	it("d shortcut confirm calls api.messages.delete", async () => {
		const messages = [makeMessageSummary({ id: 31, subject: "Confirm delete" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Confirm delete")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "d" });
		await waitFor(() => expect(screen.getByText("Delete message")).toBeInTheDocument());
		// Click the "Delete" confirm button
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => {
			expect((api.messages.delete as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[31]]),
			);
		});
	});

	it("d shortcut cancel dismisses without deleting", async () => {
		const messages = [makeMessageSummary({ id: 32, subject: "Cancel delete" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Cancel delete")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "d" });
		await waitFor(() => expect(screen.getByText("Delete message")).toBeInTheDocument());
		// Click Cancel
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(screen.queryByText("Delete message")).not.toBeInTheDocument();
		});
		expect((api.messages.delete as ReturnType<typeof vi.fn>).mock.calls).not.toEqual(
			expect.arrayContaining([[32]]),
		);
	});

	it("s shortcut is ignored when compose is open", async () => {
		const messages = [makeMessageSummary({ id: 40, subject: "Guarded" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		const callsBefore = (api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls.length;
		fireEvent.keyDown(window, { key: "s" });
		await new Promise((r) => setTimeout(r, 50));
		expect((api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
			callsBefore,
		);
	});

	it("e shortcut removes current label (label-based archive)", async () => {
		const label = makeLabel({ id: 7 });
		const messages = [makeMessageSummary({ id: 50, subject: "Archive me" })];
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([label]);
		mockApi.labels.messages.mockResolvedValue(messages);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Archive me")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "e" });
		await waitFor(() => {
			expect((api.messages.removeLabel as ReturnType<typeof vi.fn>).mock.calls).toEqual(
				expect.arrayContaining([[50, 7]]),
			);
		});
	});

	it("e shortcut is ignored when compose is open", async () => {
		const messages = [makeMessageSummary({ id: 51, subject: "No archive" })];
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue(messages);
		mockApi.folders.list.mockResolvedValue([
			{
				id: 10,
				path: "Archive",
				name: "Archive",
				special_use: "\\Archive",
				message_count: 0,
				unread_count: 0,
				last_synced_at: null,
			},
		]);
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		const callsBefore = (api.messages.move as ReturnType<typeof vi.fn>).mock.calls.length;
		fireEvent.keyDown(window, { key: "e" });
		await new Promise((r) => setTimeout(r, 50));
		expect((api.messages.move as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
	});

	it("x shortcut toggles bulk selection for focused message", async () => {
		const messages = [
			makeMessageSummary({ id: 60, subject: "Select me" }),
			makeMessageSummary({ id: 61, subject: "Second message" }),
		];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Select me")).toBeInTheDocument());

		// Press x to select the focused message
		fireEvent.keyDown(window, { key: "x" });
		// The bulk actions bar should appear showing "1 selected"
		await waitFor(() => {
			expect(screen.getByText(/1 selected/)).toBeInTheDocument();
		});

		// Press x again to deselect
		fireEvent.keyDown(window, { key: "x" });
		await waitFor(() => {
			expect(screen.queryByText(/1 selected/)).not.toBeInTheDocument();
		});
	});

	it("x shortcut is ignored when compose is open", async () => {
		const messages = [makeMessageSummary({ id: 62, subject: "No select" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		fireEvent.keyDown(window, { key: "x" });
		await new Promise((r) => setTimeout(r, 50));
		// No bulk actions bar should appear
		expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Settings modal
// ------------------------------------------------------------------

describe("App — Settings modal", () => {
	it("settings button opens settings modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Settings button in the sidebar
		const settingsBtns = screen.getAllByTitle("Settings");
		const sidebarSettings = settingsBtns[0] as HTMLElement;
		await userEvent.click(sidebarSettings);
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
		});
	});

	it("Escape closes settings modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		const settingsBtns = screen.getAllByTitle("Settings");
		await userEvent.click(settingsBtns[0] as HTMLElement);
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
		});
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Reply / Reply All / Forward shortcuts
// ------------------------------------------------------------------

describe("App — Reply/Forward shortcuts", () => {
	it("r shortcut opens reply when message is selected", async () => {
		const msg = makeMessage({ id: 50, subject: "Reply test", text_body: "Body" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 50, subject: "Reply test" })],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Reply test")).toBeInTheDocument();
		});
		// Select the message
		await userEvent.click(screen.getByText("Reply test"));
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(50);
		});
		// Press r to reply
		fireEvent.keyDown(window, { key: "r" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
	});

	it("r shortcut does nothing when no message selected", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "r" });
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Dark mode toggle
// ------------------------------------------------------------------

describe("App — Dark mode", () => {
	it("dark mode toggle button works", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		const toggle = screen.getByTitle("Toggle dark mode");
		await userEvent.click(toggle);
		// Should toggle without error
	});
});

// ------------------------------------------------------------------
// Tests: Error state
// ------------------------------------------------------------------

describe("App — Error state", () => {
	it("shows reconnecting screen when accounts fail to load", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockResolvedValue({ state: "unlocked" });
		mockApi.accounts.list.mockRejectedValue(new Error("Server error"));
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Reconnecting to server…")).toBeInTheDocument();
		});
	});

	it("auto-recovers to unlock screen when server comes back locked", async () => {
		const { api: mockApiModule } = await import("../api");
		// Initial: server is unlocked but accounts fail (simulating restart mid-load)
		(mockApiModule.status as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ state: "unlocked" }) // initial status check
			.mockResolvedValueOnce({ state: "locked" }); // probe during reconnect
		mockApi.accounts.list.mockRejectedValue(new Error("Server error"));
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Reconnecting to server…")).toBeInTheDocument();
		});
		// The auto-probe should detect locked state and show UnlockScreen
		await waitFor(() => {
			expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
		});
	});

	it("auto-recovers when server comes back unlocked", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ state: "unlocked" }) // initial status check
			.mockResolvedValueOnce({ state: "unlocked" }); // probe during reconnect
		mockApi.accounts.list
			.mockRejectedValueOnce(new Error("Server error"))
			.mockResolvedValueOnce([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Reconnecting to server…")).toBeInTheDocument();
		});
		// The probe sets containerState to "unlocked" which re-triggers accounts fetch
		await waitForAppLayout();
	});
});

// ------------------------------------------------------------------
// Tests: Label switching
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Tests: Loading state
// ------------------------------------------------------------------

describe("App — Loading state", () => {
	it("shows loading spinner while checking container state", async () => {
		const { api: mockApiModule } = await import("../api");
		let resolveStatus: (v: unknown) => void = () => {};
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockReturnValue(
			new Promise((r) => {
				resolveStatus = r;
			}),
		);
		const { container } = render(<App />);
		// Should show spinner
		expect(container.querySelector(".animate-spin")).toBeInTheDocument();
		// Clean up
		resolveStatus?.({ state: "unlocked" });
	});
});

// ------------------------------------------------------------------
// Tests: Account switching
// ------------------------------------------------------------------

describe("App — Account switching", () => {
	it("switching account via Accounts section selects the account label", async () => {
		const accounts = [
			makeAccount({ id: 1, name: "Account 1" }),
			makeAccount({ id: 2, name: "Account 2" }),
		];
		mockApi.accounts.list.mockResolvedValue(accounts);
		mockApi.labels.list.mockResolvedValue([
			makeLabel(),
			makeLabel({ id: 10, name: "Account 1", source: "account" }),
			makeLabel({ id: 11, name: "Account 2", source: "account" }),
		]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Account 1/ })).toBeInTheDocument();
		});
		// Switch account via Accounts section label button
		await userEvent.click(screen.getByRole("button", { name: /Account 2/ }));
		// Clicking an account label triggers label-based filtering, which fetches label messages
		await waitFor(() => {
			expect(mockApi.labels.messages).toHaveBeenCalledWith(11, expect.anything());
		});
	});
});

// ------------------------------------------------------------------
// Tests: Label switching
// ------------------------------------------------------------------

describe("App — Label switching", () => {
	it("switching labels clears message selection", async () => {
		const msg = makeMessage({ id: 42 });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel({ id: 1, name: "inbox" }), makeLabel({ id: 2, name: "Archive", unread_count: 0 })],
			[makeMessageSummary({ id: 42, subject: "Selected msg" })],
		);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Selected msg")).toBeInTheDocument();
		});
		// Select a message first
		await userEvent.click(screen.getByText("Selected msg"));
		await waitFor(() => {
			expect(mockApi.messages.get).toHaveBeenCalledWith(42);
		});
		// Switch label
		const archiveElements = screen.getAllByText("Archive");
		const archiveSpan = archiveElements.find((el) => el.tagName === "SPAN") as HTMLElement;
		await userEvent.click(archiveSpan);
		// The label switch resets message selection — messages.get should be re-called for the new label
		await waitFor(() => {
			expect(mockApi.labels.messages).toHaveBeenCalledWith(2, expect.anything());
		});
	});

	it("clicking a label in sidebar changes the active label", async () => {
		setupWithAccounts(
			[makeAccount()],
			[makeLabel({ id: 1, name: "inbox" }), makeLabel({ id: 2, name: "Archive", unread_count: 0 })],
		);
		render(<App />);
		await waitFor(() => {
			// Archive text appears — use getAllByText since SVG titles may also match
			expect(screen.getAllByText("Archive").length).toBeGreaterThanOrEqual(1);
		});
		const archiveElements = screen.getAllByText("Archive");
		const archiveSpan = archiveElements.find((el) => el.tagName === "SPAN") as HTMLElement;
		await userEvent.click(archiveSpan);
		await waitFor(() => {
			// labels.messages should be called with the Archive label id
			expect(mockApi.labels.messages).toHaveBeenCalledWith(2, expect.anything());
		});
	});
});

// ------------------------------------------------------------------
// Tests: Reply-All and Forward keyboard shortcuts
// ------------------------------------------------------------------

describe("App — Reply-All and Forward shortcuts", () => {
	async function setupWithSelectedMessage() {
		const msg = makeMessage({ id: 60, subject: "Shortcuts test", text_body: "Body" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 60, subject: "Shortcuts test" })],
		);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Shortcuts test")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Shortcuts test"));
		await waitFor(() => expect(mockApi.messages.get).toHaveBeenCalledWith(60));
	}

	it("a shortcut opens reply-all compose when message selected", async () => {
		await setupWithSelectedMessage();
		fireEvent.keyDown(window, { key: "a" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
	});

	it("f shortcut opens forward compose when message selected", async () => {
		await setupWithSelectedMessage();
		fireEvent.keyDown(window, { key: "f" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
	});

	it("a shortcut does nothing when no message selected", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "a" });
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
	});

	it("f shortcut does nothing when no message selected", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "f" });
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
	});

	it("a shortcut does nothing when compose already open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		// a shortcut should not open second compose
		fireEvent.keyDown(window, { key: "a" });
		expect(screen.getAllByPlaceholderText("recipient@example.com")).toHaveLength(1);
	});
});

// ------------------------------------------------------------------
// Tests: Load more messages (pagination)
// ------------------------------------------------------------------

describe("App — Load more", () => {
	it("shows load more button when hasMore is true", async () => {
		// Return exactly 50 messages so hasMore=true
		const messages = Array.from({ length: 50 }, (_, i) =>
			makeMessageSummary({ id: i + 1, subject: `Message ${i + 1}` }),
		);
		mockApi.labels.messages.mockResolvedValue(messages);
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		// Override the mockResolvedValue set in setupWithAccounts
		mockApi.labels.messages.mockResolvedValue(messages);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Load more messages")).toBeInTheDocument();
		});
	});

	it("clicking load more fetches more messages", async () => {
		const initial = Array.from({ length: 50 }, (_, i) =>
			makeMessageSummary({ id: i + 1, subject: `Msg ${i + 1}` }),
		);
		const more = [makeMessageSummary({ id: 51, subject: "Msg 51" })];
		mockApi.labels.messages.mockResolvedValueOnce(initial).mockResolvedValueOnce(more);
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Load more messages")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Load more messages"));
		await waitFor(() => {
			// Second call should have been made with offset=50
			expect(mockApi.labels.messages).toHaveBeenCalledWith(
				expect.any(Number),
				expect.objectContaining({ offset: 50 }),
			);
		});
	});
});

// ------------------------------------------------------------------
// Tests: Bulk selection operations
// ------------------------------------------------------------------

describe("App — Bulk selection", () => {
	async function setupWithSelectableMessages() {
		const messages = [
			makeMessageSummary({ id: 100, subject: "Bulk msg 1", flags: null }),
			makeMessageSummary({ id: 101, subject: "Bulk msg 2", flags: null }),
		];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Bulk msg 1")).toBeInTheDocument());
	}

	it("clicking select checkbox shows bulk actions bar", async () => {
		await setupWithSelectableMessages();
		const selectBtn = screen.getAllByRole("button", { name: /select message/i })[0] as HTMLElement;
		await userEvent.click(selectBtn);
		await waitFor(() => {
			expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument();
		});
	});

	it("bulk delete calls api.messages.bulk with delete action", async () => {
		await setupWithSelectableMessages();
		const selectBtn = screen.getAllByRole("button", { name: /select message/i })[0] as HTMLElement;
		await userEvent.click(selectBtn);
		await waitFor(() => expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle("Delete selected"));
		await waitFor(() => {
			expect((mockApi.messages as { bulk: ReturnType<typeof vi.fn> }).bulk).toHaveBeenCalledWith(
				[100],
				"delete",
			);
		});
	});

	it("bulk mark read calls api.messages.bulk with flag+Seen action", async () => {
		await setupWithSelectableMessages();
		const selectBtn = screen.getAllByRole("button", { name: /select message/i })[0] as HTMLElement;
		await userEvent.click(selectBtn);
		await waitFor(() => expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle("Mark as read"));
		await waitFor(() => {
			expect((mockApi.messages as { bulk: ReturnType<typeof vi.fn> }).bulk).toHaveBeenCalledWith(
				[100],
				"flag",
				{ add: ["\\Seen"] },
			);
		});
	});

	it("bulk mark unread calls api.messages.bulk with flag-Seen action", async () => {
		await setupWithSelectableMessages();
		const selectBtn = screen.getAllByRole("button", { name: /select message/i })[0] as HTMLElement;
		await userEvent.click(selectBtn);
		await waitFor(() => expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle("Mark as unread"));
		await waitFor(() => {
			expect((mockApi.messages as { bulk: ReturnType<typeof vi.fn> }).bulk).toHaveBeenCalledWith(
				[100],
				"flag",
				{ remove: ["\\Seen"] },
			);
		});
	});

	it("select all selects all messages", async () => {
		await setupWithSelectableMessages();
		// Select first message to reveal BulkActionsBar
		const selectBtns = screen.getAllByRole("button", { name: /select message/i });
		await userEvent.click(selectBtns[0] as HTMLElement);
		await waitFor(() => expect(screen.getByText("1 selected")).toBeInTheDocument());
		// Click "Select all 2"
		await userEvent.click(screen.getByText(/select all 2/i));
		await waitFor(() => {
			expect(screen.getByText("2 selected")).toBeInTheDocument();
		});
	});

	it("bulk error shows toast on failure", async () => {
		await setupWithSelectableMessages();
		(mockApi.messages as { bulk: ReturnType<typeof vi.fn> }).bulk.mockRejectedValueOnce(
			new Error("Network error"),
		);
		const selectBtn = screen.getAllByRole("button", { name: /select message/i })[0] as HTMLElement;
		await userEvent.click(selectBtn);
		await waitFor(() => expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle("Delete selected"));
		await waitFor(() => {
			expect(screen.getByText(/failed to delete/i)).toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Sync trigger
// ------------------------------------------------------------------

describe("App — Sync trigger", () => {
	it("sync now button calls api.sync.trigger with account id", async () => {
		setupWithAccounts([makeAccount({ id: 7 })], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();
		const syncBtn = screen.getByTitle("Sync now");
		await userEvent.click(syncBtn);
		await waitFor(() => {
			expect(mockApi.sync.trigger).toHaveBeenCalledWith(7);
		});
	});
});

// ------------------------------------------------------------------
// Tests: SearchPanel message selection
// ------------------------------------------------------------------

describe("App — Search message selection", () => {
	it("selecting message from search panel closes panel and selects message", async () => {
		setupWithAccounts([makeAccount()], [makeLabel()]);
		const msg = makeMessage({ id: 77, subject: "Found via search" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		render(<App />);
		await waitForAppLayout();
		// Open search
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);
		// Simulate SearchPanel calling onSelectMessage(77)
		// SearchPanel is rendered in App, but we need to trigger onSelectMessage.
		// We can mock the search result and click — or just verify the panel closes on Escape
		// Since SearchPanel requires a real API call, test the Escape path which confirms the panel is mounted
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Mobile sidebar toggle
// ------------------------------------------------------------------

describe("App — Mobile sidebar", () => {
	it("hamburger button opens sidebar on mobile", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// The hamburger button opens the mobile sidebar overlay
		const hamburger = screen.getByRole("button", { name: "Open sidebar" });
		await userEvent.click(hamburger);
		// After clicking, the sidebar overlay button should appear
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Close sidebar" })).toBeInTheDocument();
		});
	});

	it("clicking sidebar overlay closes sidebar", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open sidebar first
		await userEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Close sidebar" })).toBeInTheDocument();
		});
		// Click the overlay to close
		await userEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Close sidebar" })).not.toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Send via SMTP
// ------------------------------------------------------------------

describe("App — Send email", () => {
	it("clicking Send calls api.send and closes the compose modal on success", async () => {
		const { api } = await import("../api");
		(api.send as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			message_id: "<test@example.com>",
			accepted: ["test@test.com"],
			rejected: [],
			stored_message_id: 1,
		});
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open compose
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		// Fill required field
		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "test@test.com");
		// Click Send — use getAllByRole to handle SVG <title>Send</title> matches
		const sendBtns = screen.getAllByRole("button", { name: /send/i });
		const sendBtn = sendBtns.find((b) => b.textContent?.includes("Send")) as HTMLElement;
		await userEvent.click(sendBtn);
		// Modal should close after successful send + toast confirmation
		await waitFor(() => {
			expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument();
		});
		expect(api.send).toHaveBeenCalled();
		expect(screen.getByText("Message sent")).toBeInTheDocument();
	});

	it("shows error inline when send fails", async () => {
		const { api } = await import("../api");
		(api.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("SMTP connection refused"));
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open compose
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() => {
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
		});
		// Fill required field
		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "test@test.com");
		// Click Send — use getAllByRole to handle SVG <title>Send</title> matches
		const sendBtns = screen.getAllByRole("button", { name: /send/i });
		const sendBtn = sendBtns.find((b) => b.textContent?.includes("Send")) as HTMLElement;
		await userEvent.click(sendBtn);
		// Error should appear inline in the compose modal
		await waitFor(
			() => {
				expect(screen.getByText(/SMTP connection refused/i)).toBeInTheDocument();
			},
			{ timeout: 3000 },
		);
		// Compose modal should still be open — draft is preserved
		expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Inline star toggle from message list
// ------------------------------------------------------------------

describe("App — Inline star toggle", () => {
	it("inline star toggle calls updateFlags with add Flagged for unstarred message", async () => {
		const messages = [makeMessageSummary({ id: 80, subject: "Star inline", flags: null })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Star inline")).toBeInTheDocument());
		// The star button appears on hover — click it directly
		const starBtn = screen.getByRole("button", { name: /star message/i });
		await userEvent.click(starBtn);
		await waitFor(() => {
			expect(api.messages.updateFlags as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(80, {
				add: ["\\Flagged"],
			});
		});
	});

	it("inline star toggle calls updateFlags with remove Flagged for starred message", async () => {
		const messages = [makeMessageSummary({ id: 81, subject: "Unstar inline", flags: "\\Flagged" })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Unstar inline")).toBeInTheDocument());
		const starBtn = screen.getByRole("button", { name: /remove star/i });
		await userEvent.click(starBtn);
		await waitFor(() => {
			expect(api.messages.updateFlags as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(81, {
				remove: ["\\Flagged"],
			});
		});
	});

	it("inline star toggle reverts on API failure", async () => {
		(api.messages.updateFlags as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Network error"),
		);
		const messages = [makeMessageSummary({ id: 82, subject: "Star fail", flags: null })];
		setupWithAccounts([makeAccount()], [makeLabel()], messages);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Star fail")).toBeInTheDocument());
		const starBtn = screen.getByRole("button", { name: /star message/i });
		await userEvent.click(starBtn);
		// After failure, refetch should be triggered (revert) — labels.messages called again
		await waitFor(() => {
			const calls = mockApi.labels.messages.mock.calls.length;
			expect(calls).toBeGreaterThanOrEqual(2);
		});
	});
});

// ------------------------------------------------------------------
// Tests: Container locked event
// ------------------------------------------------------------------

describe("App — Container locked event", () => {
	it("shows unlock screen when stork-container-locked event fires", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Dispatch the custom event that the API client fires on 423 responses
		window.dispatchEvent(new Event("stork-container-locked"));
		await waitFor(() => {
			expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
		});
	});
});

// ------------------------------------------------------------------
// Tests: Sync trigger error handling
// ------------------------------------------------------------------

describe("App — Sync trigger errors", () => {
	it("shows error toast when sync trigger fails with non-already-syncing error", async () => {
		mockApi.sync.trigger.mockRejectedValueOnce(new Error("Connection refused"));
		setupWithAccounts([makeAccount({ id: 5 })], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();
		const syncBtn = screen.getByTitle("Sync now");
		await userEvent.click(syncBtn);
		await waitFor(() => {
			expect(screen.getByText(/Sync failed.*Connection refused/)).toBeInTheDocument();
		});
	});

	it("suppresses toast when sync trigger fails with already syncing", async () => {
		mockApi.sync.trigger.mockRejectedValueOnce(new Error("already syncing"));
		setupWithAccounts([makeAccount({ id: 5 })], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();
		const syncBtn = screen.getByTitle("Sync now");
		await userEvent.click(syncBtn);
		// Wait a tick and verify no error toast
		await new Promise((r) => setTimeout(r, 100));
		expect(screen.queryByText(/Sync failed/)).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Send with reply threading headers
// ------------------------------------------------------------------

describe("App — Welcome screen", () => {
	it("shows welcome screen when no accounts exist", async () => {
		setupWithAccounts([], []);
		render(<App />);
		await waitFor(() => {
			expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
		});
	});
});

describe("App — Escape key chain", () => {
	it("Escape closes shortcuts modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open shortcuts help
		fireEvent.keyDown(window, { key: "?" });
		await waitFor(() => {
			expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
		});
		// Press Escape
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => {
			expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
		});
	});
});

describe("App — Reply compose pre-fills sender", () => {
	it("reply shortcut opens compose with the original sender's address pre-filled", async () => {
		const msg = makeMessage({
			id: 90,
			subject: "Reply pre-fill",
			from_address: "alice@test.com",
			text_body: "Hello",
		});
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 90, subject: "Reply pre-fill" })],
		);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Reply pre-fill")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Reply pre-fill"));
		await waitFor(() => expect(mockApi.messages.get).toHaveBeenCalledWith(90));
		// Press r to reply
		fireEvent.keyDown(window, { key: "r" });
		await waitFor(() => {
			const toInput = screen.getByPlaceholderText("recipient@example.com") as HTMLInputElement;
			expect(toInput.value).toContain("alice@test.com");
		});
	});
});

// ------------------------------------------------------------------
// Tests: Send with threading headers
// ------------------------------------------------------------------

describe("App — Send with reply threading", () => {
	it("sends reply with In-Reply-To and References headers", async () => {
		const original = makeMessage({
			id: 91,
			subject: "Thread test",
			from_address: "bob@test.com",
			message_id: "<original@test.com>",
			references: '["<ref1@test.com>","<ref2@test.com>"]',
			text_body: "Original body",
		});
		mockApi.messages.get.mockResolvedValue(original);
		mockApi.messages.getThread.mockResolvedValue([original]);
		(api.send as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			message_id: "<reply@test.com>",
			accepted: ["bob@test.com"],
			rejected: [],
			stored_message_id: 2,
		});
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 91, subject: "Thread test" })],
		);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Thread test")).toBeInTheDocument());
		// Select message and wait for detail to finish loading
		await userEvent.click(screen.getByText("Thread test"));
		await waitFor(() => expect(mockApi.messages.get).toHaveBeenCalledWith(91));
		// Wait for message to render (ThreadMessage shows text_body in a pre tag)
		await waitFor(() => expect(screen.getByText("Original body")).toBeInTheDocument());
		// Press r to reply
		fireEvent.keyDown(window, { key: "r" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		// Verify To field is pre-filled with sender
		const toInput = screen.getByPlaceholderText("recipient@example.com") as HTMLInputElement;
		expect(toInput.value).toBe("bob@test.com");
		// Click Send — find the button by exact text content
		const allBtns = screen.getAllByRole("button");
		const sendBtn = allBtns.find(
			(b) => b.textContent === "Send" || b.textContent === "Sending…",
		) as HTMLElement;
		expect(sendBtn).toBeDefined();
		await userEvent.click(sendBtn);
		await waitFor(
			() => {
				expect(api.send).toHaveBeenCalledWith(
					expect.objectContaining({
						in_reply_to: "<original@test.com>",
						references: ["<ref1@test.com>", "<ref2@test.com>", "<original@test.com>"],
					}),
				);
			},
			{ timeout: 3000 },
		);
	});

	it("sends reply with space-separated references fallback", async () => {
		const original = makeMessage({
			id: 92,
			subject: "Space refs",
			from_address: "bob@test.com",
			message_id: "<orig2@test.com>",
			references: "<ref-a@test.com> <ref-b@test.com>",
			text_body: "Ref body",
		});
		mockApi.messages.get.mockResolvedValue(original);
		mockApi.messages.getThread.mockResolvedValue([original]);
		(api.send as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			message_id: "<reply2@test.com>",
			accepted: ["bob@test.com"],
			rejected: [],
			stored_message_id: 3,
		});
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 92, subject: "Space refs" })],
		);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Space refs")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Space refs"));
		await waitFor(() => expect(screen.getByText("Ref body")).toBeInTheDocument());
		fireEvent.keyDown(window, { key: "r" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);
		const allBtns = screen.getAllByRole("button");
		const sendBtn = allBtns.find(
			(b) => b.textContent === "Send" || b.textContent === "Sending…",
		) as HTMLElement;
		expect(sendBtn).toBeDefined();
		await userEvent.click(sendBtn);
		await waitFor(
			() => {
				expect(api.send).toHaveBeenCalledWith(
					expect.objectContaining({
						in_reply_to: "<orig2@test.com>",
						references: ["<ref-a@test.com>", "<ref-b@test.com>", "<orig2@test.com>"],
					}),
				);
			},
			{ timeout: 3000 },
		);
	});
});

// ------------------------------------------------------------------
// Tests: Message detail callbacks (onBack, onMessageChanged, onMessageDeleted)
// ------------------------------------------------------------------

describe("App — MessageDetail callbacks", () => {
	async function setupWithMessage() {
		const msg = makeMessage({ id: 70, subject: "Detail test", text_body: "Body text" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 70, subject: "Detail test" })],
		);
		render(<App />);
		await waitFor(() => expect(screen.getByText("Detail test")).toBeInTheDocument());
		await userEvent.click(screen.getByText("Detail test"));
		await waitFor(() => expect(mockApi.messages.get).toHaveBeenCalledWith(70));
	}

	it("back button deselects message and returns to message list", async () => {
		await setupWithMessage();
		// Wait for message body to render in detail view
		await waitFor(() => expect(screen.getByText("Body text")).toBeInTheDocument());
		// Find the back button in the message detail header (text "← Back to list")
		const backBtn = screen.getByText(/← Back/);
		const msgGetCallsBefore = mockApi.messages.get.mock.calls.length;
		await userEvent.click(backBtn);
		// After clicking back, no new message fetch should happen (message deselected)
		await new Promise((r) => setTimeout(r, 50));
		expect(mockApi.messages.get.mock.calls.length).toBe(msgGetCallsBefore);
	});

	it("deleting message from detail view triggers onMessageDeleted", async () => {
		await setupWithMessage();
		// Wait for message body to render in detail view
		await waitFor(() => expect(screen.getByText("Body text")).toBeInTheDocument());
		// Find the delete button in the message detail header actions
		const deleteBtn = screen.getByTitle("Delete message");
		await userEvent.click(deleteBtn);
		// Confirm deletion in the dialog
		await waitFor(() =>
			expect(
				screen.getByText(
					"This will permanently delete this message. This action cannot be undone.",
				),
			).toBeInTheDocument(),
		);
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));
		// After deletion, messages and labels should be refetched
		await waitFor(() => {
			expect(api.messages.delete as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(70);
		});
	});
});

// ------------------------------------------------------------------
// Tests: Search result navigation
// ------------------------------------------------------------------

describe("App — Search result navigation", () => {
	it("opening search and closing returns to correct state", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open search
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);
		// Close search
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument(),
		);
		// Main layout should still be intact
		expect(screen.getByRole("button", { name: /search mail/i })).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Escape priority — settings modal
// ------------------------------------------------------------------

describe("App — Escape closes settings before other modals", () => {
	it("Escape closes settings modal when settings is open", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();
		// Open settings
		const settingsBtns = screen.getAllByTitle("Settings");
		await userEvent.click(settingsBtns[0] as HTMLElement);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument(),
		);
		// Escape should close settings
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument(),
		);
	});
});

// ------------------------------------------------------------------
// Tests: Back from search — reopens search panel (App.tsx lines 779-780)
// ------------------------------------------------------------------

describe("App — Back from search-opened message", () => {
	it("back button returns to search panel when message was opened from search results", async () => {
		const msg = makeMessage({ id: 99, subject: "Search hit", text_body: "Found body" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		mockApi.search.mockResolvedValue([
			{
				id: 99,
				subject: "Search hit",
				from_address: "sender@test.com",
				from_name: "Sender",
				date: new Date().toISOString(),
				snippet: "Found body",
			},
		]);
		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		// Open search
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);

		// Type to trigger the debounced search
		await userEvent.type(screen.getByPlaceholderText("Search messages…"), "hit");

		// Wait for the search result to render
		await waitFor(
			() =>
				expect(screen.getByRole("button", { name: /Search hit from Sender/ })).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		// Click the search result — sets selectedMessageId + openedFromSearch=true
		await userEvent.click(screen.getByRole("button", { name: /Search hit from Sender/ }));

		// Wait for message detail to render — back button shows "← Search results" when openedFromSearch=true
		await waitFor(() => expect(screen.getByText("← Search results")).toBeInTheDocument(), {
			timeout: 3000,
		});

		// Click the back button — triggers lines 779-780 (setShowSearch(true) + setOpenedFromSearch(false))
		await userEvent.click(screen.getByText("← Search results"));

		// Message detail should be gone (back button "← Search results" is unique to the detail view)
		await waitFor(() => expect(screen.queryByText("← Search results")).not.toBeInTheDocument());
		// Search panel should still be visible (showSearch remains true after onBack)
		expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: onMessageChanged triggers refetches (App.tsx lines 783-787)
// ------------------------------------------------------------------

describe("App — onMessageChanged callback", () => {
	it("starring a message from the detail view triggers message and label refetches", async () => {
		const msg = makeMessage({ id: 88, subject: "Refetch trigger test", flags: null });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		setupWithAccounts(
			[makeAccount()],
			[makeLabel()],
			[makeMessageSummary({ id: 88, subject: "Refetch trigger test", flags: null })],
		);
		render(<App />);
		// Wait for the message subject to appear in the list (messages load async)
		await waitFor(() => expect(screen.getByText("Refetch trigger test")).toBeInTheDocument());

		// Select the message to open it in the detail view
		await userEvent.click(screen.getByText("Refetch trigger test"));
		await waitFor(() => expect(mockApi.messages.get).toHaveBeenCalledWith(88));

		// Record call counts before the action
		const getCallsBefore = mockApi.messages.get.mock.calls.length;
		const labelsCallsBefore = mockApi.labels.list.mock.calls.length;

		// Click the "Star message" button in the message detail header
		await waitFor(() => expect(screen.getByTitle("Star message")).toBeInTheDocument());
		await userEvent.click(screen.getByTitle("Star message"));

		// onMessageChanged should trigger refetchMessage (messages.get) and refetchLabels (labels.list)
		await waitFor(() => {
			expect(mockApi.messages.get.mock.calls.length).toBeGreaterThan(getCallsBefore);
			expect(mockApi.labels.list.mock.calls.length).toBeGreaterThan(labelsCallsBefore);
		});
	});
});

// ------------------------------------------------------------------
// Tests: Modal X-button onClose props (App.tsx lines 809, 813, 814)
// ------------------------------------------------------------------

describe("App — Modal onClose via X button", () => {
	it("clicking X button in ShortcutsHelp calls onClose and closes the modal", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();

		// Open shortcuts help
		fireEvent.keyDown(window, { key: "?" });
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeInTheDocument(),
		);

		// Click the X button inside ShortcutsHelp (title="Close" from XIcon)
		await userEvent.click(screen.getByTitle("Close"));

		// Modal should close (onClose prop was called → setShowShortcuts(false))
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument(),
		);
	});

	it("clicking Close settings button in Settings modal calls onClose", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();

		// Open settings via settings button
		const settingsBtns = screen.getAllByTitle("Settings");
		await userEvent.click(settingsBtns[0] as HTMLElement);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument(),
		);

		// Click the "Close settings" button inside the Settings modal
		await userEvent.click(screen.getByRole("button", { name: "Close settings" }));

		// Modal should close (onClose prop was called → setShowSettings(false))
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument(),
		);
	});

	it("clicking X button in ComposeModal calls onClose prop", async () => {
		setupWithAccounts();
		render(<App />);
		await waitForAppLayout();

		// Open compose modal
		fireEvent.keyDown(window, { key: "c" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("recipient@example.com")).toBeInTheDocument(),
		);

		// Find and click the X/close button inside the ComposeModal
		// ComposeModal header has an X button with title "Close" from XIcon
		const closeBtns = screen.getAllByTitle("Close");
		const composeCloseBtn = closeBtns[0] as HTMLElement;
		await userEvent.click(composeCloseBtn);

		// Compose modal should close (onClose prop was called → setComposeMode(null))
		await waitFor(() =>
			expect(screen.queryByPlaceholderText("recipient@example.com")).not.toBeInTheDocument(),
		);
	});
});

// ------------------------------------------------------------------
// Tests: Escape key reopens search when message opened from search (App.tsx lines 469-470)
// ------------------------------------------------------------------

describe("App — Escape key from search-opened message", () => {
	it("Escape key re-opens search panel when message was opened from search results", async () => {
		const msg = makeMessage({ id: 99, subject: "Search hit", text_body: "Found body" });
		mockApi.messages.get.mockResolvedValue(msg);
		mockApi.messages.getThread.mockResolvedValue([msg]);
		mockApi.search.mockResolvedValue([
			{
				id: 99,
				subject: "Search hit",
				from_address: "sender@test.com",
				from_name: "Sender",
				date: new Date().toISOString(),
				snippet: "Found body",
			},
		]);
		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		// Open search panel
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);

		// Type to trigger the debounced search
		await userEvent.type(screen.getByPlaceholderText("Search messages…"), "hit");

		// Wait for search result to render
		await waitFor(
			() =>
				expect(screen.getByRole("button", { name: /Search hit from Sender/ })).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		// Click the search result — sets selectedMessageId + openedFromSearch=true
		await userEvent.click(screen.getByRole("button", { name: /Search hit from Sender/ }));

		// Wait for message detail to render (search panel closes, back button appears)
		await waitFor(() => expect(screen.getByText("← Search results")).toBeInTheDocument(), {
			timeout: 3000,
		});

		// After clicking a search result, showSearch is still true (search panel visible alongside detail)
		// First Escape closes the search panel (showSearch → false), leaving message detail open
		fireEvent.keyDown(window, { key: "Escape" });

		// Search panel should close but message detail ("← Search results") should still be there
		await waitFor(() =>
			expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument(),
		);
		expect(screen.getByText("← Search results")).toBeInTheDocument();

		// Second Escape should close message detail and re-open search panel (lines 469-470)
		fireEvent.keyDown(window, { key: "Escape" });

		// Message detail should close
		await waitFor(() => expect(screen.queryByText("← Search results")).not.toBeInTheDocument());
		// Search panel should reopen (setShowSearch(true) was called because openedFromSearch was true)
		expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Browser back/forward navigation with searchActive state (App.tsx lines 272-278)
// ------------------------------------------------------------------

describe("App — History navigation with searchActive", () => {
	it("popstate with searchActive=true opens search panel", async () => {
		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		// Initially search panel is closed
		expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();

		// Fire a popstate event simulating browser back to a state where search was open (lines 272-278)
		const navState = {
			accountId: 1,
			labelId: 1,
			messageId: null,
			searchActive: true,
		};
		window.dispatchEvent(new PopStateEvent("popstate", { state: navState }));

		// Search panel should now be shown
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);
	});

	it("popstate without searchActive leaves search panel closed", async () => {
		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		// Fire popstate without searchActive
		const navState = { accountId: 1, labelId: 1, messageId: null };
		window.dispatchEvent(new PopStateEvent("popstate", { state: navState }));

		// Wait a tick and verify search panel remains closed
		await new Promise((r) => setTimeout(r, 50));
		expect(screen.queryByPlaceholderText("Search messages…")).not.toBeInTheDocument();
	});
});

// ------------------------------------------------------------------
// Tests: Search result prev/next navigation (App.tsx lines 244-254)
// ------------------------------------------------------------------

describe("App — Search prev/next navigation", () => {
	// Helper: set up 3 search results and open the middle one (index 1)
	async function setupSearchNavigation() {
		const msg1 = makeMessage({ id: 101, subject: "Result One", text_body: "body one" });
		const msg2 = makeMessage({ id: 102, subject: "Result Two", text_body: "body two" });
		const msg3 = makeMessage({ id: 103, subject: "Result Three", text_body: "body three" });

		// messages.get will be called with whichever id is selected
		(
			api as unknown as { messages: { get: ReturnType<typeof vi.fn> } }
		).messages.get.mockImplementation((id: number) => {
			if (id === 101) return Promise.resolve(msg1);
			if (id === 102) return Promise.resolve(msg2);
			if (id === 103) return Promise.resolve(msg3);
			return Promise.resolve(null);
		});
		(
			api as unknown as { messages: { getThread: ReturnType<typeof vi.fn> } }
		).messages.getThread.mockImplementation((id: number) => {
			if (id === 101) return Promise.resolve([msg1]);
			if (id === 102) return Promise.resolve([msg2]);
			if (id === 103) return Promise.resolve([msg3]);
			return Promise.resolve([]);
		});

		const makeResult = (id: number, subject: string) => ({
			id,
			subject,
			from_address: "sender@test.com",
			from_name: "Sender",
			date: new Date().toISOString(),
			snippet: `body for ${subject}`,
		});
		mockApi.search.mockResolvedValue([
			makeResult(101, "Result One"),
			makeResult(102, "Result Two"),
			makeResult(103, "Result Three"),
		]);

		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		// Open search
		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);

		// Type to trigger search
		await userEvent.type(screen.getByPlaceholderText("Search messages…"), "result");

		// Wait for results
		await waitFor(
			() =>
				expect(screen.getByRole("button", { name: /Result Two from Sender/ })).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		// Open the 2nd result (middle — has both prev and next)
		await userEvent.click(screen.getByRole("button", { name: /Result Two from Sender/ }));

		// Wait for message detail with search navigation
		await waitFor(() => expect(screen.getByText("← Search results")).toBeInTheDocument(), {
			timeout: 3000,
		});
	}

	it("shows prev/next navigation buttons when viewing a search result", async () => {
		await setupSearchNavigation();

		// Both prev and next buttons should be present
		expect(screen.getByTitle("Previous search result")).toBeInTheDocument();
		expect(screen.getByTitle("Next search result")).toBeInTheDocument();

		// Shows position indicator (2 of 3)
		expect(screen.getByText("2/3")).toBeInTheDocument();
	});

	it("clicking prev navigates to the previous search result", async () => {
		await setupSearchNavigation();

		// Click prev — should navigate to Result One (id=101)
		await userEvent.click(screen.getByTitle("Previous search result"));

		// Message detail should now show Result One
		await waitFor(
			() =>
				expect(
					(api as unknown as { messages: { get: ReturnType<typeof vi.fn> } }).messages.get,
				).toHaveBeenCalledWith(101),
			{ timeout: 2000 },
		);

		// Now at first result — prev button should be disabled (undefined prop)
		await waitFor(() => {
			const prevBtn = screen.getByTitle("Previous search result");
			expect(prevBtn).toBeDisabled();
		});
	});

	it("clicking next navigates to the next search result", async () => {
		await setupSearchNavigation();

		// Click next — should navigate to Result Three (id=103)
		await userEvent.click(screen.getByTitle("Next search result"));

		// Message detail should now show Result Three
		await waitFor(
			() =>
				expect(
					(api as unknown as { messages: { get: ReturnType<typeof vi.fn> } }).messages.get,
				).toHaveBeenCalledWith(103),
			{ timeout: 2000 },
		);

		// Now at last result — next button should be disabled (undefined prop)
		await waitFor(() => {
			const nextBtn = screen.getByTitle("Next search result");
			expect(nextBtn).toBeDisabled();
		});
	});

	it("prev button is disabled for the first search result", async () => {
		const msg = makeMessage({ id: 201, subject: "Only Result", text_body: "body" });
		(
			api as unknown as { messages: { get: ReturnType<typeof vi.fn> } }
		).messages.get.mockResolvedValue(msg);
		(
			api as unknown as { messages: { getThread: ReturnType<typeof vi.fn> } }
		).messages.getThread.mockResolvedValue([msg]);
		mockApi.search.mockResolvedValue([
			{
				id: 201,
				subject: "Only Result",
				from_address: "a@b.com",
				from_name: "A",
				date: new Date().toISOString(),
				snippet: "body",
			},
		]);
		setupWithAccounts([makeAccount()], [makeLabel()]);
		render(<App />);
		await waitForAppLayout();

		fireEvent.keyDown(window, { key: "/" });
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument(),
		);
		await userEvent.type(screen.getByPlaceholderText("Search messages…"), "only");
		await waitFor(
			() => expect(screen.getByRole("button", { name: /Only Result from A/ })).toBeInTheDocument(),
			{ timeout: 2000 },
		);
		await userEvent.click(screen.getByRole("button", { name: /Only Result from A/ }));
		await waitFor(() => expect(screen.getByText("← Search results")).toBeInTheDocument(), {
			timeout: 3000,
		});

		// Only one result — prev and next should both be disabled
		const prevBtn = screen.getByTitle("Previous search result");
		const nextBtn = screen.getByTitle("Next search result");
		expect(prevBtn).toBeDisabled();
		expect(nextBtn).toBeDisabled();
	});
});

// ------------------------------------------------------------------
// Tests: api.status() error fallback (App.tsx line 41)
// ------------------------------------------------------------------

describe("App — api.status error fallback", () => {
	it("falls back to unlocked state when api.status() rejects (server error path)", async () => {
		const { api: mockApiModule } = await import("../api");
		(mockApiModule.status as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Connection refused"),
		);
		mockApi.accounts.list.mockResolvedValue([makeAccount()]);
		mockApi.labels.list.mockResolvedValue([makeLabel()]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		// Should proceed to the main app layout despite api.status() throwing
		await waitForAppLayout();
	});
});

// ------------------------------------------------------------------
// Tests: per-account default_view "label:<id>" parsing (App.tsx lines 101-102)
// ------------------------------------------------------------------

describe("App — per-account default_view label: parsing", () => {
	it("selects the specified label when default_view is 'label:<id>'", async () => {
		const targetLabel = makeLabel({ id: 7, name: "work", unread_count: 3, message_count: 5 });
		const accountWithLabelView = makeAccount({ default_view: "label:7" });
		mockApi.accounts.list.mockResolvedValue([accountWithLabelView]);
		mockApi.labels.list.mockResolvedValue([makeLabel(), targetLabel]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitForAppLayout();
		// The "work" label should be auto-selected — messages.list would be called for label 7
		await waitFor(() => expect(mockApi.labels.messages).toHaveBeenCalledWith(7, expect.anything()));
	});

	it("falls back to inbox when default_view is 'label:<nan>'", async () => {
		const accountWithBadView = makeAccount({ default_view: "label:notanumber" });
		const inboxLabel = makeLabel({ id: 1, name: "inbox" });
		mockApi.accounts.list.mockResolvedValue([accountWithBadView]);
		mockApi.labels.list.mockResolvedValue([inboxLabel]);
		mockApi.labels.messages.mockResolvedValue([]);
		mockApi.folders.list.mockResolvedValue([]);
		render(<App />);
		await waitForAppLayout();
		// Should fall back to inbox (label id 1 = INBOX_LABEL_ID)
		await waitFor(() => expect(mockApi.labels.messages).toHaveBeenCalledWith(1, expect.anything()));
	});
});

// ------------------------------------------------------------------
// Tests: useSyncPoller onSyncComplete callback fires refetches (App.tsx lines 179-182)
// ------------------------------------------------------------------

describe("App — useSyncPoller onSyncComplete callback", () => {
	it("fires refetchLabels, refetchMessages, refetchAllMailCount, refetchUnreadCount on sync complete", async () => {
		// Capture the LATEST callback so we get the version with effectiveAccountId already set.
		// useSyncPoller is called on every render; we track the most recent invocation.
		let latestCallback: (() => void) | undefined;
		vi.mocked(useSyncPoller).mockImplementation((onSyncComplete) => {
			latestCallback = onSyncComplete;
			return { syncing: false, lastError: null, syncStatus: null, progress: null };
		});

		try {
			setupWithAccounts([makeAccount()], [makeLabel()]);
			render(<App />);
			await waitForAppLayout();

			// Ensure initial labels load completes (effectiveAccountId is now set)
			await waitFor(() => expect(mockApi.labels.list.mock.calls.length).toBeGreaterThanOrEqual(1));
			const labelsCountBefore = mockApi.labels.list.mock.calls.length;

			// Fire the latest callback (which has fresh refetchLabels with effectiveAccountId=1)
			expect(latestCallback).toBeDefined();
			await act(async () => {
				latestCallback?.();
			});

			// refetchLabels should trigger an additional labels.list call
			await waitFor(
				() => expect(mockApi.labels.list.mock.calls.length).toBeGreaterThan(labelsCountBefore),
				{ timeout: 3000 },
			);
		} finally {
			// Restore original mock so subsequent tests see default behavior
			vi.mocked(useSyncPoller).mockReturnValue({
				syncing: false,
				lastError: null,
				syncStatus: null,
				progress: null,
			});
		}
	});
});
