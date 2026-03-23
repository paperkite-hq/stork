import { describe, expect, test } from "vitest";
import { CloudflareEmailIngestConnector } from "./cloudflare-email.js";
import type { CloudflareEmailPayload } from "./cloudflare-email.js";

/** Builds a minimal RFC 5322 message and returns it as base64 */
function buildRawEmail(opts: {
	from?: string;
	to?: string;
	cc?: string;
	subject?: string;
	body?: string;
	messageId?: string;
	inReplyTo?: string;
	hasAttachment?: boolean;
}): string {
	const lines: string[] = [];
	if (opts.messageId) lines.push(`Message-ID: ${opts.messageId}`);
	if (opts.from) lines.push(`From: ${opts.from}`);
	if (opts.to) lines.push(`To: ${opts.to}`);
	if (opts.cc) lines.push(`Cc: ${opts.cc}`);
	if (opts.subject) lines.push(`Subject: ${opts.subject}`);
	if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
	lines.push("Date: Mon, 01 Jan 2024 12:00:00 +0000");

	if (opts.hasAttachment) {
		const boundary = "----boundary123";
		lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
		lines.push("");
		lines.push(`--${boundary}`);
		lines.push("Content-Type: text/plain");
		lines.push("");
		lines.push(opts.body ?? "");
		lines.push(`--${boundary}`);
		lines.push('Content-Type: text/plain; name="test.txt"');
		lines.push('Content-Disposition: attachment; filename="test.txt"');
		lines.push("");
		lines.push("attachment content");
		lines.push(`--${boundary}--`);
	} else {
		lines.push("Content-Type: text/plain");
		lines.push("");
		lines.push(opts.body ?? "");
	}

	return Buffer.from(lines.join("\r\n")).toString("base64");
}

