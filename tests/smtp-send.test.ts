import { createTransport } from "nodemailer";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MockSmtpServer } from "./helpers/mock-smtp-server.js";

describe("SMTP sending via mock server", () => {
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

	test("sends a plain text email through mock SMTP", async () => {
		const transport = createTransport({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "sender", pass: "secret" },
			tls: { rejectUnauthorized: false },
		});

		await transport.sendMail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Test email",
			text: "Hello from the test suite!",
		});

		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].from).toBe("sender@example.com");
		expect(server.messages[0].to).toContain("recipient@example.com");
		expect(server.messages[0].data).toContain("Test email");
		expect(server.messages[0].data).toContain("Hello from the test suite!");
		expect(server.messages[0].auth?.user).toBe("sender");

		transport.close();
	});

	test("sends email with multiple recipients", async () => {
		server.reset();

		const transport = createTransport({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "sender", pass: "secret" },
			tls: { rejectUnauthorized: false },
		});

		await transport.sendMail({
			from: "sender@example.com",
			to: "alice@example.com, bob@example.com",
			cc: "carol@example.com",
			subject: "Group email",
			text: "Hello everyone!",
		});

		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].to).toContain("alice@example.com");
		expect(server.messages[0].to).toContain("bob@example.com");
		expect(server.messages[0].to).toContain("carol@example.com");

		transport.close();
	});

	test("sends HTML email", async () => {
		server.reset();

		const transport = createTransport({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "sender", pass: "secret" },
			tls: { rejectUnauthorized: false },
		});

		await transport.sendMail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "HTML test",
			html: "<h1>Hello</h1><p>This is an HTML email.</p>",
		});

		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].data).toContain("<h1>Hello</h1>");

		transport.close();
	});

	test("sends reply with threading headers", async () => {
		server.reset();

		const transport = createTransport({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "sender", pass: "secret" },
			tls: { rejectUnauthorized: false },
		});

		await transport.sendMail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Re: Original topic",
			text: "This is my reply.",
			inReplyTo: "<original@example.com>",
			references: "<original@example.com>",
		});

		expect(server.messages).toHaveLength(1);
		expect(server.messages[0].data).toContain("In-Reply-To: <original@example.com>");
		expect(server.messages[0].data).toContain("References: <original@example.com>");

		transport.close();
	});
});
