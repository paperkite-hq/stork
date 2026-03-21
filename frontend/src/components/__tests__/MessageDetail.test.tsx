import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, Message } from "../../api";
import { MessageDetail } from "../MessageDetail";

// Mock the api module
vi.mock("../../api", () => ({
	api: {
		messages: {
			updateFlags: vi.fn().mockResolvedValue({ ok: true, flags: "\\Seen" }),
			delete: vi.fn().mockResolvedValue({ ok: true }),
			attachments: vi.fn().mockResolvedValue([]),
			move: vi.fn().mockResolvedValue({ ok: true }),
			labels: vi.fn().mockResolvedValue([]),
			addLabels: vi.fn().mockResolvedValue({ ok: true }),
			removeLabel: vi.fn().mockResolvedValue({ ok: true }),
		},
		labels: {
			list: vi.fn().mockResolvedValue([]),
		},
	},
}));

// Mock toast
vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 1,
		uid: 1,
		message_id: "<msg1@test>",
		subject: "Test Subject",
		from_address: "sender@test.com",
		from_name: "Test Sender",
		to_addresses: "me@test.com",
		cc_addresses: null,
		bcc_addresses: null,
		in_reply_to: null,
		references: null,
		date: "2026-01-15T10:00:00Z",
		text_body: "Hello, this is a test email body.",
		html_body: null,
		flags: null,
		size: 1000,
		has_attachments: 0,
		preview: null,
		folder_path: "INBOX",
		folder_name: "Inbox",
		...overrides,
	};
}

const defaultProps = {
	message: makeMessage(),
	thread: [],
	loading: false,
	onReply: vi.fn(),
	onReplyAll: vi.fn(),
	onForward: vi.fn(),
	onBack: vi.fn(),
	onMessageChanged: vi.fn(),
	onMessageDeleted: vi.fn(),
};

