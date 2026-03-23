import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MockSmtpServer } from "../test-helpers/mock-smtp-server.js";
import { SmtpSendConnector } from "./smtp.js";
import type { OutgoingMessage } from "./types.js";

describe("SmtpSendConnector", () => {
	let server: MockSmtpServer;
	let port: number;

	beforeAll(async () => {
		server = new MockSmtpServer({
			user: "sender",
			pass: "secret",
			requireAuth: true,
		});
		port = await server.start();
	});

	afterAll(async () => {
		await server.stop();
	});

	function createConnector(): SmtpSendConnector {
		return new SmtpSendConnector({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "sender", pass: "secret" },
		});
	}

	test("sends a plain text email", async () => {
		server.reset();
		const connector = createConnector();

		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "Test via connector",
			textBody: "Hello from SmtpSendConnector!",
		};

		const result = await connector.send(message);

		expect(result.messageId).toBeTruthy();
		expect(result.accepted).toContain("recipient@example.com");
		expect(result.rejected).toHaveLength(0);

		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].from).toBe("sender@example.com");
		expect(server.messages[0].to).toContain("recipient@example.com");
		expect(server.messages[0].data).toContain("Hello from SmtpSendConnector!");
	});

	test("sends HTML email with CC and BCC", async () => {
		server.reset();
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

		expect(result.accepted.length).toBeGreaterThan(0);
		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].data).toContain("<h1>Hello</h1>");
	});

	test("sends reply with threading headers", async () => {
		server.reset();
		const connector = createConnector();

		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "Re: Original topic",
			textBody: "This is my reply.",
			inReplyTo: "<original@example.com>",
			references: ["<original@example.com>", "<earlier@example.com>"],
		};

		const result = await connector.send(message);

		expect(result.messageId).toBeTruthy();
		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].data).toContain("In-Reply-To: <original@example.com>");
		expect(server.messages[0].data).toContain("References:");
	});

	test("sends email with attachments", async () => {
		server.reset();
		const connector = createConnector();

		const message: OutgoingMessage = {
			from: "sender@example.com",
			to: ["recipient@example.com"],
			subject: "With attachment",
			textBody: "See attached.",
			attachments: [
				{
					filename: "test.txt",
					contentType: "text/plain",
					content: Buffer.from("file contents here"),
				},
			],
		};

		const result = await connector.send(message);

		expect(result.messageId).toBeTruthy();
		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].data).toContain("test.txt");
	});

	test("verify() returns true with valid credentials", async () => {
		const connector = createConnector();
		const valid = await connector.verify();
		expect(valid).toBe(true);
	});

	test("verify() returns false with invalid credentials", async () => {
		const connector = new SmtpSendConnector({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "wrong", pass: "wrong" },
		});
		const valid = await connector.verify();
		expect(valid).toBe(false);
	});

	test("name property is 'smtp'", () => {
		const connector = createConnector();
		expect(connector.name).toBe("smtp");
	});
});
