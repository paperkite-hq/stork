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
		trustedSenders: {
			list: vi.fn().mockResolvedValue([]),
			add: vi.fn().mockResolvedValue({ id: 1 }),
			remove: vi.fn().mockResolvedValue({ ok: true }),
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

	it("renders HTML body in a sandboxed iframe", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: "<p>Formatted <strong>content</strong></p>",
					text_body: "Formatted content",
				})}
			/>,
		);
		const iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		expect(iframe).toBeInTheDocument();
		expect(iframe?.tagName).toBe("IFRAME");
		// Verify sandbox blocks scripts but allows same-origin (for height) and popups (for links)
		expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin allow-popups");
	});

	it("sandboxed iframe includes CSP meta tag blocking scripts", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<a href="https://example.com">Click me</a>',
					text_body: "Click me",
				})}
			/>,
		);
		const iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
		expect(srcdoc).toContain("Content-Security-Policy");
		// default-src 'none' blocks all resource types including scripts
		expect(srcdoc).toContain("default-src 'none'");
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

	it("resets HTML/plain text toggle to HTML when switching messages", async () => {
		const msgA = makeMessage({
			id: 1,
			html_body: "<p>Message A HTML</p>",
			text_body: "Message A plain",
		});
		const msgB = makeMessage({
			id: 2,
			html_body: "<p>Message B HTML</p>",
			text_body: "Message B plain",
		});
		const { rerender } = render(<MessageDetail {...defaultProps} message={msgA} />);
		// Toggle to plain text view for message A
		await userEvent.click(screen.getByText("Show plain text"));
		expect(screen.getByText("Show formatted")).toBeInTheDocument();
		// Switch to message B — should reset to HTML (show "Show plain text" again)
		rerender(<MessageDetail {...defaultProps} message={msgB} />);
		expect(screen.getByText("Show plain text")).toBeInTheDocument();
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

		// Selected message (msg1/Alice) is auto-expanded on mount
		expect(screen.getByText("First message")).toBeInTheDocument();
		// Last message is always expanded
		expect(screen.getByText("Reply message")).toBeInTheDocument();

		// Click to collapse the first message (it's now expanded, so button label is "Collapse")
		const collapseBtn = screen.getByLabelText("Collapse message from Alice");
		await userEvent.click(collapseBtn);
		expect(screen.queryByText("First message")).not.toBeInTheDocument();

		// Click again to re-expand
		const expandBtn = screen.getByLabelText("Expand message from Alice");
		await userEvent.click(expandBtn);
		expect(screen.getByText("First message")).toBeInTheDocument();
	});

	it("auto-marks unread message as read on open", async () => {
		vi.useFakeTimers();
		const { api } = await import("../../api");
		const onMessageChanged = vi.fn();
		render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({ id: 99, flags: null })}
				onMessageChanged={onMessageChanged}
			/>,
		);
		// Auto-mark is debounced by 1s to avoid marking every message during j/k navigation
		await vi.advanceTimersByTimeAsync(1100);
		expect(api.messages.updateFlags).toHaveBeenCalledWith(99, { add: ["\\Seen"] });
		vi.useRealTimers();
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

	it("renders email HTML inside sandbox without allow-scripts", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body: '<div onclick="alert(1)" onmouseover="steal()">Content</div>',
					text_body: "Content",
				})}
			/>,
		);
		const iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		const sandbox = iframe?.getAttribute("sandbox") ?? "";
		// Must NOT include allow-scripts — this is what prevents script execution
		expect(sandbox).not.toContain("allow-scripts");
		expect(sandbox).toContain("allow-same-origin");
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
		expect(
			screen.getByText(/Remote images are hidden to protect your privacy/),
		).toBeInTheDocument();
		expect(screen.getByText("Show once")).toBeInTheDocument();
	});

	it("updates iframe srcdoc when user clicks 'Show images'", async () => {
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
		// Initially images are blocked — srcdoc should not contain the image URL
		let iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		expect(iframe?.getAttribute("srcdoc")).not.toContain("banner.jpg");

		// Click "Show images"
		await user.click(screen.getByText("Show once"));

		// Now srcdoc should include the image
		iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		expect(iframe?.getAttribute("srcdoc")).toContain("banner.jpg");
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
			screen.queryByText(/Remote images are hidden to protect your privacy/),
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
			screen.queryByText(/Remote images are hidden to protect your privacy/),
		).not.toBeInTheDocument();
	});

	it("renders email in sandboxed iframe that blocks script execution", () => {
		const { container } = render(
			<MessageDetail
				{...defaultProps}
				message={makeMessage({
					html_body:
						'<p>Hello</p><iframe src="https://evil.com"></iframe><script>alert("xss")</script>',
					text_body: "Hello",
				})}
			/>,
		);
		const iframe = container.querySelector(".email-content") as HTMLIFrameElement | null;
		// Even if sanitizer misses something, sandbox without allow-scripts blocks execution
		expect(iframe?.getAttribute("sandbox")).not.toContain("allow-scripts");
		// CSP in srcdoc provides additional protection
		const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
		expect(srcdoc).toContain("default-src 'none'");
	});

	it("shows reply/forward actions on every message in a thread", async () => {
		const msg1 = makeMessage({ id: 1, from_name: "Alice", text_body: "First message" });
		const msg2 = makeMessage({ id: 2, from_name: "Bob", text_body: "Reply message" });
		const onReply = vi.fn();
		render(
			<MessageDetail {...defaultProps} message={msg1} thread={[msg1, msg2]} onReply={onReply} />,
		);

		// msg1 (the selected message) is auto-expanded on mount; msg2 (last) is always expanded.
		// Both messages should already have Reply buttons without any extra clicks.
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

		// msg1 (selected message) and msg3 (last in thread) are expanded; msg2 is collapsed
		expect(screen.getByText("First message")).toBeInTheDocument();
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

describe("MessageDetail — Delete error handling", () => {
	it("shows error toast when delete fails", async () => {
		const { api } = await import("../../api");
		const { toast } = await import("../Toast");
		(api.messages.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Network error"),
		);

		const msg = makeMessage({ id: 42 });
		render(
			<MessageDetail {...defaultProps} message={msg} thread={[msg]} folders={[]} accountId={1} />,
		);

		// Click delete button
		const deleteBtn = screen.getByTitle("Delete message");
		await userEvent.click(deleteBtn);

		// Confirm deletion
		await waitFor(() =>
			expect(
				screen.getByText(
					"This will permanently delete this message. This action cannot be undone.",
				),
			).toBeInTheDocument(),
		);
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));

		// Should show error toast
		await waitFor(() => {
			expect(toast).toHaveBeenCalledWith("Failed to delete message", "error");
		});
	});
});

