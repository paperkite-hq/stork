import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../../api";
import { ThreadMessage } from "../ThreadMessage";

// Mock AttachmentList since it has its own data fetching
vi.mock("../AttachmentList", () => ({
	AttachmentList: ({ messageId }: { messageId: number }) => (
		<div data-testid={`attachments-${messageId}`}>Attachments</div>
	),
}));

// Mock email-sanitizer to control hasRemoteImages behavior
const mockHasRemoteImages = vi.fn().mockReturnValue(false);
vi.mock("../../email-sanitizer", () => ({
	sanitizeEmailHtml: (html: string) => html,
	hasRemoteImages: (...args: unknown[]) => mockHasRemoteImages(...args),
	formatFullDate: (d: string) => new Date(d).toLocaleString(),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 1,
		uid: 100,
		message_id: "<msg@example.com>",
		subject: "Test Subject",
		from_address: "alice@example.com",
		from_name: "Alice Smith",
		to_addresses: "bob@example.com",
		date: "2026-01-15T10:30:00Z",
		flags: null,
		size: 1024,
		has_attachments: 0,
		preview: null,
		in_reply_to: null,
		references: null,
		cc_addresses: null,
		bcc_addresses: null,
		text_body: "Hello from Alice",
		html_body: null,
		folder_path: "INBOX",
		folder_name: "Inbox",
		...overrides,
	};
}

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		msg: makeMessage(),
		isThread: false,
		isLast: true,
		expanded: true,
		showHtml: false,
		imagesAllowed: false,
		senderTrusted: false,
		onToggleExpanded: vi.fn(),
		onToggleShowHtml: vi.fn(),
		onAllowImages: vi.fn(),
		onTrustSender: vi.fn(),
		onReply: vi.fn(),
		onReplyAll: vi.fn(),
		onForward: vi.fn(),
		...overrides,
	};
}

