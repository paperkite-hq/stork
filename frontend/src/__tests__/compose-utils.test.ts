import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "../api";
import {
	buildForwardHtmlBody,
	buildForwardSubject,
	buildReplyAllCc,
	buildReplyBody,
	buildReplyHtmlBody,
	buildReplySubject,
	clearDraft,
	draftKey,
	escapeHtml,
	getInitialFormat,
	htmlToPlainText,
	loadDraft,
	plainTextToHtml,
	saveDraft,
	validateEmails,
} from "../compose-utils";

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

describe("validateEmails", () => {
	it("returns error for empty string", () => {
		expect(validateEmails("")).toBe("At least one recipient is required");
		expect(validateEmails("   ")).toBe("At least one recipient is required");
	});

	it("accepts valid email", () => {
		expect(validateEmails("user@example.com")).toBeNull();
	});

	it("accepts multiple comma-separated emails", () => {
		expect(validateEmails("a@b.com, c@d.com")).toBeNull();
	});

	it("accepts RFC 2822 format", () => {
		expect(validateEmails("Alice <alice@example.com>")).toBeNull();
	});

	it("rejects invalid email", () => {
		expect(validateEmails("not-email")).toContain("Invalid email address");
	});

	it("rejects invalid email in list", () => {
		expect(validateEmails("valid@test.com, bad")).toContain("Invalid email address");
	});
});

describe("buildReplySubject", () => {
	it("adds Re: prefix", () => {
		expect(buildReplySubject("Hello")).toBe("Re: Hello");
	});

	it("does not double Re:", () => {
		expect(buildReplySubject("Re: Hello")).toBe("Re: Hello");
		expect(buildReplySubject("RE: Hello")).toBe("RE: Hello");
	});

	it("handles null subject", () => {
		expect(buildReplySubject(null)).toBe("Re: (no subject)");
	});
});

describe("buildForwardSubject", () => {
	it("adds Fwd: prefix", () => {
		expect(buildForwardSubject("Hello")).toBe("Fwd: Hello");
	});

	it("does not double Fwd:", () => {
		expect(buildForwardSubject("Fwd: Hello")).toBe("Fwd: Hello");
		expect(buildForwardSubject("FWD: Hello")).toBe("FWD: Hello");
	});

	it("handles null subject", () => {
		expect(buildForwardSubject(null)).toBe("Fwd: (no subject)");
	});
});

describe("buildReplyBody", () => {
	it("quotes original text with > prefix", () => {
		const msg = makeMessage({ text_body: "Hello\nWorld" });
		const body = buildReplyBody(msg);
		expect(body).toContain("> Hello");
		expect(body).toContain("> World");
	});

	it("includes sender name and date", () => {
		const msg = makeMessage({ from_name: "Alice" });
		const body = buildReplyBody(msg);
		expect(body).toContain("Alice wrote:");
	});

	it("falls back to from_address when from_name is falsy", () => {
		const msg = makeMessage({ from_name: null as unknown as string });
		const body = buildReplyBody(msg);
		expect(body).toContain("sender@test.com wrote:");
	});

	it("shows 'unknown date' for null date", () => {
		const msg = makeMessage({ date: null as unknown as string });
		const body = buildReplyBody(msg);
		expect(body).toContain("unknown date");
	});

	it("handles empty text_body", () => {
		const msg = makeMessage({ text_body: null as unknown as string });
		const body = buildReplyBody(msg);
		expect(body).toContain("> ");
	});
});

describe("buildReplyHtmlBody", () => {
	it("wraps in blockquote", () => {
		const msg = makeMessage({ html_body: "<p>Hello</p>" });
		const html = buildReplyHtmlBody(msg);
		expect(html).toContain("<blockquote");
		expect(html).toContain("<p>Hello</p>");
	});

	it("falls back to escaped text_body when no html_body", () => {
		const msg = makeMessage({ html_body: null, text_body: "Plain <text>" });
		const html = buildReplyHtmlBody(msg);
		expect(html).toContain("Plain &lt;text&gt;");
	});

	it("uses unknown date for invalid date", () => {
		const msg = makeMessage({ date: "invalid" });
		const html = buildReplyHtmlBody(msg);
		expect(html).toContain("unknown date");
	});
});

