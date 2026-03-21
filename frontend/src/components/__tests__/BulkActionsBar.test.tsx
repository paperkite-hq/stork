import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Folder } from "../../api";
import { BulkActionsBar } from "../BulkActionsBar";

const mockFolders: Folder[] = [
	{
		id: 1,
		path: "INBOX",
		name: "Inbox",
		special_use: null,
		message_count: 5,
		unread_count: 2,
		last_synced_at: null,
	},
	{
		id: 2,
		path: "Archive",
		name: "Archive",
		special_use: "\\Archive",
		message_count: 10,
		unread_count: 0,
		last_synced_at: null,
	},
	{
		id: 3,
		path: "Trash",
		name: "Trash",
		special_use: "\\Trash",
		message_count: 0,
		unread_count: 0,
		last_synced_at: null,
	},
];

function defaultProps(overrides = {}) {
	return {
		count: 3,
		total: 10,
		allSelected: false,
		onSelectAll: vi.fn(),
		onClearSelection: vi.fn(),
		onDelete: vi.fn(),
		onMarkRead: vi.fn(),
		onMarkUnread: vi.fn(),
		onMove: vi.fn(),
		folders: mockFolders,
		...overrides,
	};
}

describe("BulkActionsBar", () => {
	it("displays selected count", () => {
		render(<BulkActionsBar {...defaultProps({ count: 5 })} />);
		expect(screen.getByText(/5 selected/i)).toBeInTheDocument();
	});

	it('shows "Select all N" when not all selected', () => {
		render(<BulkActionsBar {...defaultProps({ count: 3, total: 10, allSelected: false })} />);
		expect(screen.getByText(/Select all 10/i)).toBeInTheDocument();
	});

	it('hides "Select all" when all selected', () => {
		render(<BulkActionsBar {...defaultProps({ allSelected: true })} />);
		expect(screen.queryByText(/Select all/i)).not.toBeInTheDocument();
	});

	it("calls onSelectAll when select-all button clicked", () => {
		const onSelectAll = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onSelectAll })} />);
		fireEvent.click(screen.getByText(/Select all 10/i));
		expect(onSelectAll).toHaveBeenCalledTimes(1);
	});

	it("calls onClearSelection when clear button clicked", () => {
		const onClearSelection = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onClearSelection })} />);
		fireEvent.click(screen.getByTitle("Clear selection"));
		expect(onClearSelection).toHaveBeenCalledTimes(1);
	});

	it("calls onDelete when delete button clicked", () => {
		const onDelete = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onDelete })} />);
		fireEvent.click(screen.getByTitle("Delete selected"));
		expect(onDelete).toHaveBeenCalledTimes(1);
	});

	it("calls onMarkRead when mark-read button clicked", () => {
		const onMarkRead = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onMarkRead })} />);
		fireEvent.click(screen.getByTitle("Mark as read"));
		expect(onMarkRead).toHaveBeenCalledTimes(1);
	});

	it("calls onMarkUnread when mark-unread button clicked", () => {
		const onMarkUnread = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onMarkUnread })} />);
		fireEvent.click(screen.getByTitle("Mark as unread"));
		expect(onMarkUnread).toHaveBeenCalledTimes(1);
	});

	it("calls onArchive when archive button clicked", () => {
		const onArchive = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onArchive })} />);
		fireEvent.click(screen.getByTitle("Archive selected"));
		expect(onArchive).toHaveBeenCalledTimes(1);
	});

	it("hides archive button when onArchive not provided", () => {
		render(<BulkActionsBar {...defaultProps()} />);
		expect(screen.queryByTitle("Archive selected")).not.toBeInTheDocument();
	});

	it("renders the bulk actions bar with testid", () => {
		render(<BulkActionsBar {...defaultProps()} />);
		expect(screen.getByTestId("bulk-actions-bar")).toBeInTheDocument();
	});

	it("hides folder button when no folders provided", () => {
		render(<BulkActionsBar {...defaultProps({ folders: [] })} />);
		expect(screen.queryByTitle("Move to folder")).not.toBeInTheDocument();
	});

	it("calls onMove with folder id when a folder in the dropdown is clicked", () => {
		const onMove = vi.fn();
		const singleFolder: Folder[] = [
			{
				id: 5,
				path: "Custom",
				name: "CustomFolder",
				special_use: null,
				message_count: 0,
				unread_count: 0,
				last_synced_at: null,
			},
		];
		render(<BulkActionsBar {...defaultProps({ onMove, folders: singleFolder })} />);
		// Open the dropdown first (now click-based, not CSS hover)
		fireEvent.click(screen.getByTitle("Move to folder"));
		fireEvent.click(screen.getByText("CustomFolder"));
		expect(onMove).toHaveBeenCalledWith(5);
	});

	it("closes move dropdown after selecting a folder", () => {
		const onMove = vi.fn();
		render(<BulkActionsBar {...defaultProps({ onMove })} />);
		fireEvent.click(screen.getByTitle("Move to folder"));
		expect(screen.getByRole("menu")).toBeInTheDocument();
		fireEvent.click(screen.getByText("Inbox"));
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});

	it("toggles move dropdown open and closed on button click", () => {
		render(<BulkActionsBar {...defaultProps()} />);
		const btn = screen.getByTitle("Move to folder");
		fireEvent.click(btn);
		expect(screen.getByRole("menu")).toBeInTheDocument();
		fireEvent.click(btn);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});
});
