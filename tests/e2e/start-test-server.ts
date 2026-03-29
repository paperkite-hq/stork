/**
 * Starts a stork server with pre-seeded test data for E2E tests.
 * Used by Playwright's webServer config.
 */
import { serve } from "@hono/node-server";
import { createApp } from "../../src/api/server.js";
import {
	addMessageLabel,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestIdentity,
	createTestLabel,
	createTestMessage,
} from "../../src/test-helpers/test-db.js";

const PORT = 13200;
const db = createTestDb();

// Seed test data
const identityId = createTestIdentity(db, {
	name: "E2E Test Account",
	email: "e2e@test.local",
	imapHost: "127.0.0.1",
	imapPort: 9993,
	smtpHost: "127.0.0.1",
	smtpPort: 9587,
});

const inboxId = createTestFolder(db, identityId, "INBOX", {
	name: "INBOX",
	specialUse: "\\Inbox",
});
const sentId = createTestFolder(db, identityId, "Sent", {
	name: "Sent",
	specialUse: "\\Sent",
});
const draftsId = createTestFolder(db, identityId, "Drafts", {
	name: "Drafts",
	specialUse: "\\Drafts",
});
const trashId = createTestFolder(db, identityId, "Trash", {
	name: "Trash",
	specialUse: "\\Trash",
});

// Create IMAP-sourced labels (mirrors the folders — populated by IMAP sync in production)
const inboxLabelId = createTestLabel(db, "INBOX", { source: "imap" });
const sentLabelId = createTestLabel(db, "Sent", { source: "imap" });
const draftsLabelId = createTestLabel(db, "Drafts", { source: "imap" });
createTestLabel(db, "Trash", { source: "imap" });

// Create inbox messages with varied content
const now = new Date();
const inboxMessageIds: number[] = [];
for (let i = 1; i <= 10; i++) {
	const date = new Date(now.getTime() - i * 3600_000);
	const msgId = createTestMessage(db, identityId, inboxId, i, {
		subject: `E2E Test Email #${i}`,
		fromAddress: `sender${i}@example.com`,
		fromName: `Sender ${i}`,
		toAddresses: '["e2e@test.local"]',
		date: date.toISOString(),
		textBody: `This is the body of test email number ${i}. It contains some text for testing purposes.`,
		htmlBody: `<p>This is the <strong>HTML body</strong> of test email number ${i}.</p>`,
		flags: i <= 3 ? "" : "\\Seen",
	});
	inboxMessageIds.push(msgId);
}

// Create a starred message
const starredMsgId = createTestMessage(db, identityId, inboxId, 11, {
	subject: "Important Starred Email",
	fromAddress: "vip@example.com",
	fromName: "VIP Sender",
	toAddresses: '["e2e@test.local"]',
	date: new Date(now.getTime() - 100_000).toISOString(),
	textBody: "This is a very important email that has been starred.",
	flags: "\\Seen,\\Flagged",
});
inboxMessageIds.push(starredMsgId);

// Create a threaded conversation
const threadMsgId1 = "<thread-1@test.local>";
const threadMsgId2 = "<thread-2@test.local>";
const threadMsgId3 = "<thread-3@test.local>";

const thread1Id = createTestMessage(db, identityId, inboxId, 12, {
	messageId: threadMsgId1,
	subject: "Thread: Project Discussion",
	fromAddress: "alice@example.com",
	fromName: "Alice",
	toAddresses: '["e2e@test.local"]',
	date: new Date(now.getTime() - 7200_000).toISOString(),
	textBody: "Let's discuss the project timeline.",
	flags: "\\Seen",
});
inboxMessageIds.push(thread1Id);

const thread2Id = createTestMessage(db, identityId, inboxId, 13, {
	messageId: threadMsgId2,
	subject: "Re: Thread: Project Discussion",
	fromAddress: "e2e@test.local",
	fromName: "E2E Test",
	toAddresses: '["alice@example.com"]',
	date: new Date(now.getTime() - 3600_000).toISOString(),
	textBody: "Sounds good, how about next week?",
	inReplyTo: threadMsgId1,
	references: threadMsgId1,
	flags: "\\Seen",
});
inboxMessageIds.push(thread2Id);

const thread3Id = createTestMessage(db, identityId, inboxId, 14, {
	messageId: threadMsgId3,
	subject: "Re: Thread: Project Discussion",
	fromAddress: "alice@example.com",
	fromName: "Alice",
	toAddresses: '["e2e@test.local"]',
	date: new Date(now.getTime() - 1800_000).toISOString(),
	textBody: "Next week works for me!",
	inReplyTo: threadMsgId2,
	references: `${threadMsgId1} ${threadMsgId2}`,
	flags: "\\Seen",
});
inboxMessageIds.push(thread3Id);

// Create sent messages
const sentMsgId = createTestMessage(db, identityId, sentId, 1, {
	subject: "Outgoing Test",
	fromAddress: "e2e@test.local",
	fromName: "E2E Test Account",
	toAddresses: '["recipient@example.com"]',
	date: new Date(now.getTime() - 5000_000).toISOString(),
	textBody: "This is a sent message.",
	flags: "\\Seen",
});

// Create a message with attachment metadata
const attachMsgId = createTestMessage(db, identityId, inboxId, 15, {
	subject: "Email with Attachment",
	fromAddress: "files@example.com",
	fromName: "File Sender",
	toAddresses: '["e2e@test.local"]',
	date: new Date(now.getTime() - 500_000).toISOString(),
	textBody: "Please see the attached document.",
	hasAttachments: 1,
	flags: "\\Seen",
});
inboxMessageIds.push(attachMsgId);

// Add attachment record
db.prepare(`
	INSERT INTO attachments (message_id, filename, content_type, size, data)
	VALUES (?, ?, ?, ?, ?)
`).run(attachMsgId, "document.pdf", "application/pdf", 12345, Buffer.from("fake pdf content"));

// Link messages to labels (mirrors what IMAP sync does in production)
for (const msgId of inboxMessageIds) {
	addMessageLabel(db, msgId, inboxLabelId);
}
addMessageLabel(db, sentMsgId, sentLabelId);

// Drafts label has no messages (so the "empty folder" test passes)
void draftsLabelId;

// Update folder counts
db.prepare("UPDATE folders SET message_count = ?, unread_count = ? WHERE id = ?").run(
	15,
	3,
	inboxId,
);
db.prepare("UPDATE folders SET message_count = 1, unread_count = 0 WHERE id = ?").run(sentId);

// Refresh cached label counts so the UI shows correct unread badges.
// (Normally maintained by refreshLabelCounts() at the end of each sync cycle.)
db.prepare(`
	UPDATE labels
	SET
		message_count = (SELECT COUNT(*) FROM message_labels WHERE label_id = labels.id),
		unread_count = (
			SELECT COUNT(*) FROM message_labels ml
			JOIN messages m ON m.id = ml.message_id
			WHERE ml.label_id = labels.id
			AND (m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%')
		)
`).run();

// No cached counts on identities table — count endpoints use live queries.

const context = createTestContext(db);
const { app } = createApp(context);

// Don't actually try to sync — we have no real IMAP server
if (context.scheduler) await context.scheduler.stop();

console.log(`E2E test server starting on http://127.0.0.1:${PORT}`);

serve({ port: PORT, fetch: app.fetch });
