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
});
