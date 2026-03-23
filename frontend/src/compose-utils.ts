import type { Message } from "./api";
import { parseAddressField } from "./utils";

export type ComposeFormat = "plain" | "html";

export interface Draft {
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	body: string;
	htmlBody?: string;
	format?: ComposeFormat;
}

export type ComposeMode =
	| { type: "new" }
	| { type: "reply"; original: Message }
	| { type: "reply-all"; original: Message }
	| { type: "forward"; original: Message };

const DRAFT_PREFIX = "stork-compose-draft";

/** Build a localStorage key that is unique per compose mode + original message */
export function draftKey(mode: ComposeMode): string {
	if (mode.type === "new") return DRAFT_PREFIX;
	return `${DRAFT_PREFIX}:${mode.type}:${mode.original.id}`;
}

export function saveDraft(key: string, draft: Draft) {
	try {
		localStorage.setItem(key, JSON.stringify(draft));
	} catch {
		// localStorage unavailable — ignore
	}
}

export function loadDraft(key: string): Draft | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as Draft;
	} catch {
		return null;
	}
}

export function clearDraft(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

/** Validate a comma-separated list of email addresses.
 *  Accepts "user@domain.tld" or "Name <user@domain.tld>" formats. */
export function validateEmails(raw: string): string | null {
	if (!raw.trim()) return "At least one recipient is required";
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	for (const part of parts) {
		// Extract email from "Name <email>" or bare "email"
		const match = part.match(/<([^>]+)>/) || [null, part];
		const email = (match[1] ?? "").trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return `Invalid email address: ${email || part}`;
		}
	}
	return null;
}

export function buildReplySubject(subject: string | null): string {
	if (!subject) return "Re: (no subject)";
	if (/^re:/i.test(subject)) return subject;
	return `Re: ${subject}`;
}

export function buildForwardSubject(subject: string | null): string {
	if (!subject) return "Fwd: (no subject)";
	if (/^fwd:/i.test(subject)) return subject;
	return `Fwd: ${subject}`;
}

export function buildReplyBody(msg: Message): string {
	const d = msg.date ? new Date(msg.date) : null;
	const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "unknown date";
	const header = `\n\nOn ${date}, ${msg.from_name || msg.from_address} wrote:\n`;
	const body = msg.text_body || "";
	const quoted = body
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return header + quoted;
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function buildReplyHtmlBody(msg: Message): string {
	const d = msg.date ? new Date(msg.date) : null;
	const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "unknown date";
	const sender = msg.from_name || msg.from_address;
	const quotedContent = msg.html_body || escapeHtml(msg.text_body || "").replace(/\n/g, "<br>");
	return `<br><br><div>On ${escapeHtml(date)}, ${escapeHtml(sender)} wrote:</div><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedContent}</blockquote>`;
}

export function buildForwardHtmlBody(msg: Message): string {
	const from = msg.from_name
		? `${escapeHtml(msg.from_name)} &lt;${escapeHtml(msg.from_address || "unknown")}&gt;`
		: escapeHtml(msg.from_address || "unknown");
	const date = new Date(msg.date).toLocaleString();
	const forwardedContent = msg.html_body || escapeHtml(msg.text_body || "").replace(/\n/g, "<br>");
	return `<br><br><div>---------- Forwarded message ----------</div><div>From: ${from}</div><div>Date: ${escapeHtml(date)}</div><div>Subject: ${escapeHtml(msg.subject || "(no subject)")}</div><div>To: ${escapeHtml(msg.to_addresses || "")}</div><br>${forwardedContent}`;
}

/** Convert HTML to plain text (strips tags, decodes entities) */
export function htmlToPlainText(html: string): string {
	const div = document.createElement("div");
	div.innerHTML = html;
	// Convert <br> and block elements to newlines
	for (const br of div.querySelectorAll("br")) {
		br.replaceWith("\n");
	}
	for (const el of div.querySelectorAll("p, div, blockquote")) {
		el.prepend(document.createTextNode("\n"));
		el.append(document.createTextNode("\n"));
	}
	return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Convert plain text to simple HTML */
export function plainTextToHtml(text: string): string {
	return escapeHtml(text).replace(/\n/g, "<br>");
}

/** Determine initial format: HTML if replying to/forwarding an HTML message */
export function getInitialFormat(mode: ComposeMode, saved: Draft | null): ComposeFormat {
	if (saved?.format) return saved.format;
	if (mode.type !== "new" && mode.original.html_body) return "html";
	return "plain";
}

export function buildReplyAllCc(msg: Message, userEmail?: string): string {
	// Include all To and CC addresses except the sender (who goes in To)
	// and the current user (who is sending the reply)
	const exclude = new Set<string>();
	if (msg.from_address) exclude.add(msg.from_address.toLowerCase());
	if (userEmail) exclude.add(userEmail.toLowerCase());

	const addresses: string[] = [];
	for (const addr of parseAddressField(msg.to_addresses)) {
		// Extract bare email for comparison (handles "Name <email>" format)
		const email = (addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase();
		if (!exclude.has(email)) {
			addresses.push(addr);
		}
	}
	for (const addr of parseAddressField(msg.cc_addresses)) {
		const email = (addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase();
		if (!exclude.has(email)) {
			addresses.push(addr);
		}
	}
	return addresses.join(", ");
}
