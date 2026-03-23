import { beforeEach, describe, expect, test, vi } from "vitest";
import { SesSendConnector } from "./ses.js";
import type { OutgoingMessage } from "./types.js";

/**
 * Mock the @aws-sdk/client-sesv2 module.
 * Since the AWS SDK is an optional peer dependency, we mock it entirely
 * so tests don't require installing the real SDK.
 */
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-sesv2", () => {
	return {
		SESv2Client: class MockSESv2Client {
			send = mockSend;
			destroy = vi.fn();
		},
		SendEmailCommand: class MockSendEmailCommand {
			input: unknown;
			constructor(input: unknown) {
				this.input = input;
			}
		},
		GetAccountCommand: class MockGetAccountCommand {
			input: unknown;
			constructor(input: unknown) {
				this.input = input;
			}
		},
	};
});

describe("SesSendConnector", () => {
	beforeEach(() => {
		mockSend.mockReset();
	});

	function createConnector(): SesSendConnector {
		return new SesSendConnector({
			region: "us-east-1",
			credentials: {
				accessKeyId: "AKIAEXAMPLE",
				secretAccessKey: "secret123",
			},
		});
	}

	test("name property is 'ses'", () => {
		const connector = createConnector();
		expect(connector.name).toBe("ses");
	});

	test("sends a plain text email via SES", async () => {
		mockSend.mockResolvedValueOnce({ MessageId: "ses-msg-001" });

		const connector = createConnector();
		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "Test via SES",
			textBody: "Hello from SesSendConnector!",
		};

		const result = await connector.send(message);

		expect(result.messageId).toBe("ses-msg-001");
		expect(result.accepted).toContain("recipient@example.com");
		expect(result.rejected).toHaveLength(0);
		expect(mockSend).toHaveBeenCalledOnce();

		// Verify the command has Raw content (RFC 5322 message)
		const command = mockSend.mock.calls[0][0];
		expect(command.input).toHaveProperty("Content");
		expect(command.input.Content).toHaveProperty("Raw");
		expect(command.input.Content.Raw).toHaveProperty("Data");
	});

	test("sends HTML email with CC and BCC via SES", async () => {
		mockSend.mockResolvedValueOnce({ MessageId: "ses-msg-002" });

		const connector = createConnector();
		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["alice@example.com"],
			cc: ["bob@example.com"],
			bcc: ["carol@example.com"],
			subject: "HTML test",
			htmlBody: "<h1>Hello</h1><p>HTML content</p>",
		};

		const result = await connector.send(message);

		expect(result.messageId).toBe("ses-msg-002");
		expect(result.accepted).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
	});

	test("sends email with attachments via SES", async () => {
		mockSend.mockResolvedValueOnce({ MessageId: "ses-msg-003" });

		const connector = createConnector();
		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "With attachment",
			textBody: "See attached.",
			attachments: [
				{
					filename: "report.pdf",
					contentType: "application/pdf",
					content: Buffer.from("fake pdf content"),
				},
			],
		};

		const result = await connector.send(message);

		expect(result.messageId).toBe("ses-msg-003");
		expect(result.accepted).toContain("recipient@example.com");
	});

	test("sends reply with threading headers via SES", async () => {
		mockSend.mockResolvedValueOnce({ MessageId: "ses-msg-004" });

		const connector = createConnector();
		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "Re: Thread topic",
			textBody: "This is my reply.",
			inReplyTo: "<original@example.com>",
			references: ["<original@example.com>", "<earlier@example.com>"],
		};

		const result = await connector.send(message);

		expect(result.messageId).toBe("ses-msg-004");

		// The raw message should contain threading headers
		const command = mockSend.mock.calls[0][0];
		const rawData = command.input.Content.Raw.Data;
		const rawString = Buffer.isBuffer(rawData)
			? rawData.toString()
			: typeof rawData === "string"
				? rawData
				: new TextDecoder().decode(rawData);
		expect(rawString).toContain("In-Reply-To: <original@example.com>");
		expect(rawString).toContain("References:");
	});

	test("verify() returns true when GetAccount succeeds", async () => {
		mockSend.mockResolvedValueOnce({});

		const connector = createConnector();
		const valid = await connector.verify();
		expect(valid).toBe(true);
	});

	test("verify() returns false when GetAccount fails", async () => {
		mockSend.mockRejectedValueOnce(new Error("InvalidClientTokenId"));

		const connector = createConnector();
		const valid = await connector.verify();
		expect(valid).toBe(false);
	});

	test("handles missing MessageId in response", async () => {
		mockSend.mockResolvedValueOnce({});

		const connector = createConnector();
		const result = await connector.send({
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "No ID",
			textBody: "Test",
		});

		expect(result.messageId).toBe("");
		expect(result.accepted).toContain("recipient@example.com");
	});

	test("destroy() cleans up the client", async () => {
		mockSend.mockResolvedValueOnce({ MessageId: "test" });

		const connector = createConnector();
		// Trigger client creation
		await connector.send({
			from: "a@b.com",
			to: ["c@d.com"],
			subject: "test",
			textBody: "test",
		});

		// Should not throw
		connector.destroy();
	});

	test("constructor accepts config without explicit credentials", () => {
		const connector = new SesSendConnector({ region: "eu-west-1" });
		expect(connector.name).toBe("ses");
	});

	test("getClient throws descriptive error when AWS SDK is not installed", async () => {
		// Temporarily make the SESv2Client constructor throw to simulate missing SDK
		const sdk = await import("@aws-sdk/client-sesv2");
		const OriginalClient = sdk.SESv2Client;
		// @ts-expect-error — override for testing
		sdk.SESv2Client = class ThrowingClient {
			constructor() {
				throw new Error("Cannot find module '@aws-sdk/client-sesv2'");
			}
		};

		const connector = new SesSendConnector({ region: "us-east-1" });
		await expect(
			connector.send({
				from: "a@b.com",
				to: ["c@d.com"],
				subject: "test",
				textBody: "test",
			}),
		).rejects.toThrow("@aws-sdk/client-sesv2 is required");

		// Restore
		sdk.SESv2Client = OriginalClient;
	});

	test("destroy() is a no-op when no client has been created", () => {
		const connector = createConnector();
		// Should not throw when called without prior send()
		connector.destroy();
	});
});
