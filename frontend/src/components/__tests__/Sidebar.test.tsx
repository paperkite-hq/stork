import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account, Label } from "../../api";
import { Sidebar } from "../Sidebar";

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

	it("renders search button", async () => {
		const onSearch = vi.fn();
		render(<Sidebar {...defaultProps} onSearch={onSearch} />);

		const searchBtn = screen.getByText("Search mail…");
		await userEvent.click(searchBtn);
		expect(onSearch).toHaveBeenCalledOnce();
	});

	it("renders label list with icons", () => {
		const labels = [
			makeLabel({ id: 1, name: "Inbox" }),
			makeLabel({ id: 2, name: "Sent", unread_count: 0 }),
			makeLabel({ id: 3, name: "Trash", unread_count: 0 }),
		];
		render(<Sidebar {...defaultProps} labels={labels} />);
		// Label names appear both in SVG <title> and <span> — use getAllByText
		expect(screen.getAllByText("Inbox").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Sent").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Trash").length).toBeGreaterThanOrEqual(1);
	});

	it("shows unread count badges", () => {
		const labels = [makeLabel({ id: 1, name: "Inbox", unread_count: 5 })];
		render(<Sidebar {...defaultProps} labels={labels} />);
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("calls onSelectLabel when a label is clicked", async () => {
		const onSelectLabel = vi.fn();
		const labels = [makeLabel({ id: 42, name: "Drafts" })];
		render(<Sidebar {...defaultProps} labels={labels} onSelectLabel={onSelectLabel} />);

		// "Drafts" appears in both SVG <title> and <span> — click the span
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

		// Both button (title="Settings") and SVG child (<title>Settings</title>) match
		const settingsElements = screen.getAllByTitle("Settings");
		const settingsButton = settingsElements[0];
		if (settingsButton) await userEvent.click(settingsButton);
		expect(onSettings).toHaveBeenCalledOnce();
	});
});