describe("ThreadMessage", () => {
	it("renders sender name and email", () => {
		render(<ThreadMessage {...defaultProps()} />);
		expect(screen.getByText("Alice Smith")).toBeInTheDocument();
		expect(screen.getByText(/<alice@example.com>/)).toBeInTheDocument();
	});

	it("renders sender avatar with first letter", () => {
		render(<ThreadMessage {...defaultProps()} />);
		expect(screen.getByText("A")).toBeInTheDocument();
	});

	it("falls back to from_address when from_name is null", () => {
		render(<ThreadMessage {...defaultProps({ msg: makeMessage({ from_name: null }) })} />);
		expect(screen.getByText("alice@example.com")).toBeInTheDocument();
	});

	it("shows text body when expanded", () => {
		render(<ThreadMessage {...defaultProps()} />);
		expect(screen.getByText("Hello from Alice")).toBeInTheDocument();
	});

	it("hides body when not expanded", () => {
		render(<ThreadMessage {...defaultProps({ expanded: false })} />);
		expect(screen.queryByText("Hello from Alice")).not.toBeInTheDocument();
	});

	it("shows (empty message) when no body", () => {
		render(
			<ThreadMessage
				{...defaultProps({ msg: makeMessage({ text_body: null, html_body: null }) })}
			/>,
		);
		expect(screen.getByText("(empty message)")).toBeInTheDocument();
	});

	it("shows reply, reply all, and forward buttons when expanded", () => {
		render(<ThreadMessage {...defaultProps()} />);
		// SVG icons have <title> elements, so accessible names are "Reply Reply", etc.
		expect(screen.getByRole("button", { name: /Reply Reply$/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Reply All/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Forward/i })).toBeInTheDocument();
	});

	it("calls onReply when reply button clicked", () => {
		const onReply = vi.fn();
		render(<ThreadMessage {...defaultProps({ onReply })} />);
		fireEvent.click(screen.getByRole("button", { name: /Reply Reply$/i }));
		expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
	});

	it("calls onReplyAll when reply all button clicked", () => {
		const onReplyAll = vi.fn();
		render(<ThreadMessage {...defaultProps({ onReplyAll })} />);
		fireEvent.click(screen.getByRole("button", { name: /Reply All/i }));
		expect(onReplyAll).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
	});

	it("calls onForward when forward button clicked", () => {
		const onForward = vi.fn();
		render(<ThreadMessage {...defaultProps({ onForward })} />);
		fireEvent.click(screen.getByRole("button", { name: /Forward/i }));
		expect(onForward).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
	});

	it("shows chevron for non-last thread messages", () => {
		render(<ThreadMessage {...defaultProps({ isThread: true, isLast: false, expanded: true })} />);
		// Expanded — aria-label should say "Collapse"
		expect(screen.getByLabelText(/Collapse message from Alice Smith/)).toBeInTheDocument();
	});

	it("calls onToggleExpanded when clicking non-last thread message header", () => {
		const onToggleExpanded = vi.fn();
		render(
			<ThreadMessage {...defaultProps({ isThread: true, isLast: false, onToggleExpanded })} />,
		);
		// expanded=true by default, so label says "Collapse"
		fireEvent.click(screen.getByLabelText(/Collapse message from Alice Smith/));
		expect(onToggleExpanded).toHaveBeenCalledWith(1);
	});

	it("does not show chevron for last message in thread", () => {
		render(<ThreadMessage {...defaultProps({ isThread: true, isLast: true })} />);
		expect(screen.queryByLabelText(/Expand message/)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/Collapse message/)).not.toBeInTheDocument();
	});

	it("shows HTML/plain text toggle when both body types available", () => {
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({ html_body: "<p>Hi</p>", text_body: "Hi" }),
				})}
			/>,
		);
		expect(screen.getByText("Show formatted")).toBeInTheDocument();
	});

	it("calls onToggleShowHtml when toggle button clicked", () => {
		const onToggleShowHtml = vi.fn();
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({ html_body: "<p>Hi</p>", text_body: "Hi" }),
					onToggleShowHtml,
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Show formatted"));
		expect(onToggleShowHtml).toHaveBeenCalled();
	});

	it("shows plain text toggle when in HTML mode", () => {
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({ html_body: "<p>Hi</p>", text_body: "Hi" }),
					showHtml: true,
				})}
			/>,
		);
		expect(screen.getByText("Show plain text")).toBeInTheDocument();
	});

	it("shows To and CC addresses when expanded", () => {
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({
						to_addresses: "bob@example.com",
						cc_addresses: "carol@example.com",
					}),
				})}
			/>,
		);
		expect(screen.getByText(/To:/)).toBeInTheDocument();
		expect(screen.getByText(/CC:/)).toBeInTheDocument();
	});

	it("renders attachment list when has_attachments > 0", () => {
		render(<ThreadMessage {...defaultProps({ msg: makeMessage({ has_attachments: 2 }) })} />);
		expect(screen.getByTestId("attachments-1")).toBeInTheDocument();
	});

	it("does not render attachment list when has_attachments is 0", () => {
		render(<ThreadMessage {...defaultProps()} />);
		expect(screen.queryByTestId("attachments-1")).not.toBeInTheDocument();
	});

	it("shows remote images banner for HTML with remote images", () => {
		mockHasRemoteImages.mockReturnValueOnce(true);
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({
						html_body: '<p>Hi</p><img src="https://tracker.example.com/img.png" />',
					}),
					showHtml: true,
					imagesAllowed: false,
				})}
			/>,
		);
		expect(
			screen.getByText(/Remote images are hidden to protect your privacy/),
		).toBeInTheDocument();
		expect(screen.getByText("Show once")).toBeInTheDocument();
	});

	it("calls onAllowImages when Show images clicked", () => {
		mockHasRemoteImages.mockReturnValueOnce(true);
		const onAllowImages = vi.fn();
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({
						html_body: '<p>Hi</p><img src="https://example.com/img.png" />',
					}),
					showHtml: true,
					imagesAllowed: false,
					onAllowImages,
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Show once"));
		expect(onAllowImages).toHaveBeenCalledWith(1);
	});

	it("does not show remote images banner when images allowed", () => {
		mockHasRemoteImages.mockReturnValueOnce(true);
		render(
			<ThreadMessage
				{...defaultProps({
					msg: makeMessage({
						html_body: '<p>Hi</p><img src="https://example.com/img.png" />',
					}),
					showHtml: true,
					imagesAllowed: true,
				})}
			/>,
		);
		expect(
			screen.queryByText(/Remote images are hidden to protect your privacy/),
		).not.toBeInTheDocument();
	});
});
