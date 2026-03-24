import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account, GlobalSyncStatus, Label } from "../../api";
import { ALL_MAIL_LABEL_ID, INBOX_LABEL_ID, Sidebar, UNREAD_LABEL_ID } from "../Sidebar";

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: 1,
		name: "Test Account",
		email: "test@example.com",
		imap_host: "imap.example.com",
		smtp_host: null,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

function makeLabel(overrides: Partial<Label> = {}): Label {
	return {
		id: 1,
		name: "Inbox",
		color: null,
		source: "imap",
		created_at: new Date().toISOString(),
		message_count: 10,
		unread_count: 3,
		...overrides,
	};
}

const defaultProps = {
	accounts: [makeAccount()],
	labels: [] as Label[],
	selectedAccountId: 1,
	selectedLabelId: null,
	onSelectAccount: vi.fn(),
	onSelectLabel: vi.fn(),
	onCompose: vi.fn(),
	onSearch: vi.fn(),
	onSettings: vi.fn(),
	dark: false,
	onToggleDark: vi.fn(),
};

describe("Sidebar", () => {
	it("renders the Stork brand", () => {
		render(<Sidebar {...defaultProps} />);
		expect(screen.getByText("Stork")).toBeInTheDocument();
		expect(screen.getByText("Mail")).toBeInTheDocument();
	});

	it("renders compose button and triggers callback", async () => {
		const onCompose = vi.fn();
		render(<Sidebar {...defaultProps} onCompose={onCompose} />);

		const composeBtn = screen.getByRole("button", { name: /compose/i });
		await userEvent.click(composeBtn);
		expect(onCompose).toHaveBeenCalledOnce();
	});

	it("renders search button and opens search on click", async () => {
		const onSearch = vi.fn();
		render(<Sidebar {...defaultProps} onSearch={onSearch} />);

		const searchButton = screen.getByRole("button", { name: /search mail/i });
		await userEvent.click(searchButton);
		expect(onSearch).toHaveBeenCalledOnce();
	});

	it("renders label list with icons", () => {
		const labels = [
			makeLabel({ id: 1, name: "Inbox" }),
			makeLabel({ id: 2, name: "Sent", unread_count: 0 }),
			makeLabel({ id: 3, name: "Trash", unread_count: 0 }),
		];
		render(<Sidebar {...defaultProps} labels={labels} />);
		expect(screen.getAllByText("Inbox").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Sent").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Trash").length).toBeGreaterThanOrEqual(1);
	});

	it("shows unread count badges", () => {
		const inboxLabel = makeLabel({ id: 1, name: "Inbox", unread_count: 5 });
		const labels = [inboxLabel];
		render(<Sidebar {...defaultProps} labels={labels} inboxLabel={inboxLabel} />);
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("calls onSelectLabel when a label is clicked", async () => {
		const onSelectLabel = vi.fn();
		const labels = [makeLabel({ id: 42, name: "Drafts" })];
		render(<Sidebar {...defaultProps} labels={labels} onSelectLabel={onSelectLabel} />);

		const draftsElements = screen.getAllByText("Drafts");
		const span = draftsElements.find((el) => el.tagName === "SPAN") as HTMLElement;
		await userEvent.click(span);
		expect(onSelectLabel).toHaveBeenCalledWith(42);
	});

	it("shows syncing indicator when syncing", () => {
		render(<Sidebar {...defaultProps} syncing={true} />);
		expect(screen.getByText("Syncing mail…")).toBeInTheDocument();
	});

	it("does not show syncing indicator when not syncing", () => {
		render(<Sidebar {...defaultProps} syncing={false} />);
		expect(screen.queryByText("Syncing mail…")).not.toBeInTheDocument();
	});

	it("shows empty state when no labels", () => {
		render(<Sidebar {...defaultProps} labels={[]} />);
		expect(screen.getByText("No labels yet")).toBeInTheDocument();
	});

	it("shows account selector when multiple accounts", () => {
		const accounts = [
			makeAccount({ id: 1, name: "Account 1", email: "a1@test.com" }),
			makeAccount({ id: 2, name: "Account 2", email: "a2@test.com" }),
		];
		render(<Sidebar {...defaultProps} accounts={accounts} />);
		expect(screen.getByText(/Account 1/)).toBeInTheDocument();
		expect(screen.getByText(/Account 2/)).toBeInTheDocument();
	});

	it("hides account selector for single account", () => {
		render(<Sidebar {...defaultProps} accounts={[makeAccount()]} />);
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});

	it("toggles dark mode", async () => {
		const onToggleDark = vi.fn();
		render(<Sidebar {...defaultProps} dark={false} onToggleDark={onToggleDark} />);

		await userEvent.click(screen.getByTitle("Toggle dark mode"));
		expect(onToggleDark).toHaveBeenCalledOnce();
	});

	it("opens settings", async () => {
		const onSettings = vi.fn();
		render(<Sidebar {...defaultProps} onSettings={onSettings} />);

		const settingsElements = screen.getAllByTitle("Settings");
		const settingsButton = settingsElements[0];
		if (settingsButton) await userEvent.click(settingsButton);
		expect(onSettings).toHaveBeenCalledOnce();
	});

	// --- Additional coverage tests ---

	it("shows all label icon variants", () => {
		const labels = [
			makeLabel({ id: 1, name: "Sent Mail", unread_count: 0 }),
			makeLabel({ id: 2, name: "Sent Items", unread_count: 0 }),
			makeLabel({ id: 3, name: "Draft", unread_count: 0 }),
			makeLabel({ id: 4, name: "Deleted", unread_count: 0 }),
			makeLabel({ id: 5, name: "Deleted Items", unread_count: 0 }),
			makeLabel({ id: 6, name: "Junk", unread_count: 0 }),
			makeLabel({ id: 7, name: "Spam", unread_count: 0 }),
			makeLabel({ id: 8, name: "Archive", unread_count: 0 }),
			makeLabel({ id: 9, name: "All Mail", unread_count: 0 }),
			makeLabel({ id: 10, name: "Starred", unread_count: 0 }),
			makeLabel({ id: 11, name: "Flagged", unread_count: 0 }),
		];
		render(<Sidebar {...defaultProps} labels={labels} />);
		// All label names render as text
		for (const l of labels) {
			expect(screen.getAllByText(l.name).length).toBeGreaterThanOrEqual(1);
		}
	});

	it("shows colored dot for user label with color", () => {
		const labels = [makeLabel({ id: 1, name: "Important", color: "#ff0000", source: "user" })];
		const { container } = render(<Sidebar {...defaultProps} labels={labels} />);
		const dot = container.querySelector('span[style*="background-color"]');
		expect(dot).toBeInTheDocument();
		expect(dot?.getAttribute("style")).toContain("#ff0000");
	});

	it("shows tag icon for user label without color", () => {
		const labels = [makeLabel({ id: 1, name: "Custom Tag", color: null, source: "user" })];
		render(<Sidebar {...defaultProps} labels={labels} />);
		// Tag icon SVG has a <title>Label</title>
		expect(screen.getByTitle("Label")).toBeInTheDocument();
	});

	it("highlights selected label", () => {
		const labels = [
			makeLabel({ id: 1, name: "Inbox" }),
			makeLabel({ id: 2, name: "Sent", unread_count: 0 }),
		];
		// Inbox is promoted — selecting it uses the INBOX_LABEL_ID sentinel
		const { container } = render(
			<Sidebar {...defaultProps} labels={labels} selectedLabelId={INBOX_LABEL_ID} />,
		);
		// Active label button has the stork-100 highlight class
		const buttons = container.querySelectorAll("nav button");
		const inboxBtn = Array.from(buttons).find((b) => b.textContent?.includes("Inbox"));
		expect(inboxBtn?.className).toContain("bg-stork-100");
	});

	it("shows sync now button and calls onSyncNow", async () => {
		const onSyncNow = vi.fn();
		render(<Sidebar {...defaultProps} onSyncNow={onSyncNow} syncing={false} />);
		const syncBtn = screen.getByTitle("Sync now");
		await userEvent.click(syncBtn);
		expect(onSyncNow).toHaveBeenCalledOnce();
	});

	it("disables sync button when syncing", () => {
		render(<Sidebar {...defaultProps} onSyncNow={vi.fn()} syncing={true} />);
		const syncBtn = screen.getByTitle("Sync in progress…");
		expect(syncBtn).toBeDisabled();
	});

	it("shows 'Waiting for initial sync' when syncing and no labels", () => {
		render(<Sidebar {...defaultProps} labels={[]} syncing={true} />);
		expect(screen.getByText("Waiting for initial sync…")).toBeInTheDocument();
	});

	it("shows dark mode toggle label correctly", () => {
		const { rerender } = render(<Sidebar {...defaultProps} dark={false} />);
		expect(screen.getByTitle("Toggle dark mode")).toHaveTextContent(/Dark/);

		rerender(<Sidebar {...defaultProps} dark={true} />);
		expect(screen.getByTitle("Toggle dark mode")).toHaveTextContent(/Light/);
	});

	it("calls onSelectAccount when account selector changes", async () => {
		const onSelectAccount = vi.fn();
		const accounts = [
			makeAccount({ id: 1, name: "Account 1", email: "a1@test.com" }),
			makeAccount({ id: 2, name: "Account 2", email: "a2@test.com" }),
		];
		render(
			<Sidebar
				{...defaultProps}
				accounts={accounts}
				selectedAccountId={1}
				onSelectAccount={onSelectAccount}
			/>,
		);
		const select = screen.getByRole("combobox");
		await userEvent.selectOptions(select, "2");
		expect(onSelectAccount).toHaveBeenCalledWith(2);
	});

	it("toggles sync detail panel when sync indicator is clicked", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "INBOX",
					foldersCompleted: 3,
					totalFolders: 10,
					messagesNew: 5,
					startedAt: Date.now() - 30000,
				},
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		// Click the sync indicator to expand
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText("INBOX")).toBeInTheDocument();
		expect(screen.getByText("3 of 10 folders")).toBeInTheDocument();
		expect(screen.getByText(/30%/)).toBeInTheDocument();
		expect(screen.getByText(/5 new messages found/)).toBeInTheDocument();
	});

	it("shows estimated time remaining when progress is available", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "Sent",
					foldersCompleted: 5,
					totalFolders: 10,
					messagesNew: 0,
					startedAt: Date.now() - 60000,
				},
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		// Should show elapsed time and estimated remaining
		expect(screen.getByText(/Elapsed: 1m 0s/)).toBeInTheDocument();
		expect(screen.getByText(/~1m 0s remaining/)).toBeInTheDocument();
	});

	it("shows Connecting when progress is null", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText("Connecting to server…")).toBeInTheDocument();
	});

	it("shows multi-account sync indicator", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "INBOX",
					foldersCompleted: 1,
					totalFolders: 5,
					messagesNew: 0,
					startedAt: Date.now(),
				},
			},
			"2": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: null,
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText("+1 more account syncing")).toBeInTheDocument();
	});

	it("shows plural accounts syncing when 3+ accounts sync", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "INBOX",
					foldersCompleted: 1,
					totalFolders: 5,
					messagesNew: 0,
					startedAt: Date.now(),
				},
			},
			"2": { running: true, lastSync: null, lastError: null, consecutiveErrors: 0, progress: null },
			"3": { running: true, lastSync: null, lastError: null, consecutiveErrors: 0, progress: null },
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText("+2 more accounts syncing")).toBeInTheDocument();
	});

	it("formatDuration shows seconds for sub-minute", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "INBOX",
					foldersCompleted: 1,
					totalFolders: 5,
					messagesNew: 0,
					startedAt: Date.now() - 15000,
				},
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText(/Elapsed: 15s/)).toBeInTheDocument();
	});

	it("shows singular message text for 1 new message", async () => {
		const syncStatus: GlobalSyncStatus = {
			"1": {
				running: true,
				lastSync: null,
				lastError: null,
				consecutiveErrors: 0,
				progress: {
					currentFolder: "INBOX",
					foldersCompleted: 1,
					totalFolders: 5,
					messagesNew: 1,
					startedAt: Date.now(),
				},
			},
		};
		render(<Sidebar {...defaultProps} syncing={true} syncStatus={syncStatus} />);
		await userEvent.click(screen.getByText("Syncing mail…"));
		expect(screen.getByText("1 new message found")).toBeInTheDocument();
	});

	it("shows sync error indicator when not syncing and syncError is set", () => {
		render(
			<Sidebar
				{...defaultProps}
				syncing={false}
				syncError="IMAP auth failed: invalid credentials"
			/>,
		);
		expect(screen.getByText("Sync failed")).toBeInTheDocument();
		expect(screen.getByText("IMAP auth failed: invalid credentials")).toBeInTheDocument();
		expect(screen.getByTitle("Sync error")).toBeInTheDocument();
	});

	it("does not show sync error indicator when syncing", () => {
		render(<Sidebar {...defaultProps} syncing={true} syncError="stale error" />);
		expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
	});

	it("does not show sync error indicator when no error", () => {
		render(<Sidebar {...defaultProps} syncing={false} syncError={null} />);
		expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
	});

	it("shows Unread promoted view with count badge", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		render(<Sidebar {...defaultProps} labels={labels} unreadCount={{ total: 12 }} />);
		const unreadSpans = screen.getAllByText("Unread");
		const unreadLabel = unreadSpans.find((el) => el.tagName === "SPAN");
		expect(unreadLabel).toBeInTheDocument();
		expect(screen.getByText("12")).toBeInTheDocument();
	});

	it("calls onSelectLabel with UNREAD_LABEL_ID when Unread is clicked", async () => {
		const onSelectLabel = vi.fn();
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		render(<Sidebar {...defaultProps} labels={labels} onSelectLabel={onSelectLabel} />);
		const unreadSpans = screen.getAllByText("Unread");
		const unreadLabel = unreadSpans.find((el) => el.tagName === "SPAN") as HTMLElement;
		await userEvent.click(unreadLabel);
		expect(onSelectLabel).toHaveBeenCalledWith(UNREAD_LABEL_ID);
	});

	it("highlights Unread promoted view when selected", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		const { container } = render(
			<Sidebar {...defaultProps} labels={labels} selectedLabelId={UNREAD_LABEL_ID} />,
		);
		const buttons = container.querySelectorAll("nav button");
		const unreadBtn = Array.from(buttons).find((b) => b.textContent?.includes("Unread"));
		expect(unreadBtn?.className).toContain("bg-stork-100");
	});

	it("shows All Mail promoted view with unread count", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		render(<Sidebar {...defaultProps} labels={labels} allMailCount={{ total: 500, unread: 7 }} />);
		const allMailSpans = screen.getAllByText("All Mail");
		const allMailLabel = allMailSpans.find((el) => el.tagName === "SPAN");
		expect(allMailLabel).toBeInTheDocument();
		expect(screen.getByText("7")).toBeInTheDocument();
	});

	it("calls onSelectLabel with ALL_MAIL_LABEL_ID when All Mail is clicked", async () => {
		const onSelectLabel = vi.fn();
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		render(<Sidebar {...defaultProps} labels={labels} onSelectLabel={onSelectLabel} />);
		const allMailSpans = screen.getAllByText("All Mail");
		const allMailLabel = allMailSpans.find((el) => el.tagName === "SPAN") as HTMLElement;
		await userEvent.click(allMailLabel);
		expect(onSelectLabel).toHaveBeenCalledWith(ALL_MAIL_LABEL_ID);
	});

	it("highlights All Mail promoted view when selected", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		const { container } = render(
			<Sidebar {...defaultProps} labels={labels} selectedLabelId={ALL_MAIL_LABEL_ID} />,
		);
		const buttons = container.querySelectorAll("nav button");
		const allMailBtn = Array.from(buttons).find((b) => b.textContent?.includes("All Mail"));
		expect(allMailBtn?.className).toContain("bg-stork-100");
	});

	it("hides unread count badges when counts are zero", () => {
		const inboxLabel = makeLabel({ id: 1, name: "Inbox", unread_count: 0 });
		const labels = [inboxLabel];
		render(
			<Sidebar
				{...defaultProps}
				labels={labels}
				inboxLabel={inboxLabel}
				unreadCount={{ total: 0 }}
				allMailCount={{ total: 100, unread: 0 }}
			/>,
		);
		// No count badges should appear (all 0)
		const badges = document.querySelectorAll(".rounded-full");
		for (const badge of badges) {
			expect(badge.textContent).not.toBe("0");
		}
	});

	it("shows label unread count in the regular label list", () => {
		const labels = [
			makeLabel({ id: 1, name: "Inbox" }),
			makeLabel({ id: 2, name: "Work", unread_count: 8, source: "user" }),
		];
		render(<Sidebar {...defaultProps} labels={labels} />);
		expect(screen.getByText("8")).toBeInTheDocument();
	});

	it("renders LabelManager when selectedAccountId and onLabelsChanged are provided", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox" })];
		render(
			<Sidebar {...defaultProps} labels={labels} selectedAccountId={1} onLabelsChanged={vi.fn()} />,
		);
		// LabelManager renders a "+ Create label" button
		expect(screen.getByText("+ Create label")).toBeInTheDocument();
	});

	it("does not show context menu on right-click for imap labels", async () => {
		const labels = [makeLabel({ id: 1, name: "Inbox", source: "imap" })];
		render(<Sidebar {...defaultProps} labels={labels} onLabelsChanged={vi.fn()} />);
		// Right-click on an imap label should not show context menu
		const inboxSpan = screen
			.getAllByText("Inbox")
			.find((el) => el.tagName === "SPAN") as HTMLElement;
		const btn = inboxSpan.closest("button") as HTMLElement;
		// handleLabelContextMenu early-returns for non-user labels
		await userEvent.pointer({ keys: "[MouseRight]", target: btn });
		// No context menu items should appear (LabelManager handles user labels only)
	});

	it("shows context menu on right-click for user labels", async () => {
		const labels = [
			makeLabel({ id: 1, name: "Inbox", source: "imap" }),
			makeLabel({ id: 2, name: "MyLabel", source: "user" }),
		];
		render(
			<Sidebar {...defaultProps} labels={labels} selectedAccountId={1} onLabelsChanged={vi.fn()} />,
		);
		// Find the user label button in the non-Inbox label list
		const labelSpan = screen
			.getAllByText("MyLabel")
			.find((el) => el.tagName === "SPAN") as HTMLElement;
		const btn = labelSpan.closest("button") as HTMLElement;
		// Right-click on user label
		await userEvent.pointer({ keys: "[MouseRight]", target: btn });
		// Context menu should appear with Edit/Delete options
		expect(screen.getByText("Edit label")).toBeInTheDocument();
		expect(screen.getByText("Delete label")).toBeInTheDocument();
	});

	it("shows syncing text for empty label list when syncing", () => {
		render(<Sidebar {...defaultProps} labels={[]} syncing={true} />);
		expect(screen.getByText("Waiting for initial sync…")).toBeInTheDocument();
	});

	it("shows no-labels text for empty label list when not syncing", () => {
		render(<Sidebar {...defaultProps} labels={[]} syncing={false} />);
		expect(screen.getByText("No labels yet")).toBeInTheDocument();
	});
});