describe("CloudflareEmailIngestConnector", () => {
	function createConnector(): CloudflareEmailIngestConnector {
		return new CloudflareEmailIngestConnector({ webhookSecret: "test-secret-123" });
	}

	test("name property is 'cloudflare-email'", () => {
		const connector = createConnector();
		expect(connector.name).toBe("cloudflare-email");
	});

	test("connect/disconnect toggle connected state", async () => {
		const connector = createConnector();
		expect(connector.isConnected).toBe(false);
		await connector.connect();
		expect(connector.isConnected).toBe(true);
		await connector.disconnect();
		expect(connector.isConnected).toBe(false);
	});

	test("listFolders returns a single INBOX", async () => {
		const connector = createConnector();
		const folders = await connector.listFolders();
		expect(folders).toHaveLength(1);
		expect(folders[0].path).toBe("INBOX");
		expect(folders[0].name).toBe("Inbox");
	});

	test("pushMessage parses email and assigns incrementing UIDs", async () => {
		const connector = createConnector();
		const raw = buildRawEmail({
			from: "Alice <alice@example.com>",
			to: "bob@example.com",
			subject: "Hello from CF Workers",
			body: "Message body here",
			messageId: "<msg1@example.com>",
		});

		const uid1 = await connector.pushMessage({
			from: "alice@example.com",
			to: "bob@example.com",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});
		expect(uid1).toBe(1);

		const uid2 = await connector.pushMessage({
			from: "carol@example.com",
			to: "bob@example.com",
			raw: buildRawEmail({ from: "carol@example.com", subject: "Second" }),
			rawSize: 100,
		});
		expect(uid2).toBe(2);
		expect(connector.pendingCount).toBe(2);
	});

	test("fetchMessages yields messages after sinceUid", async () => {
		const connector = createConnector();

		// Push 3 messages
		for (let i = 0; i < 3; i++) {
			await connector.pushMessage({
				from: `user${i}@example.com`,
				to: "inbox@example.com",
				raw: buildRawEmail({ from: `user${i}@example.com`, subject: `Msg ${i}` }),
				rawSize: 50,
			});
		}

		// Fetch all (sinceUid = 0)
		const all: unknown[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			all.push(msg);
		}
		expect(all).toHaveLength(3);

		// Fetch only after uid 2
		const after2: unknown[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 2)) {
			after2.push(msg);
		}
		expect(after2).toHaveLength(1);
	});

	test("fetchMessages returns empty for no buffered messages", async () => {
		const connector = createConnector();
		const messages: unknown[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}
		expect(messages).toHaveLength(0);
	});

	test("pushMessage extracts CC addresses", async () => {
		const connector = createConnector();
		const raw = buildRawEmail({
			from: "alice@example.com",
			to: "bob@example.com",
			cc: "carol@example.com, dave@example.com",
			subject: "CC test",
		});

		await connector.pushMessage({
			from: "alice@example.com",
			to: "bob@example.com",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});

		const messages: { cc?: { address: string }[] }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}
		expect(messages[0].cc).toBeDefined();
		expect(messages[0].cc?.length).toBe(2);
	});

	test("pushMessage detects attachments", async () => {
		const connector = createConnector();
		const raw = buildRawEmail({
			from: "alice@example.com",
			to: "bob@example.com",
			subject: "With attachment",
			body: "See attached",
			hasAttachment: true,
		});

		await connector.pushMessage({
			from: "alice@example.com",
			to: "bob@example.com",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});

		const messages: { hasAttachments?: boolean }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}
		expect(messages[0].hasAttachments).toBe(true);
	});

	test("acknowledge clears messages up to the given UID", async () => {
		const connector = createConnector();

		for (let i = 0; i < 3; i++) {
			await connector.pushMessage({
				from: `user${i}@example.com`,
				to: "inbox@example.com",
				raw: buildRawEmail({ subject: `Msg ${i}` }),
				rawSize: 50,
			});
		}
		expect(connector.pendingCount).toBe(3);

		connector.acknowledge(2);
		expect(connector.pendingCount).toBe(1);

		const remaining: { uid: number }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			remaining.push(msg);
		}
		expect(remaining).toHaveLength(1);
		expect(remaining[0].uid).toBe(3);
	});

	test("validateSecret accepts correct secret", () => {
		const connector = createConnector();
		expect(connector.validateSecret("test-secret-123")).toBe(true);
	});

	test("validateSecret rejects wrong secret", () => {
		const connector = createConnector();
		expect(connector.validateSecret("wrong-secret")).toBe(false);
		expect(connector.validateSecret("")).toBe(false);
		expect(connector.validateSecret("test-secret-12")).toBe(false);
	});

	test("pushMessage handles email with no from/to/cc headers", async () => {
		const connector = createConnector();
		// Build a minimal email with no From, To, or CC headers
		const raw = buildRawEmail({
			subject: "Header-less email",
			body: "No sender or recipient headers",
		});

		const uid = await connector.pushMessage({
			from: "",
			to: "",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});

		const messages: { from?: { address: string }; to?: unknown[]; cc?: unknown[] }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", uid - 1)) {
			messages.push(msg);
		}
		expect(messages).toHaveLength(1);
		// from should be undefined when no From header is present
		expect(messages[0].from).toBeUndefined();
		// to should be undefined when no To header is present
		expect(messages[0].to).toBeUndefined();
		// cc should be undefined when no CC header is present
		expect(messages[0].cc).toBeUndefined();
	});

	test("pushMessage handles email with HTML body (false-y html)", async () => {
		const connector = createConnector();
		// A plain text email — parsed.html will be false, not a string
		const raw = buildRawEmail({
			from: "alice@example.com",
			to: "bob@example.com",
			subject: "Plain text only",
			body: "No HTML content here",
		});

		await connector.pushMessage({
			from: "alice@example.com",
			to: "bob@example.com",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});

		const messages: { htmlBody?: string; textBody?: string }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}
		expect(messages).toHaveLength(1);
		// htmlBody should be undefined for plain-text-only emails
		expect(messages[0].htmlBody).toBeUndefined();
		expect(messages[0].textBody).toBeDefined();
	});

	test("pushMessage extracts inReplyTo for threading", async () => {
		const connector = createConnector();
		const raw = buildRawEmail({
			from: "alice@example.com",
			to: "bob@example.com",
			subject: "Re: Original",
			inReplyTo: "<original@example.com>",
		});

		await connector.pushMessage({
			from: "alice@example.com",
			to: "bob@example.com",
			raw,
			rawSize: Buffer.from(raw, "base64").length,
		});

		const messages: { inReplyTo?: string }[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}
		expect(messages[0].inReplyTo).toBe("<original@example.com>");
	});
});