describe("buildForwardHtmlBody", () => {
	it("includes forwarded message header", () => {
		const msg = makeMessage({ from_name: "Alice", from_address: "alice@test.com" });
		const html = buildForwardHtmlBody(msg);
		expect(html).toContain("Forwarded message");
		expect(html).toContain("Alice");
	});

	it("falls back to from_address when from_name is falsy", () => {
		const msg = makeMessage({ from_name: null as unknown as string });
		const html = buildForwardHtmlBody(msg);
		expect(html).toContain("sender@test.com");
	});

	it("formats JSON array to_addresses as human-readable", () => {
		const msg = makeMessage({
			to_addresses: '["Alice Smith <alice@example.com>","bob@example.com"]',
		});
		const html = buildForwardHtmlBody(msg);
		// Should show display names/bare emails, not raw JSON
		expect(html).toContain("Alice Smith");
		expect(html).toContain("bob@example.com");
		expect(html).not.toContain('["Alice');
	});

	it("shows 'unknown date' for null date", () => {
		const msg = makeMessage({ date: null as unknown as string });
		const html = buildForwardHtmlBody(msg);
		expect(html).toContain("unknown date");
	});

	it("shows 'unknown date' for invalid date", () => {
		const msg = makeMessage({ date: "not-a-date" });
		const html = buildForwardHtmlBody(msg);
		expect(html).toContain("unknown date");
	});
});

describe("escapeHtml", () => {
	it("escapes special characters", () => {
		expect(escapeHtml('<div>"hello" & world</div>')).toBe(
			"&lt;div&gt;&quot;hello&quot; &amp; world&lt;/div&gt;",
		);
	});
});

describe("htmlToPlainText", () => {
	it("strips tags and returns text", () => {
		expect(htmlToPlainText("<p>Hello</p>")).toBe("Hello");
	});

	it("converts <br> to newlines", () => {
		expect(htmlToPlainText("Line 1<br>Line 2")).toBe("Line 1\nLine 2");
	});

	it("handles empty string", () => {
		expect(htmlToPlainText("")).toBe("");
	});
});

describe("plainTextToHtml", () => {
	it("escapes HTML and converts newlines to <br>", () => {
		expect(plainTextToHtml("Hello\nWorld")).toBe("Hello<br>World");
	});

	it("escapes angle brackets", () => {
		expect(plainTextToHtml("<script>")).toBe("&lt;script&gt;");
	});
});

describe("getInitialFormat", () => {
	it("returns saved format if present", () => {
		expect(
			getInitialFormat(
				{ type: "new" },
				{ to: "", cc: "", bcc: "", subject: "", body: "", format: "html" },
			),
		).toBe("html");
	});

	it("returns html when replying to HTML email", () => {
		const msg = makeMessage({ html_body: "<p>Hello</p>" });
		expect(getInitialFormat({ type: "reply", original: msg }, null)).toBe("html");
	});

	it("returns plain for new messages", () => {
		expect(getInitialFormat({ type: "new" }, null)).toBe("plain");
	});

	it("returns plain when replying to plain text email", () => {
		const msg = makeMessage({ html_body: null });
		expect(getInitialFormat({ type: "reply", original: msg }, null)).toBe("plain");
	});
});

describe("buildReplyAllCc", () => {
	it("includes to and cc addresses except sender", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: '["bob@test.com","carol@test.com"]',
			cc_addresses: '["dave@test.com"]',
		});
		const cc = buildReplyAllCc(msg);
		expect(cc).toContain("bob@test.com");
		expect(cc).toContain("carol@test.com");
		expect(cc).toContain("dave@test.com");
		expect(cc).not.toContain("alice@test.com");
	});

	it("excludes the current user's email", () => {
		const msg = makeMessage({
			from_address: "alice@test.com",
			to_addresses: '["me@myaccount.com","bob@test.com"]',
		});
		const cc = buildReplyAllCc(msg, "me@myaccount.com");
		expect(cc).toContain("bob@test.com");
		expect(cc).not.toContain("me@myaccount.com");
	});

	it("handles null cc_addresses", () => {
		const msg = makeMessage({ cc_addresses: null, to_addresses: '["bob@test.com"]' });
		const cc = buildReplyAllCc(msg);
		expect(cc).toBe("bob@test.com");
	});
});

describe("draft management", () => {
	afterEach(() => localStorage.clear());

	it("draftKey returns mode-specific key", () => {
		expect(draftKey({ type: "new" })).toBe("stork-compose-draft");
		const msg = makeMessage({ id: 42 });
		expect(draftKey({ type: "reply", original: msg })).toBe("stork-compose-draft:reply:42");
		expect(draftKey({ type: "forward", original: msg })).toBe("stork-compose-draft:forward:42");
	});

	it("saveDraft + loadDraft round-trips", () => {
		const draft = { to: "a@b.com", cc: "", bcc: "", subject: "Test", body: "Hello" };
		saveDraft("test-key", draft);
		const loaded = loadDraft("test-key");
		expect(loaded).toEqual(draft);
	});

	it("loadDraft returns null for missing key", () => {
		expect(loadDraft("nonexistent")).toBeNull();
	});

	it("clearDraft removes the key", () => {
		saveDraft("test-key", { to: "a@b.com", cc: "", bcc: "", subject: "", body: "" });
		clearDraft("test-key");
		expect(loadDraft("test-key")).toBeNull();
	});

	it("loadDraft returns null for corrupted JSON", () => {
		localStorage.setItem("bad-key", "{not valid json{{");
		expect(loadDraft("bad-key")).toBeNull();
	});
});