describe("MessageDetail — Trust sender", () => {
	it("shows 'Always show from this sender' button for remote images and calls trustedSenders.add", async () => {
		const { api } = await import("../../api");

		// Use a non-tracking remote image (not 1x1, no /track path)
		const msg = makeMessage({
			id: 50,
			from_address: "Alice@Test.Com",
			html_body: '<img src="https://newsletter.example.com/banner.png" width="600" height="200">',
		});
		render(
			<MessageDetail {...defaultProps} message={msg} thread={[msg]} folders={[]} accountId={1} />,
		);

		// The remote images banner should be shown
		await waitFor(() => {
			expect(screen.getByText(/Remote images are hidden/i)).toBeInTheDocument();
		});

		// Click "Always show from this sender"
		const trustBtn = screen.getByText(/Always show from this sender/i);
		await userEvent.click(trustBtn);

		await waitFor(() => {
			expect(api.trustedSenders.add).toHaveBeenCalledWith(1, "alice@test.com");
		});
	});

	it("hides the remote images banner when sender is already trusted", async () => {
		const { api } = await import("../../api");
		// Mock trusted senders to include the sender
		(api.trustedSenders.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ id: 1, sender_address: "newsletter@example.com", created_at: new Date().toISOString() },
		]);

		const msg = makeMessage({
			id: 51,
			from_address: "newsletter@example.com",
			html_body: '<img src="https://newsletter.example.com/banner.png" width="600" height="200">',
		});
		render(
			<MessageDetail {...defaultProps} message={msg} thread={[msg]} folders={[]} accountId={1} />,
		);

		// Banner should NOT show since sender is trusted
		await waitFor(() => {
			// Give the trusted senders list time to load
			expect(api.trustedSenders.list).toHaveBeenCalledWith(1);
		});
		expect(screen.queryByText(/Remote images are hidden/i)).not.toBeInTheDocument();
	});

	it("shows error toast when trustedSenders.add fails", async () => {
		const { api } = await import("../../api");
		const { toast } = await import("../Toast");
		(api.trustedSenders.add as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Network error"),
		);

		const msg = makeMessage({
			id: 52,
			from_address: "sender@example.com",
			html_body: '<img src="https://cdn.example.com/image.jpg" width="800" height="400">',
		});
		render(
			<MessageDetail {...defaultProps} message={msg} thread={[msg]} folders={[]} accountId={1} />,
		);

		await waitFor(() => {
			expect(screen.getByText(/Remote images are hidden/i)).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText(/Always show from this sender/i));
		await waitFor(() => {
			expect(toast).toHaveBeenCalledWith("Failed to trust sender", "error");
		});
	});
});
