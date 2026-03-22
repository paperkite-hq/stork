import { describe, expect, test } from "vitest";
import { ImapIngestConnector } from "../../src/connectors/imap.js";
import { createIngestConnector, createSendConnector } from "../../src/connectors/registry.js";
import { SmtpSendConnector } from "../../src/connectors/smtp.js";

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

	test("createIngestConnector throws for missing imap config", () => {
		expect(() => createIngestConnector({ type: "imap" })).toThrow("IMAP configuration required");
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

	test("createSendConnector throws for missing smtp config", () => {
		expect(() => createSendConnector({ type: "smtp" })).toThrow("SMTP configuration required");
	});

	test("createSendConnector throws for unknown type", () => {
		expect(() => createSendConnector({ type: "unknown" as "smtp" })).toThrow(
			"Unknown send connector type",
		);
	});
});
