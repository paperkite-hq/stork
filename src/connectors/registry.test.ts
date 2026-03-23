import { describe, expect, test } from "vitest";
import { CloudflareEmailIngestConnector } from "./cloudflare-email.js";
import { ImapIngestConnector } from "./imap.js";
import { createIngestConnector, createSendConnector } from "./registry.js";
import { SesSendConnector } from "./ses.js";
import { SmtpSendConnector } from "./smtp.js";

describe("connector registry", () => {
	test("createIngestConnector creates ImapIngestConnector for type 'imap'", () => {
		const connector = createIngestConnector({
			type: "imap",
			imap: {
				host: "imap.example.com",
				port: 993,
				secure: true,
				auth: { user: "test", pass: "test" },
			},
		});

		expect(connector).toBeInstanceOf(ImapIngestConnector);
		expect(connector.name).toBe("imap");
	});

	test("createIngestConnector creates CloudflareEmailIngestConnector for type 'cloudflare-email'", () => {
		const connector = createIngestConnector({
			type: "cloudflare-email",
			cloudflareEmail: { webhookSecret: "secret-123" },
		});

		expect(connector).toBeInstanceOf(CloudflareEmailIngestConnector);
		expect(connector.name).toBe("cloudflare-email");
	});

	test("createIngestConnector throws for missing imap config", () => {
		expect(() => createIngestConnector({ type: "imap" })).toThrow("IMAP configuration required");
	});

	test("createIngestConnector throws for missing cloudflare-email config", () => {
		expect(() => createIngestConnector({ type: "cloudflare-email" })).toThrow(
			"Cloudflare Email configuration required",
		);
	});

	test("createIngestConnector throws for unknown type", () => {
		expect(() => createIngestConnector({ type: "unknown" as "imap" })).toThrow(
			"Unknown ingest connector type",
		);
	});

	test("createSendConnector creates SmtpSendConnector for type 'smtp'", () => {
		const connector = createSendConnector({
			type: "smtp",
			smtp: {
				host: "smtp.example.com",
				port: 587,
				secure: false,
				auth: { user: "test", pass: "test" },
			},
		});

		expect(connector).toBeInstanceOf(SmtpSendConnector);
		expect(connector.name).toBe("smtp");
	});

	test("createSendConnector creates SesSendConnector for type 'ses'", () => {
		const connector = createSendConnector({
			type: "ses",
			ses: { region: "us-east-1" },
		});

		expect(connector).toBeInstanceOf(SesSendConnector);
		expect(connector.name).toBe("ses");
	});

	test("createSendConnector throws for missing smtp config", () => {
		expect(() => createSendConnector({ type: "smtp" })).toThrow("SMTP configuration required");
	});

	test("createSendConnector throws for missing ses config", () => {
		expect(() => createSendConnector({ type: "ses" })).toThrow("SES configuration required");
	});

	test("createSendConnector throws for unknown type", () => {
		expect(() => createSendConnector({ type: "unknown" as "smtp" })).toThrow(
			"Unknown send connector type",
		);
	});
});
