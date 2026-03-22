import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, Message } from "../../api";
import { ComposeModal } from "../ComposeModal";

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: 1,
		uid: 1,
		message_id: "<msg1@test>",
		subject: "Test Subject",
		from_address: "sender@test.com",
		from_name: "Test Sender",
		to_addresses: '["me@test.com"]',
		cc_addresses: null,
		bcc_addresses: null,
		in_reply_to: null,
		references: null,
		date: "2026-01-15T10:00:00Z",
		text_body: "Original message body.",
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

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: 1,
		name: "Test User",
		email: "test@example.com",
		imap_host: "imap.example.com",
		smtp_host: "smtp.example.com",
		created_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("ComposeModal", () => {
	afterEach(() => {
		localStorage.clear();
	});
	it("renders new message mode", () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);
		expect(screen.getByText("New Message")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("recipient@example.com")).toHaveValue("");
	});

	it("renders reply mode with prefilled fields", () => {
		render(
			<ComposeModal
				mode={{ type: "reply", original: makeMessage() }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		expect(screen.getByText("Reply")).toBeInTheDocument();
		// To field should be prefilled with original sender
		expect(screen.getByPlaceholderText("recipient@example.com")).toHaveValue("sender@test.com");
	});

	it("renders reply-all mode with CC", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: "me@test.com, bob@test.com",
			cc_addresses: "carol@test.com",
		});
		render(
			<ComposeModal
				mode={{ type: "reply-all", original: msg }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		expect(screen.getByText("Reply All")).toBeInTheDocument();
	});

	it("renders forward mode with Fwd: subject", () => {
		render(
			<ComposeModal
				mode={{ type: "forward", original: makeMessage({ subject: "Important" }) }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		expect(screen.getByText("Forward")).toBeInTheDocument();
		// Subject should have Fwd: prefix
		const subjectInput = screen.getByLabelText("Subj");
		expect(subjectInput).toHaveValue("Fwd: Important");
	});

	it("calls onClose when close button is clicked", async () => {
		const onClose = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={onClose} onSend={vi.fn()} />);

		await userEvent.click(screen.getByTitle("Close"));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when Discard is clicked", async () => {
		const onClose = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={onClose} onSend={vi.fn()} />);

		await userEvent.click(screen.getByText("Discard"));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onSend with form data including accountId", async () => {
		const onSend = vi.fn();
		render(
			<ComposeModal
				mode={{ type: "new" }}
				accounts={[makeAccount({ id: 7 })]}
				selectedAccountId={7}
				onClose={vi.fn()}
				onSend={onSend}
			/>,
		);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bob@test.com");
		const subjectInput = screen.getByLabelText("Subj");
		await userEvent.type(subjectInput, "Hello");
		await userEvent.type(screen.getByPlaceholderText("Write your message…"), "Hi Bob!");

		await userEvent.click(screen.getByText("Send"));
		expect(onSend).toHaveBeenCalledWith({
			accountId: 7,
			to: "bob@test.com",
			cc: "",
			bcc: "",
			subject: "Hello",
			body: "Hi Bob!",
		});
	});

	it("disables send when To is empty", () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);
		expect(screen.getByText("Send")).toBeDisabled();
	});

	it("does not prepend Re: twice", () => {
		render(
			<ComposeModal
				mode={{ type: "reply", original: makeMessage({ subject: "Re: Already replied" }) }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		const subjectInput = screen.getByLabelText("Subj");
		expect(subjectInput).toHaveValue("Re: Already replied");
	});

	it("does not prepend Fwd: twice", () => {
		render(
			<ComposeModal
				mode={{ type: "forward", original: makeMessage({ subject: "Fwd: Already forwarded" }) }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		const subjectInput = screen.getByLabelText("Subj");
		expect(subjectInput).toHaveValue("Fwd: Already forwarded");
	});

	it("shows From selector when multiple accounts provided", () => {
		const accounts = [
			makeAccount({ id: 1, email: "alice@example.com", name: "Alice" }),
			makeAccount({ id: 2, email: "bob@example.com", name: "Bob" }),
		];
		render(
			<ComposeModal
				mode={{ type: "new" }}
				accounts={accounts}
				selectedAccountId={1}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		expect(screen.getByLabelText("From")).toBeInTheDocument();
	});

	it("hides From selector for single account", () => {
		render(
			<ComposeModal
				mode={{ type: "new" }}
				accounts={[makeAccount({ id: 1 })]}
				selectedAccountId={1}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
	});

	it("saves draft to localStorage as user types", async () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "draft@test.com");
		const subjectInput = screen.getByLabelText("Subj");
		await userEvent.type(subjectInput, "Draft subject");

		const draft = JSON.parse(localStorage.getItem("stork-compose-draft") ?? "{}");
		expect(draft.to).toBe("draft@test.com");
		expect(draft.subject).toBe("Draft subject");
	});

	it("restores draft from localStorage for new messages", () => {
		localStorage.setItem(
			"stork-compose-draft",
			JSON.stringify({ to: "saved@test.com", cc: "", subject: "Saved draft", body: "draft body" }),
		);
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);

		expect(screen.getByPlaceholderText("recipient@example.com")).toHaveValue("saved@test.com");
		expect(screen.getByLabelText("Subj")).toHaveValue("Saved draft");
	});

	it("does not restore new-message draft for reply mode", () => {
		localStorage.setItem(
			"stork-compose-draft",
			JSON.stringify({
				to: "draft@test.com",
				cc: "",
				subject: "Draft subject",
				body: "draft body",
			}),
		);
		render(
			<ComposeModal
				mode={{ type: "reply", original: makeMessage() }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		// Reply pre-fills with original sender, not the new-message draft
		expect(screen.getByPlaceholderText("recipient@example.com")).toHaveValue("sender@test.com");
	});

	it("saves and restores draft for reply mode with mode-specific key", async () => {
		const msg = makeMessage({ id: 42 });
		const draftKey = "stork-compose-draft:reply:42";

		// First render: type some text → auto-saved
		const { unmount } = render(
			<ComposeModal mode={{ type: "reply", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		const textarea = screen.getByPlaceholderText("Write your message…") as HTMLTextAreaElement;
		await userEvent.type(textarea, "My reply");
		unmount();

		// Draft should be saved under the reply-specific key
		const saved = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
		expect(saved.body).toContain("My reply");

		// Second render: draft should be restored
		render(
			<ComposeModal mode={{ type: "reply", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		const restoredTextarea = screen.getByPlaceholderText(
			"Write your message…",
		) as HTMLTextAreaElement;
		expect(restoredTextarea.value).toContain("My reply");
	});

	it("saves and restores draft for forward mode with mode-specific key", async () => {
		const msg = makeMessage({ id: 99, subject: "Original" });
		const draftKey = "stork-compose-draft:forward:99";

		const { unmount } = render(
			<ComposeModal mode={{ type: "forward", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		// Type into the To field
		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "fwd@test.com");
		unmount();

		const saved = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
		expect(saved.to).toBe("fwd@test.com");
	});

	it("clears mode-specific draft on discard", async () => {
		const msg = makeMessage({ id: 55 });
		const draftKey = "stork-compose-draft:reply:55";
		localStorage.setItem(
			draftKey,
			JSON.stringify({ to: "x@test.com", cc: "", subject: "Re: Test", body: "draft" }),
		);

		render(
			<ComposeModal mode={{ type: "reply", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		await userEvent.click(screen.getByText("Discard"));
		expect(localStorage.getItem(draftKey)).toBeNull();
	});

	it("clears draft from localStorage when message is sent successfully", async () => {
		// onSend resolves — simulates successful send
		const onSend = vi.fn().mockResolvedValue(undefined);
		const onClose = vi.fn();
		const { unmount } = render(
			<ComposeModal mode={{ type: "new" }} onClose={onClose} onSend={onSend} />,
		);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bob@test.com");
		await userEvent.click(screen.getByText("Send"));

		expect(onSend).toHaveBeenCalled();
		// Wait for the async onSend to resolve + draft to be cleared
		await vi.waitFor(() => {
			expect(localStorage.getItem("stork-compose-draft")).toBeNull();
		});
		unmount();
	});

	it("preserves draft when send fails", async () => {
		// onSend rejects — simulates SMTP not available
		const onSend = vi.fn().mockRejectedValue(new Error("Sending is not yet available"));
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bob@test.com");
		await userEvent.type(screen.getByLabelText("Subj"), "Important");
		await userEvent.click(screen.getByText("Send"));

		// Error should appear inline
		await vi.waitFor(() => {
			expect(screen.getByText("Sending is not yet available")).toBeInTheDocument();
		});
		// Draft should still be in localStorage
		const draft = JSON.parse(localStorage.getItem("stork-compose-draft") ?? "{}");
		expect(draft.to).toContain("bob@test.com");
		expect(draft.subject).toBe("Important");
		// Send button should be re-enabled for retry
		expect(screen.getByText("Send")).not.toBeDisabled();
	});

	it("clears draft from localStorage when Discard is clicked", async () => {
		localStorage.setItem(
			"stork-compose-draft",
			JSON.stringify({ to: "x@test.com", cc: "", subject: "hello", body: "" }),
		);
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);

		await userEvent.click(screen.getByText("Discard"));
		expect(localStorage.getItem("stork-compose-draft")).toBeNull();
	});

	it("calls onClose when backdrop is clicked", async () => {
		const onClose = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={onClose} onSend={vi.fn()} />);
		const backdrop = screen.getByRole("dialog");
		// Click the backdrop (the outer div), not the inner content
		fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when Escape key is pressed on backdrop", () => {
		const onClose = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={onClose} onSend={vi.fn()} />);
		const backdrop = screen.getByRole("dialog");
		fireEvent.keyDown(backdrop, { key: "Escape" });
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("sends via Ctrl+Enter keyboard shortcut", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bob@test.com");
		const textarea = screen.getByPlaceholderText("Write your message…");
		const container = textarea.closest("div") as HTMLElement;
		fireEvent.keyDown(container, { key: "Enter", ctrlKey: true });

		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ to: "bob@test.com" }));
	});

	it("sends via Meta+Enter keyboard shortcut", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bob@test.com");
		const textarea = screen.getByPlaceholderText("Write your message…");
		const container = textarea.closest("div") as HTMLElement;
		fireEvent.keyDown(container, { key: "Enter", metaKey: true });

		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ to: "bob@test.com" }));
	});

	it("shows Cc field when Cc button is clicked", async () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);
		expect(screen.queryByPlaceholderText("cc@example.com")).not.toBeInTheDocument();
		await userEvent.click(screen.getByText("Cc"));
		expect(screen.getByPlaceholderText("cc@example.com")).toBeInTheDocument();
	});

	it("changes from account when selector is used", async () => {
		const onSend = vi.fn();
		const accounts = [
			makeAccount({ id: 1, email: "alice@example.com", name: "Alice" }),
			makeAccount({ id: 2, email: "bob@example.com", name: "Bob" }),
		];
		render(
			<ComposeModal
				mode={{ type: "new" }}
				accounts={accounts}
				selectedAccountId={1}
				onClose={vi.fn()}
				onSend={onSend}
			/>,
		);

		await userEvent.selectOptions(screen.getByLabelText("From"), "2");
		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "x@test.com");
		await userEvent.click(screen.getByText("Send"));

		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2 }));
	});

	it("builds reply body with quoted text", () => {
		const msg = makeMessage({ text_body: "Hello\nWorld" });
		render(
			<ComposeModal mode={{ type: "reply", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		const textarea = screen.getByPlaceholderText("Write your message…") as HTMLTextAreaElement;
		expect(textarea.value).toContain("> Hello");
		expect(textarea.value).toContain("> World");
	});

	it("builds forward body with forwarded message header", () => {
		const msg = makeMessage({
			from_name: "Alice",
			from_address: "alice@test.com",
			subject: "Important",
		});
		render(
			<ComposeModal mode={{ type: "forward", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		const textarea = screen.getByPlaceholderText("Write your message…") as HTMLTextAreaElement;
		expect(textarea.value).toContain("Forwarded message");
		expect(textarea.value).toContain("Alice");
	});

	it("shows Re: for reply with null subject", () => {
		const msg = makeMessage({ subject: null as unknown as string });
		render(
			<ComposeModal mode={{ type: "reply", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		expect(screen.getByLabelText("Subj")).toHaveValue("Re: (no subject)");
	});

	it("shows Fwd: for forward with null subject", () => {
		const msg = makeMessage({ subject: null as unknown as string });
		render(
			<ComposeModal mode={{ type: "forward", original: msg }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		expect(screen.getByLabelText("Subj")).toHaveValue("Fwd: (no subject)");
	});

	it("shows validation error for invalid email in To field", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "not-an-email");
		await userEvent.click(screen.getByText("Send"));

		expect(screen.getByText(/Invalid email address/)).toBeInTheDocument();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("shows validation error for invalid email in CC field", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "valid@test.com");
		await userEvent.click(screen.getByText("Cc"));
		await userEvent.type(screen.getByPlaceholderText("cc@example.com"), "bad-cc");
		await userEvent.click(screen.getByText("Send"));

		expect(screen.getByText(/Invalid email address/)).toBeInTheDocument();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("clears validation error when user edits To field", async () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "bad");
		await userEvent.click(screen.getByText("Send"));
		expect(screen.getByText(/Invalid email address/)).toBeInTheDocument();

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "@test.com");
		expect(screen.queryByText(/Invalid email address/)).not.toBeInTheDocument();
	});

	it("accepts RFC 2822 format emails (Name <email>)", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(
			screen.getByPlaceholderText("recipient@example.com"),
			"Alice Smith <alice@test.com>",
		);
		await userEvent.click(screen.getByText("Send"));

		expect(screen.queryByText(/Invalid email address/)).not.toBeInTheDocument();
		expect(onSend).toHaveBeenCalled();
	});

	it("shows Cc field pre-filled for reply-all with CC addresses", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: "me@test.com, bob@test.com",
			cc_addresses: "carol@test.com",
		});
		render(
			<ComposeModal
				mode={{ type: "reply-all", original: msg }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		const ccInput = screen.getByPlaceholderText("cc@example.com") as HTMLInputElement;
		expect(ccInput.value).toContain("bob@test.com");
		expect(ccInput.value).toContain("carol@test.com");
	});

	it("reply-all handles JSON array address format (from IMAP sync)", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: '["me@test.com","bob@test.com"]',
			cc_addresses: '["carol@test.com"]',
		});
		render(
			<ComposeModal
				mode={{ type: "reply-all", original: msg }}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		const ccInput = screen.getByPlaceholderText("cc@example.com") as HTMLInputElement;
		expect(ccInput.value).toContain("bob@test.com");
		expect(ccInput.value).toContain("carol@test.com");
		// Should NOT contain garbled JSON brackets
		expect(ccInput.value).not.toContain("[");
		expect(ccInput.value).not.toContain("]");
	});

	it("reply-all excludes the current user's email from CC", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: '["me@myaccount.com","bob@test.com"]',
			cc_addresses: null,
		});
		render(
			<ComposeModal
				mode={{ type: "reply-all", original: msg }}
				accounts={[
					{
						id: 1,
						name: "Me",
						email: "me@myaccount.com",
						imap_host: "",
						smtp_host: null,
						created_at: "",
					},
				]}
				selectedAccountId={1}
				onClose={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		const ccInput = screen.getByPlaceholderText("cc@example.com") as HTMLInputElement;
		expect(ccInput.value).toContain("bob@test.com");
		expect(ccInput.value).not.toContain("me@myaccount.com");
	});

	it("shows Bcc field when Bcc button is clicked", async () => {
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);
		expect(screen.queryByPlaceholderText("bcc@example.com")).not.toBeInTheDocument();
		await userEvent.click(screen.getByText("Bcc"));
		expect(screen.getByPlaceholderText("bcc@example.com")).toBeInTheDocument();
	});

	it("includes bcc in onSend data", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "to@test.com");
		await userEvent.click(screen.getByText("Bcc"));
		await userEvent.type(screen.getByPlaceholderText("bcc@example.com"), "hidden@test.com");
		await userEvent.click(screen.getByText("Send"));

		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ bcc: "hidden@test.com" }));
	});

	it("validates Bcc email addresses on send", async () => {
		const onSend = vi.fn();
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={onSend} />);

		await userEvent.type(screen.getByPlaceholderText("recipient@example.com"), "valid@test.com");
		await userEvent.click(screen.getByText("Bcc"));
		await userEvent.type(screen.getByPlaceholderText("bcc@example.com"), "bad-bcc");
		await userEvent.click(screen.getByText("Send"));

		expect(screen.getByText(/Invalid email address/)).toBeInTheDocument();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("saves and restores bcc in draft", async () => {
		const { unmount } = render(
			<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />,
		);
		await userEvent.click(screen.getByText("Bcc"));
		await userEvent.type(screen.getByPlaceholderText("bcc@example.com"), "secret@test.com");
		unmount();

		const draft = JSON.parse(localStorage.getItem("stork-compose-draft") ?? "{}");
		expect(draft.bcc).toBe("secret@test.com");

		// Restore — Bcc field should auto-show when draft has bcc
		render(<ComposeModal mode={{ type: "new" }} onClose={vi.fn()} onSend={vi.fn()} />);
		expect(screen.getByPlaceholderText("bcc@example.com")).toHaveValue("secret@test.com");
	});
});