describe("MessageDetail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows loading skeleton", () => {
		const { container } = render(<MessageDetail {...defaultProps} message={null} loading={true} />);
		// Loading state renders animated skeleton placeholders
		const pulsingElements = container.querySelectorAll(".animate-pulse");
		expect(pulsingElements.length).toBeGreaterThan(0);
	});

	it("shows empty state when no message selected", () => {
		render(<MessageDetail {...defaultProps} message={null} loading={false} />);
		expect(screen.getByText("Select a message to read")).toBeInTheDocument();
	});

	it("renders message subject", () => {
		render(<MessageDetail {...defaultProps} />);
		expect(screen.getByText("Test Subject")).toBeInTheDocument();
	});

	it("renders (no subject) when subject is empty", () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ subject: "" })} />);
		expect(screen.getByText("(no subject)")).toBeInTheDocument();
	});

	it("renders sender name and address", () => {
		render(<MessageDetail {...defaultProps} />);
		expect(screen.getByText("Test Sender")).toBeInTheDocument();
		expect(screen.getByText(/sender@test\.com/)).toBeInTheDocument();
	});

	it("renders text body", () => {
		render(<MessageDetail {...defaultProps} />);
		expect(screen.getByText("Hello, this is a test email body.")).toBeInTheDocument();
	});

	it("renders (empty message) when no body", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ text_body: null, html_body: null })}
			/>,
		);
		expect(screen.getByText("(empty message)")).toBeInTheDocument();
	});

	it("renders HTML body when available", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: "<p>Formatted <strong>content</strong></p>",
					text_body: "Formatted content",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content");
		expect(emailContent).toBeInTheDocument();
	});

	it("forces all links in HTML body to open in a new tab", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<a href="https://example.com">Click me</a>',
					text_body: "Click me",
				})}
			/>,
		);
		const link = container.querySelector(".email-content a") as HTMLAnchorElement | null;
		expect(link).toBeInTheDocument();
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("adds target and rel even to links that already have a different target", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<a href="https://example.com" target="_self">Click</a>',
					text_body: "Click",
				})}
			/>,
		);
		const link = container.querySelector(".email-content a") as HTMLAnchorElement | null;
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("shows toggle between HTML and plain text", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: "<p>HTML version</p>",
					text_body: "Plain version",
				})}
			/>,
		);
		expect(screen.getByText("Show plain text")).toBeInTheDocument();
	});

	it("toggles between HTML and plain text view", async () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: "<p>HTML version</p>",
					text_body: "Plain version",
				})}
			/>,
		);
		await userEvent.click(screen.getByText("Show plain text"));
		expect(screen.getByText("Plain version")).toBeInTheDocument();
		expect(screen.getByText("Show formatted")).toBeInTheDocument();
	});

	it("calls onReply when Reply button is clicked", async () => {
		const onReply = vi.fn();
		render(<MessageDetail {...defaultProps} onReply={onReply} />);
		const buttons = screen.getAllByRole("button");
		const replyBtn = buttons.find(
			(btn) =>
				btn.textContent?.includes("Reply") &&
				!btn.textContent?.includes("All") &&
				!btn.textContent?.includes("Mark"),
		) as HTMLElement;
		expect(replyBtn).toBeTruthy();
		await userEvent.click(replyBtn);
		expect(onReply).toHaveBeenCalledWith(defaultProps.message);
	});

	it("calls onReplyAll when Reply All button is clicked", async () => {
		const onReplyAll = vi.fn();
		render(<MessageDetail {...defaultProps} onReplyAll={onReplyAll} />);
		const buttons = screen.getAllByRole("button");
		const replyAllBtn = buttons.find((btn) =>
			btn.textContent?.includes("Reply All"),
		) as HTMLElement;
		expect(replyAllBtn).toBeTruthy();
		await userEvent.click(replyAllBtn);
		expect(onReplyAll).toHaveBeenCalledWith(defaultProps.message);
	});

	it("calls onForward when Forward button is clicked", async () => {
		const onForward = vi.fn();
		render(<MessageDetail {...defaultProps} onForward={onForward} />);
		const buttons = screen.getAllByRole("button");
		const forwardBtn = buttons.find((btn) => btn.textContent?.includes("Forward")) as HTMLElement;
		expect(forwardBtn).toBeTruthy();
		await userEvent.click(forwardBtn);
		expect(onForward).toHaveBeenCalledWith(defaultProps.message);
	});

	it("calls onBack when Back button is clicked", async () => {
		const onBack = vi.fn();
		render(<MessageDetail {...defaultProps} onBack={onBack} />);
		await userEvent.click(screen.getByText("← Back"));
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("shows star button reflecting unflagged state", () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: null })} />);
		expect(screen.getByTitle("Star message")).toBeInTheDocument();
	});

	it("shows star button reflecting flagged state", () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: "\\Flagged" })} />);
		expect(screen.getByTitle("Remove star")).toBeInTheDocument();
	});

	it("shows mark read/unread button for unread message", () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: null })} />);
		expect(screen.getByTitle("Mark as read")).toBeInTheDocument();
	});

	it("shows mark read/unread button for read message", () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: "\\Seen" })} />);
		expect(screen.getByTitle("Mark as unread")).toBeInTheDocument();
	});

	it("renders thread count when thread has multiple messages", () => {
		const msg1 = makeMessage({ id: 1 });
		const msg2 = makeMessage({ id: 2, subject: "Re: Test Subject" });
		render(<MessageDetail {...defaultProps} message={msg1} thread={[msg1, msg2]} />);
		expect(screen.getByText("2 messages")).toBeInTheDocument();
	});

	it("does not show thread count for single message", () => {
		render(<MessageDetail {...defaultProps} thread={[]} />);
		expect(screen.queryByText(/messages$/)).not.toBeInTheDocument();
	});

	it("shows To addresses in expanded message", () => {
		render(<MessageDetail {...defaultProps} />);
		expect(screen.getByText(/To: me@test\.com/)).toBeInTheDocument();
	});

	it("shows CC addresses when present", () => {
		render(
			<MessageDetail {...defaultProps} message={makeMessage({ cc_addresses: "cc@test.com" })} />,
		);
		expect(screen.getByText(/CC: cc@test\.com/)).toBeInTheDocument();
	});

	it("renders delete button", () => {
		render(<MessageDetail {...defaultProps} />);
		expect(screen.getByTitle("Delete message")).toBeInTheDocument();
	});

	// --- Additional coverage tests ---

	it("toggles star and calls onMessageChanged", async () => {
		const onMessageChanged = vi.fn();
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ flags: null })}
				onMessageChanged={onMessageChanged}
			/>,
		);
		await userEvent.click(screen.getByTitle("Star message"));
		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { add: ["\\Flagged"] });
		});
		expect(onMessageChanged).toHaveBeenCalled();
	});

	it("removes star on flagged message", async () => {
		render(
			<MessageDetail {...defaultProps} message={makeMessage({ flags: "\\Flagged,\\Seen" })} />,
		);
		await userEvent.click(screen.getByTitle("Remove star"));
		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { remove: ["\\Flagged"] });
		});
	});

	it("toggles read status", async () => {
		const onMessageChanged = vi.fn();
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ flags: null })}
				onMessageChanged={onMessageChanged}
			/>,
		);
		await userEvent.click(screen.getByTitle("Mark as read"));
		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { add: ["\\Seen"] });
		});
	});

	it("toggles unread status on read message", async () => {
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: "\\Seen" })} />);
		await userEvent.click(screen.getByTitle("Mark as unread"));
		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.messages.updateFlags).toHaveBeenCalledWith(1, { remove: ["\\Seen"] });
		});
	});

	it("shows delete confirmation and deletes on confirm", async () => {
		const onMessageDeleted = vi.fn();
		render(<MessageDetail {...defaultProps} onMessageDeleted={onMessageDeleted} />);
		await userEvent.click(screen.getByTitle("Delete message"));
		expect(screen.getByText("Delete message")).toBeInTheDocument();
		expect(
			screen.getByText("This will permanently delete this message. This action cannot be undone."),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));
		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.messages.delete).toHaveBeenCalledWith(1);
		});
		expect(onMessageDeleted).toHaveBeenCalled();
	});

	it("cancels delete confirmation", async () => {
		render(<MessageDetail {...defaultProps} />);
		await userEvent.click(screen.getByTitle("Delete message"));
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			screen.queryByText("This will permanently delete this message."),
		).not.toBeInTheDocument();
	});

	it("shows error state", () => {
		render(
			<MessageDetail {...defaultProps} message={null} loading={false} error="Connection refused" />,
		);
		expect(screen.getByText("Failed to load message")).toBeInTheDocument();
		expect(screen.getByText("Connection refused")).toBeInTheDocument();
		expect(screen.getByText("← Back to list")).toBeInTheDocument();
	});

	it("back to list button in error state calls onBack", async () => {
		const onBack = vi.fn();
		render(
			<MessageDetail
				{...defaultProps}
				message={null}
				loading={false}
				error="Error"
				onBack={onBack}
			/>,
		);
		await userEvent.click(screen.getByText("← Back to list"));
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("shows move to folder button when folders are provided", () => {
		const folders: Folder[] = [
			{
				id: 1,
				path: "INBOX",
				name: "Inbox",
				special_use: null,
				message_count: 10,
				unread_count: 2,
				last_synced_at: null,
			},
			{
				id: 2,
				path: "Trash",
				name: "Trash",
				special_use: "\\Trash",
				message_count: 0,
				unread_count: 0,
				last_synced_at: null,
			},
		];
		render(<MessageDetail {...defaultProps} folders={folders} />);
		expect(screen.getByTitle("Move to folder")).toBeInTheDocument();
	});

	it("opens move menu and moves message to folder", async () => {
		const onMessageDeleted = vi.fn();
		const folders: Folder[] = [
			{
				id: 1,
				path: "INBOX",
				name: "Inbox",
				special_use: null,
				message_count: 10,
				unread_count: 2,
				last_synced_at: null,
			},
			{
				id: 2,
				path: "Trash",
				name: "Trash",
				special_use: "\\Trash",
				message_count: 0,
				unread_count: 0,
				last_synced_at: null,
			},
		];
		render(
			<MessageDetail {...defaultProps} folders={folders} onMessageDeleted={onMessageDeleted} />,
		);
		await userEvent.click(screen.getByTitle("Move to folder"));
		// Folder dropdown should appear
		// Find the Trash button in the dropdown (not the header)
		const trashButtons = screen.getAllByText("Trash");
		const dropdownTrash = trashButtons.find(
			(el) => el.tagName === "BUTTON" && el.className.includes("text-left"),
		) as HTMLElement;
		if (dropdownTrash) {
			await userEvent.click(dropdownTrash);
			const { api } = await import("../../api");
			await waitFor(() => {
				expect(api.messages.move).toHaveBeenCalledWith(1, 2);
			});
		}
	});

	it("shows attachments when message has attachments", async () => {
		const { api } = await import("../../api");
		(api.messages.attachments as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{
				id: 1,
				filename: "document.pdf",
				content_type: "application/pdf",
				size: 52428,
				content_id: null,
			},
			{ id: 2, filename: null, content_type: "image/png", size: 1024, content_id: null },
		]);
		render(<MessageDetail {...defaultProps} message={makeMessage({ has_attachments: 1 })} />);
		await waitFor(() => {
			expect(screen.getByText("2 attachments")).toBeInTheDocument();
		});
		expect(screen.getByText("document.pdf")).toBeInTheDocument();
		expect(screen.getByText("51.2 KB")).toBeInTheDocument();
		expect(screen.getByText("attachment")).toBeInTheDocument(); // null filename fallback
	});

	it("thread messages can be expanded and collapsed", async () => {
		const msg1 = makeMessage({ id: 1, from_name: "Alice", text_body: "First message" });
		const msg2 = makeMessage({ id: 2, from_name: "Bob", text_body: "Reply message" });
		render(<MessageDetail {...defaultProps} message={msg1} thread={[msg1, msg2]} />);

		// First message in thread is collapsed by default (not the last)
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		// Last message is always expanded
		expect(screen.getByText("Reply message")).toBeInTheDocument();

		// Click to expand the first message
		const expandBtn = screen.getByLabelText("Expand message from Alice");
		await userEvent.click(expandBtn);
		expect(screen.getByText("First message")).toBeInTheDocument();

		// Click again to collapse
		await userEvent.click(expandBtn);
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
	});

	it("auto-marks unread message as read on open", async () => {
		const { api } = await import("../../api");
		const onMessageChanged = vi.fn();
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ id: 99, flags: null })}
				onMessageChanged={onMessageChanged}
			/>,
		);
		await waitFor(() => {
			expect(api.messages.updateFlags).toHaveBeenCalledWith(99, { add: ["\\Seen"] });
		});
	});

	it("does not auto-mark already-read message", async () => {
		const { api } = await import("../../api");
		render(<MessageDetail {...defaultProps} message={makeMessage({ flags: "\\Seen" })} />);
		// Wait a tick
		await new Promise((r) => setTimeout(r, 50));
		// updateFlags should not be called for auto-mark (may be called zero times or only by explicit user action)
		const autoMarkCalls = (api.messages.updateFlags as ReturnType<typeof vi.fn>).mock.calls.filter(
			(call: unknown[]) => {
				const args = call as [number, { add?: string[] }];
				return args[1]?.add?.includes("\\Seen");
			},
		);
		expect(autoMarkCalls.length).toBe(0);
	});

	it("shows sender initial in avatar", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ from_name: null, from_address: "alice@test.com" })}
			/>,
		);
		// Avatar shows first letter of from_address
		expect(screen.getByText("A")).toBeInTheDocument();
	});

	// --- DOMPurify hardening tests ---

	it("strips event handler attributes from HTML email body", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<div onclick="alert(1)" onmouseover="steal()">Content</div>',
					text_body: "Content",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content div");
		expect(emailContent?.getAttribute("onclick")).toBeNull();
		expect(emailContent?.getAttribute("onmouseover")).toBeNull();
	});

	it("removes tracking pixel images (1x1)", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<p>Hello</p><img src="https://tracker.com/pixel.gif" width="1" height="1">',
					text_body: "Hello",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content");
		const imgs = emailContent?.querySelectorAll("img");
		expect(imgs?.length ?? 0).toBe(0);
	});

	it("blocks all remote images by default", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body:
						'<p>Hello</p><img src="https://example.com/track/open?id=123"><img src="https://cdn.example.com/logo.png" width="200" height="50">',
					text_body: "Hello",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content");
		const imgs = emailContent?.querySelectorAll("img");
		// All remote images blocked by default (tracking + legitimate)
		expect(imgs?.length ?? 0).toBe(0);
	});

	it("shows 'Show images' banner when HTML has remote images", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body:
						'<p>Newsletter</p><img src="https://cdn.example.com/banner.jpg" width="600" height="200">',
					text_body: "Newsletter",
				})}
			/>,
		);
		expect(screen.getByText("Images are hidden to protect your privacy.")).toBeInTheDocument();
		expect(screen.getByText("Show images")).toBeInTheDocument();
	});

	it("loads remote images when user clicks 'Show images'", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body:
						'<p>Newsletter</p><img src="https://cdn.example.com/banner.jpg" width="600" height="200">',
					text_body: "Newsletter",
				})}
			/>,
		);
		// Initially blocked
		let imgs = container.querySelector(".email-content")?.querySelectorAll("img");
		expect(imgs?.length ?? 0).toBe(0);

		// Click "Show images"
		await user.click(screen.getByText("Show images"));

		// Now images should be visible
		imgs = container.querySelector(".email-content")?.querySelectorAll("img");
		expect(imgs?.length ?? 0).toBe(1);
		expect(imgs?.[0]?.getAttribute("src")).toContain("banner.jpg");
	});

	it("does not show banner when HTML has no remote images", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: "<p>Plain text email with no images</p>",
					text_body: "Plain text email with no images",
				})}
			/>,
		);
		expect(
			screen.queryByText("Images are hidden to protect your privacy."),
		).not.toBeInTheDocument();
	});

	it("does not show banner for data: URI images", () => {
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body:
						'<p>Inline</p><img src="data:image/png;base64,iVBORw0KGgo=" width="100" height="100">',
					text_body: "Inline",
				})}
			/>,
		);
		expect(
			screen.queryByText("Images are hidden to protect your privacy."),
		).not.toBeInTheDocument();
	});

	it("strips iframe tags from HTML email", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<p>Hello</p><iframe src="https://evil.com"></iframe>',
					text_body: "Hello",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content");
		expect(emailContent?.querySelectorAll("iframe").length).toBe(0);
	});

	it("strips script tags from HTML email", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<p>Hello</p><script>alert("xss")</script>',
					text_body: "Hello",
				})}
			/>,
		);
		const emailContent = container.querySelector(".email-content");
		expect(emailContent?.querySelectorAll("script").length).toBe(0);
		expect(emailContent?.textContent).not.toContain("alert");
	});

	it("shows reply/forward actions on every message in a thread", async () => {
		const msg1 = makeMessage({ id: 1, from_name: "Alice", text_body: "First message" });
		const msg2 = makeMessage({ id: 2, from_name: "Bob", text_body: "Reply message" });
		const onReply = vi.fn();
		render(
			<MessageDetail {...defaultProps} message={msg1} thread={[msg1, msg2]} onReply={onReply} />,
		);

		// Expand the first message
		const expandBtn = screen.getByLabelText("Expand message from Alice");
		await userEvent.click(expandBtn);

		// Both messages should have Reply buttons
		const replyBtns = screen
			.getAllByRole("button")
			.filter(
				(btn) =>
					btn.textContent?.includes("Reply") &&
					!btn.textContent?.includes("All") &&
					!btn.textContent?.includes("Mark"),
			);
		expect(replyBtns.length).toBeGreaterThanOrEqual(2);
	});

	it("expand all / collapse all toggle works in thread header", async () => {
		const msg1 = makeMessage({ id: 1, from_name: "Alice", text_body: "First message" });
		const msg2 = makeMessage({ id: 2, from_name: "Bob", text_body: "Second message" });
		const msg3 = makeMessage({ id: 3, from_name: "Carol", text_body: "Third message" });
		render(<MessageDetail {...defaultProps} message={msg1} thread={[msg1, msg2, msg3]} />);

		// Initially only last message (msg3) is expanded
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		expect(screen.queryByText("Second message")).not.toBeInTheDocument();
		expect(screen.getByText("Third message")).toBeInTheDocument();

		// Click 'Expand all'
		const expandAllBtn = screen.getByText("Expand all");
		await userEvent.click(expandAllBtn);

		// All messages should be visible
		expect(screen.getByText("First message")).toBeInTheDocument();
		expect(screen.getByText("Second message")).toBeInTheDocument();
		expect(screen.getByText("Third message")).toBeInTheDocument();

		// Button should now say 'Collapse all'
		const collapseAllBtn = screen.getByText("Collapse all");
		await userEvent.click(collapseAllBtn);

		// First two should be collapsed again
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		expect(screen.queryByText("Second message")).not.toBeInTheDocument();
		expect(screen.getByText("Third message")).toBeInTheDocument();
	});

	it("does not show expand all button for single message", () => {
		render(<MessageDetail {...defaultProps} thread={[]} />);
		expect(screen.queryByText("Expand all")).not.toBeInTheDocument();
		expect(screen.queryByText("Collapse all")).not.toBeInTheDocument();
	});
});
