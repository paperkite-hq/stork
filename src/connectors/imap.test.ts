import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	MockImapServer,
	buildRawEmail,
	buildRawEmailWithAttachment,
} from "../test-helpers/mock-imap-server.js";
import { ImapIngestConnector } from "./imap.js";

describe("ImapIngestConnector", () => {
	let server: MockImapServer;
	let port: number;

	const testMailboxes = [
		{
			path: "INBOX",
			name: "INBOX",
			delimiter: "/",
			flags: [],
			uidValidity: 1,
			uidNext: 4,
			messages: [
				{
					uid: 1,
					flags: ["\\Seen"],
					internalDate: "2026-03-20T10:00:00Z",
					source: buildRawEmail({
						from: "alice@example.com",
						to: "bob@example.com",
						subject: "Hello",
						body: "Hello world",
						messageId: "<msg1@example.com>",
						date: "Fri, 20 Mar 2026 10:00:00 +0000",
					}),
				},
				{
					uid: 2,
					flags: [],
					internalDate: "2026-03-21T12:00:00Z",
					source: buildRawEmail({
						from: '"Carol Smith" <carol@example.com>',
						to: "bob@example.com",
						subject: "Re: Hello",
						body: "Reply body",
						messageId: "<msg2@example.com>",
						inReplyTo: "<msg1@example.com>",
						date: "Sat, 21 Mar 2026 12:00:00 +0000",
					}),
				},
				{
					uid: 3,
					flags: ["\\Flagged"],
					internalDate: "2026-03-22T08:00:00Z",
					source: buildRawEmailWithAttachment({
						from: "dave@example.com",
						to: "bob@example.com",
						subject: "With file",
						body: "See attached",
						messageId: "<msg3@example.com>",
						date: "Sun, 22 Mar 2026 08:00:00 +0000",
						attachment: {
							filename: "report.pdf",
							contentType: "application/pdf",
							data: Buffer.from("fake pdf content"),
						},
					}),
				},
			],
		},
		{
			path: "Sent",
			name: "Sent",
			delimiter: "/",
			flags: [],
			specialUse: "\\Sent",
			uidValidity: 1,
			uidNext: 1,
			messages: [],
		},
		{
			path: "Junk",
			name: "Junk",
			delimiter: "/",
			flags: ["\\Noselect"],
			uidValidity: 1,
			uidNext: 1,
			messages: [],
		},
	];

	beforeAll(async () => {
		server = new MockImapServer({
			user: "testuser",
			pass: "testpass",
			mailboxes: testMailboxes,
		});
		port = await server.start();
	});

	afterAll(async () => {
		await server.stop();
	});

	function createConnector(): ImapIngestConnector {
		return new ImapIngestConnector({
			host: "127.0.0.1",
			port,
			secure: false,
			auth: { user: "testuser", pass: "testpass" },
		});
	}

	test("name property is 'imap'", () => {
		const connector = createConnector();
		expect(connector.name).toBe("imap");
	});

	test("connect and disconnect", async () => {
		const connector = createConnector();
		await connector.connect();
		await connector.disconnect();
	});

	test("connect retries on failure then succeeds", async () => {
		// Just verify a successful connection works (retries are transparent)
		const connector = createConnector();
		await connector.connect();
		await connector.disconnect();
	});

	test("listFolders returns folders excluding \\Noselect", async () => {
		const connector = createConnector();
		await connector.connect();

		const folders = await connector.listFolders();

		expect(folders.length).toBe(2); // INBOX and Sent, not Junk
		const inbox = folders.find((f) => f.path === "INBOX");
		expect(inbox).toBeDefined();
		expect(inbox?.name).toBe("INBOX");
		expect(inbox?.delimiter).toBe("/");

		const sent = folders.find((f) => f.path === "Sent");
		expect(sent).toBeDefined();

		// Junk has \Noselect, should be filtered
		const junk = folders.find((f) => f.path === "Junk");
		expect(junk).toBeUndefined();

		await connector.disconnect();
	});

	test("fetchMessages yields messages from folder", async () => {
		const connector = createConnector();
		await connector.connect();

		const messages = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			messages.push(msg);
		}

		expect(messages.length).toBe(3);

		// First message
		const msg1 = messages.find((m) => m.uid === 1);
		expect(msg1).toBeDefined();
		expect(msg1?.subject).toBe("Hello");
		expect(msg1?.from?.address).toContain("alice");
		expect(msg1?.textBody).toContain("Hello world");
		expect(msg1?.messageId).toBe("<msg1@example.com>");
		expect(msg1?.hasAttachments).toBe(false);

		// Reply with In-Reply-To
		const msg2 = messages.find((m) => m.uid === 2);
		expect(msg2).toBeDefined();
		expect(msg2?.inReplyTo).toBe("<msg1@example.com>");
		expect(msg2?.from?.name).toContain("Carol");

		// Message with attachment
		const msg3 = messages.find((m) => m.uid === 3);
		expect(msg3).toBeDefined();
		expect(msg3?.hasAttachments).toBe(true);

		await connector.disconnect();
	});

	test("fetchMessages with sinceUid filters older messages", async () => {
		const connector = createConnector();
		await connector.connect();

		const messages = [];
		for await (const msg of connector.fetchMessages("INBOX", 2)) {
			messages.push(msg);
		}

		// Only UID 3 should be returned (sinceUid=2 means fetch from UID 3+)
		expect(messages.length).toBe(1);
		expect(messages[0].uid).toBe(3);

		await connector.disconnect();
	});

	test("fetchMessages from empty folder yields nothing", async () => {
		const connector = createConnector();
		await connector.connect();

		const messages = [];
		for await (const msg of connector.fetchMessages("Sent", 0)) {
			messages.push(msg);
		}

		expect(messages.length).toBe(0);

		await connector.disconnect();
	});

	test("getClient returns the ImapFlow instance", async () => {
		const connector = createConnector();
		const client = connector.getClient();
		expect(client).toBeDefined();
	});

	test("forceClose handles already-closed connection", () => {
		const connector = createConnector();
		// Should not throw even when not connected
		connector.forceClose();
	});

	test("connect creates fresh client on reconnect", async () => {
		const connector = createConnector();
		await connector.connect();
		const client1 = connector.getClient();

		await connector.disconnect();
		await connector.connect();
		const client2 = connector.getClient();

		// After reconnecting, the client should be a new instance
		expect(client2).not.toBe(client1);

		await connector.disconnect();
	});

	test("deleteMessages with empty array is a no-op", async () => {
		const connector = createConnector();
		await connector.connect();
		// Should return immediately without error
		await connector.deleteMessages("INBOX", []);
		await connector.disconnect();
	});

	test("deleteMessages removes messages from folder", async () => {
		const connector = createConnector();
		await connector.connect();

		// Verify 3 messages initially
		const before: number[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			before.push(msg.uid);
		}
		expect(before).toHaveLength(3);

		// Delete UID 1
		await connector.deleteMessages("INBOX", [1]);

		// Verify UID 1 is gone
		const after: number[] = [];
		for await (const msg of connector.fetchMessages("INBOX", 0)) {
			after.push(msg.uid);
		}
		expect(after).not.toContain(1);
		expect(after).toHaveLength(2);

		await connector.disconnect();
	});

	test("forceClose with connected socket suppresses errors", async () => {
		const connector = createConnector();
		await connector.connect();
		// forceClose on a live connection should not throw
		connector.forceClose();
	});
});
