import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Folder, Message } from "../../api";
import { MessageHeaderActions } from "../MessageHeaderActions";

// Mock the api module
vi.mock("../../api", () => ({
	api: {
		messages: {
			updateFlags: vi.fn().mockResolvedValue({}),
			move: vi.fn().mockResolvedValue({}),
		},
	},
}));

// Mock toast
vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

// Mock LabelManager since it has its own tests
vi.mock("../LabelManager", () => ({
	MessageLabelPicker: ({
		messageId,
		onLabelsChanged,
	}: { messageId: number; onLabelsChanged?: () => void }) => (
		<div data-testid={`label-picker-${messageId}`}>
			<button type="button" onClick={onLabelsChanged}>
				Change Labels
			</button>
		</div>
	),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 1,
		uid: 100,
		message_id: "<msg@example.com>",
		subject: "Test Subject",
		from_address: "sender@example.com",
		from_name: "Sender",
		to_addresses: "recipient@example.com",
		date: "2026-01-15T10:30:00Z",
		flags: null,
		size: 1024,
		has_attachments: 0,
		preview: null,
		in_reply_to: null,
		references: null,
		cc_addresses: null,
		bcc_addresses: null,
		text_body: "Hello",
		html_body: null,
		folder_path: "INBOX",
		folder_name: "Inbox",
		...overrides,
	};
}

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
];

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		message: makeMessage(),
		folders: mockFolders,
		identityId: 1,
		onMessageChanged: vi.fn(),
		onMessageDeleted: vi.fn(),
		onLabelsChanged: vi.fn(),
		onRequestDelete: vi.fn(),
		...overrides,
	};
}

describe("MessageHeaderActions", () => {
	it("renders star button with correct title for unstarred message", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		expect(screen.getByTitle("Star message")).toBeInTheDocument();
	});

	it("renders star button with correct title for starred message", () => {
		render(
			<MessageHeaderActions {...defaultProps({ message: makeMessage({ flags: "\\Flagged" }) })} />,
		);
		expect(screen.getByTitle("Remove star")).toBeInTheDocument();
	});

	it("renders mark read button for unread message", () => {
		render(<MessageHeaderActions {...defaultProps({ message: makeMessage({ flags: null }) })} />);
		expect(screen.getByTitle("Mark as read")).toBeInTheDocument();
		expect(screen.getByText("Mark read")).toBeInTheDocument();
	});

	it("renders mark unread button for read message", () => {
		render(
			<MessageHeaderActions {...defaultProps({ message: makeMessage({ flags: "\\Seen" }) })} />,
		);
		expect(screen.getByTitle("Mark as unread")).toBeInTheDocument();
		expect(screen.getByText("Mark unread")).toBeInTheDocument();
	});

	it("calls api.messages.updateFlags when toggling star", async () => {
		const { api } = await import("../../api");
		const onMessageChanged = vi.fn();
		render(<MessageHeaderActions {...defaultProps({ onMessageChanged })} />);
		fireEvent.click(screen.getByTitle("Star message"));
		await waitFor(() =>
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { add: ["\\Flagged"] }),
		);
		expect(onMessageChanged).toHaveBeenCalled();
	});

	it("calls api.messages.updateFlags when toggling read", async () => {
		const { api } = await import("../../api");
		const onMessageChanged = vi.fn();
		render(<MessageHeaderActions {...defaultProps({ onMessageChanged })} />);
		// Default message has no flags (unread), so clicking should mark as read
		fireEvent.click(screen.getByTitle("Mark as read"));
		await waitFor(() =>
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { add: ["\\Seen"] }),
		);
		expect(onMessageChanged).toHaveBeenCalled();
	});

	it("shows error toast when star toggle fails", async () => {
		const { api } = await import("../../api");
		const { toast } = await import("../Toast");
		(api.messages.updateFlags as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
		render(<MessageHeaderActions {...defaultProps()} />);
		fireEvent.click(screen.getByTitle("Star message"));
		await waitFor(() => expect(toast).toHaveBeenCalledWith("Failed to update star", "error"));
	});

	it("shows error toast when read toggle fails", async () => {
		const { api } = await import("../../api");
		const { toast } = await import("../Toast");
		(api.messages.updateFlags as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
		render(<MessageHeaderActions {...defaultProps()} />);
		fireEvent.click(screen.getByTitle("Mark as read"));
		await waitFor(() =>
			expect(toast).toHaveBeenCalledWith("Failed to update read status", "error"),
		);
	});

	it("renders delete button", () => {
		const onRequestDelete = vi.fn();
		render(<MessageHeaderActions {...defaultProps({ onRequestDelete })} />);
		fireEvent.click(screen.getByTitle("Delete message"));
		expect(onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
	});

	it("renders move-to-folder button when folders provided", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		expect(screen.getByTitle("Move to folder")).toBeInTheDocument();
	});

	it("does not render move button when no folders", () => {
		render(<MessageHeaderActions {...defaultProps({ folders: [] })} />);
		expect(screen.queryByTitle("Move to folder")).not.toBeInTheDocument();
	});

	it("opens move menu on click and shows folder options", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		fireEvent.click(screen.getByTitle("Move to folder"));
		expect(screen.getByRole("menu")).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Inbox" })).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
	});

	it("calls api.messages.move when selecting a folder", async () => {
		const { api } = await import("../../api");
		const onMessageDeleted = vi.fn();
		render(<MessageHeaderActions {...defaultProps({ onMessageDeleted })} />);
		fireEvent.click(screen.getByTitle("Move to folder"));
		fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
		await waitFor(() => expect(api.messages.move).toHaveBeenCalledWith(1, 2));
		expect(onMessageDeleted).toHaveBeenCalled();
	});

	it("closes move menu on outside click", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		fireEvent.click(screen.getByTitle("Move to folder"));
		expect(screen.getByRole("menu")).toBeInTheDocument();
		// Click outside
		fireEvent.mouseDown(document.body);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});

	it("always renders label picker regardless of identityId", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		expect(screen.getByTestId("label-picker-1")).toBeInTheDocument();
	});

	it("shows error toast when move fails", async () => {
		const { api } = await import("../../api");
		const { toast } = await import("../Toast");
		(api.messages.move as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Network error"),
		);
		render(<MessageHeaderActions {...defaultProps()} />);
		fireEvent.click(screen.getByTitle("Move to folder"));
		fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
		await waitFor(() => expect(toast).toHaveBeenCalledWith("Failed to move message", "error"));
	});

	it("fires onLabelsChanged and onMessageChanged when label picker callback fires", async () => {
		const onLabelsChanged = vi.fn();
		const onMessageChanged = vi.fn();
		render(
			<MessageHeaderActions
				{...defaultProps({ identityId: 1, onLabelsChanged, onMessageChanged })}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Change Labels" }));
		await waitFor(() => {
			expect(onLabelsChanged).toHaveBeenCalled();
			expect(onMessageChanged).toHaveBeenCalled();
		});
	});

	it("has correct aria-expanded on move button", () => {
		render(<MessageHeaderActions {...defaultProps()} />);
		const btn = screen.getByTitle("Move to folder");
		expect(btn).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(btn);
		expect(btn).toHaveAttribute("aria-expanded", "true");
	});
});
