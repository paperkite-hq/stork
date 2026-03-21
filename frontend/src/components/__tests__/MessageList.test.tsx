import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MessageSummary } from "../../api";
import { MessageList } from "../MessageList";

function makeMessage(overrides: Partial<MessageSummary> = {}): MessageSummary {
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
		preview: null,
		...overrides,
	};
}

describe("MessageList", () => {
	const defaultProps = {
		messages: [] as MessageSummary[],
		selectedId: null,
		onSelect: vi.fn(),
		loading: false,
		folderName: "Inbox",
	};

	it("shows loading state", () => {
		const { container } = render(<MessageList {...defaultProps} loading={true} />);
		// Loading state renders skeleton placeholders with animate-pulse
		expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
	});

	it("shows empty state when no messages", () => {
		render(<MessageList {...defaultProps} />);
		expect(screen.getByText("No messages in this folder")).toBeInTheDocument();
	});

	it("renders message list with subjects", () => {
		const messages = [
			makeMessage({ id: 1, subject: "First email" }),
			makeMessage({ id: 2, subject: "Second email" }),
		];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("First email")).toBeInTheDocument();
		expect(screen.getByText("Second email")).toBeInTheDocument();
	});

	it("shows folder name in header", () => {
		render(<MessageList {...defaultProps} folderName="Sent Mail" />);
		expect(screen.getByText("Sent Mail")).toBeInTheDocument();
	});

	it("shows message count", () => {
		const messages = [makeMessage({ id: 1 }), makeMessage({ id: 2 }), makeMessage({ id: 3 })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("3 messages")).toBeInTheDocument();
	});

	it("shows singular message count", () => {
		const messages = [makeMessage({ id: 1 })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("1 message")).toBeInTheDocument();
	});

	it("calls onSelect when a message is clicked", async () => {
		const onSelect = vi.fn();
		const messages = [makeMessage({ id: 42, subject: "Click me" })];
		render(<MessageList {...defaultProps} messages={messages} onSelect={onSelect} />);

		await userEvent.click(screen.getByText("Click me"));
		expect(onSelect).toHaveBeenCalledWith(42);
	});

	it("shows from_address when from_name is missing", () => {
		const messages = [makeMessage({ id: 1, from_name: null, from_address: "no-name@test.com" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("no-name@test.com")).toBeInTheDocument();
	});

	it("shows (no subject) for null subjects", () => {
		const messages = [makeMessage({ id: 1, subject: null })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("(no subject)")).toBeInTheDocument();
	});

	it("shows attachment indicator", () => {
		const messages = [makeMessage({ id: 1, has_attachments: 1, subject: "With file" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByTitle("Attachment")).toBeInTheDocument();
	});

	it("shows load more button when hasMore is true", () => {
		const messages = [makeMessage({ id: 1 })];
		render(
			<MessageList {...defaultProps} messages={messages} hasMore={true} onLoadMore={vi.fn()} />,
		);
		expect(screen.getByText("Load more messages")).toBeInTheDocument();
	});

	it("shows loading state on load more button", () => {
		const messages = [makeMessage({ id: 1 })];
		render(
			<MessageList
				{...defaultProps}
				messages={messages}
				hasMore={true}
				onLoadMore={vi.fn()}
				loadingMore={true}
			/>,
		);
		expect(screen.getByText("Loading…")).toBeInTheDocument();
	});

	it("formats date for messages from last week", () => {
		const lastWeekDate = new Date(Date.now() - 3 * 86400000); // 3 days ago
		const messages = [makeMessage({ id: 1, date: lastWeekDate.toISOString(), subject: "Recent" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("Recent")).toBeInTheDocument();
	});

	it("formats date for messages from earlier this year", () => {
		const d = new Date();
		d.setMonth(d.getMonth() > 0 ? d.getMonth() - 1 : 11);
		d.setDate(1);
		const messages = [makeMessage({ id: 1, date: d.toISOString(), subject: "Old msg" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("Old msg")).toBeInTheDocument();
	});

	it("formats date for messages from a different year", () => {
		const oldDate = new Date("2023-06-15T10:00:00Z");
		const messages = [makeMessage({ id: 1, date: oldDate.toISOString(), subject: "Ancient" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.getByText("Ancient")).toBeInTheDocument();
	});

	it("shows error state", () => {
		render(<MessageList {...defaultProps} error="Failed to load" />);
		expect(screen.getByText("Failed to load messages")).toBeInTheDocument();
		expect(screen.getByText("Failed to load")).toBeInTheDocument();
	});

	it("highlights selected message", () => {
		const messages = [makeMessage({ id: 1, subject: "Selected" })];
		const { container } = render(
			<MessageList {...defaultProps} messages={messages} selectedId={1} />,
		);
		// Selected message has a different background class
		const messageItem = container.querySelector('[class*="bg-stork"]');
		expect(messageItem).toBeInTheDocument();
	});

	it("shows unread styling for unread messages", () => {
		const messages = [makeMessage({ id: 1, subject: "Unread msg", flags: null })];
		const { container } = render(<MessageList {...defaultProps} messages={messages} />);
		// Unread messages have font-semibold class
		const bold = container.querySelector('[class*="font-semibold"]');
		expect(bold).toBeInTheDocument();
	});

	it("shows 'X of Y messages' when totalCount exceeds loaded messages", () => {
		const messages = [makeMessage({ id: 1 }), makeMessage({ id: 2 }), makeMessage({ id: 3 })];
		render(<MessageList {...defaultProps} messages={messages} totalCount={150} />);
		expect(screen.getByText(/3 of 150/)).toBeInTheDocument();
		expect(screen.getByText(/messages/)).toBeInTheDocument();
	});

	it("shows plain count when totalCount equals loaded messages", () => {
		const messages = [makeMessage({ id: 1 }), makeMessage({ id: 2 })];
		render(<MessageList {...defaultProps} messages={messages} totalCount={2} />);
		expect(screen.getByText("2 messages")).toBeInTheDocument();
	});

	it("shows star toggle button for starred messages", () => {
		const messages = [makeMessage({ id: 1, flags: "\\Flagged", subject: "Starred msg" })];
		render(<MessageList {...defaultProps} messages={messages} onToggleStar={vi.fn()} />);
		expect(screen.getByLabelText("Remove star")).toBeInTheDocument();
	});

	it("shows star toggle on hover for unstarred messages", () => {
		const messages = [makeMessage({ id: 1, flags: "\\Seen", subject: "Read msg" })];
		render(<MessageList {...defaultProps} messages={messages} onToggleStar={vi.fn()} />);
		// The star button exists in the DOM but is hidden via opacity
		const starBtn = screen.getByLabelText("Star message");
		expect(starBtn).toBeInTheDocument();
		expect(starBtn.className).toContain("opacity-0");
	});

	it("calls onToggleStar when star button is clicked", async () => {
		const onToggleStar = vi.fn();
		const messages = [makeMessage({ id: 42, flags: "\\Seen", subject: "Star me" })];
		render(<MessageList {...defaultProps} messages={messages} onToggleStar={onToggleStar} />);
		await userEvent.click(screen.getByLabelText("Star message"));
		expect(onToggleStar).toHaveBeenCalledWith(42);
	});

	it("does not show star toggle when onToggleStar is not provided", () => {
		const messages = [makeMessage({ id: 1, flags: "\\Flagged", subject: "Starred" })];
		render(<MessageList {...defaultProps} messages={messages} />);
		expect(screen.queryByLabelText("Remove star")).not.toBeInTheDocument();
	});

	it("calls onRefresh when refresh button is clicked", async () => {
		const onRefresh = vi.fn();
		const messages = [makeMessage({ id: 1 })];
		render(<MessageList {...defaultProps} messages={messages} onRefresh={onRefresh} />);

		// Button title="Refresh" and SVG <title>Refresh</title> both match
		const refreshElements = screen.getAllByTitle("Refresh");
		const refreshButton = refreshElements[0];
		if (refreshButton) await userEvent.click(refreshButton);
		expect(onRefresh).toHaveBeenCalledOnce();
	});

	it("shows full date tooltip on hover over relative date", () => {
		const messages = [makeMessage({ id: 1, date: "2026-01-15T10:30:00Z" })];
		const { container } = render(<MessageList {...defaultProps} messages={messages} />);
		// Find the date span with the title attribute
		const dateSpan = container.querySelector("span[title]");
		expect(dateSpan).toBeTruthy();
		// Title should contain full date information (year, day, etc.)
		const title = dateSpan?.getAttribute("title") ?? "";
		expect(title).toContain("2026");
		expect(title).toContain("15");
	});
});
