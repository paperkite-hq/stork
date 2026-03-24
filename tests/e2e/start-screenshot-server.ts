/**
 * Starts a stork server with realistic-looking seed data for documentation screenshots.
 * Uses fixed timestamps so screenshots stay stable across CI runs.
 */
import { serve } from "@hono/node-server";
import { createApp } from "../../src/api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "../../src/test-helpers/test-db.js";

const PORT = 13300;
const db = createTestDb();

// Fixed reference time: Jan 14 2026, 14:00 UTC — stable across CI runs
const REF = new Date("2026-01-14T14:00:00Z").getTime();
const h = (n: number) => REF - n * 3_600_000;

const accountId = createTestAccount(db, {
	name: "Alex Rivera",
	email: "alex@company.io",
	imapHost: "127.0.0.1",
	imapPort: 9993,
	smtpHost: "127.0.0.1",
	smtpPort: 9587,
});

const inboxId = createTestFolder(db, accountId, "INBOX", {
	name: "INBOX",
	specialUse: "\\Inbox",
});
const sentId = createTestFolder(db, accountId, "Sent", {
	name: "Sent",
	specialUse: "\\Sent",
});
createTestFolder(db, accountId, "Drafts", {
	name: "Drafts",
	specialUse: "\\Drafts",
});
createTestFolder(db, accountId, "Trash", {
	name: "Trash",
	specialUse: "\\Trash",
});

const inboxLabelId = createTestLabel(db, accountId, "INBOX", { source: "imap" });
const sentLabelId = createTestLabel(db, accountId, "Sent", { source: "imap" });
createTestLabel(db, accountId, "Drafts", { source: "imap" });
createTestLabel(db, accountId, "Trash", { source: "imap" });

const inboxMessageIds: number[] = [];

function inbox(uid: number, opts: Parameters<typeof createTestMessage>[3], date: number): number {
	const id = createTestMessage(db, accountId, inboxId, uid, {
		...opts,
		date: new Date(date).toISOString(),
	});
	inboxMessageIds.push(id);
	return id;
}

// Thread: design review
const threadMsgId1 = "<design-1@company.io>";
const threadMsgId2 = "<design-2@company.io>";
const threadMsgId3 = "<design-3@company.io>";

const threadId1 = inbox(
	1,
	{
		messageId: threadMsgId1,
		subject: "Re: Q1 design review — final feedback",
		fromAddress: "priya@design.io",
		fromName: "Priya Kapoor",
		toAddresses: '["alex@company.io"]',
		textBody:
			"Thanks for sharing the mockups. Overall I think the layout is solid — the sidebar hierarchy works well. Two things I'd like us to revisit: (1) the compose button placement feels buried below the fold on smaller viewports, and (2) the unread badge styling is inconsistent with the rest of the button states.",
		htmlBody:
			"<p>Thanks for sharing the mockups. Overall I think the layout is solid — the sidebar hierarchy works well. Two things I'd like us to revisit:</p><ol><li>the compose button placement feels buried below the fold on smaller viewports</li><li>the unread badge styling is inconsistent with the rest of the button states</li></ol>",
		flags: "\\Seen",
	},
	h(1),
);

const threadId2 = inbox(
	2,
	{
		messageId: threadMsgId2,
		subject: "Re: Q1 design review — final feedback",
		fromAddress: "mike@company.io",
		fromName: "Mike Thornton",
		toAddresses: '["alex@company.io","priya@design.io"]',
		textBody:
			"Agree with Priya on both points. For the badge, I'd suggest aligning to the pill style we use in the filter chips. Happy to do a quick pass on the CSS if it helps.",
		htmlBody:
			"<p>Agree with Priya on both points. For the badge, I'd suggest aligning to the pill style we use in the filter chips. Happy to do a quick pass on the CSS if it helps.</p>",
		inReplyTo: threadMsgId1,
		references: threadMsgId1,
		flags: "\\Seen",
	},
	h(0.5),
);

inbox(
	3,
	{
		messageId: threadMsgId3,
		subject: "Re: Q1 design review — final feedback",
		fromAddress: "sarah@company.io",
		fromName: "Sarah Chen",
		toAddresses: '["alex@company.io","priya@design.io","mike@company.io"]',
		textBody:
			"Perfect timing — I can slot in the compose fix before Thursday's cut. Mike, yes please on the badge CSS! Let's sync briefly tomorrow.",
		htmlBody:
			"<p>Perfect timing — I can slot in the compose fix before Thursday's cut. Mike, yes please on the badge CSS! Let's sync briefly tomorrow.</p>",
		inReplyTo: threadMsgId2,
		references: `${threadMsgId1} ${threadMsgId2}`,
		flags: "",
	},
	h(0.2),
);

inbox(
	4,
	{
		subject: "Sync tomorrow at 10am?",
		fromAddress: "jordan@company.io",
		fromName: "Jordan Lee",
		toAddresses: '["alex@company.io"]',
		textBody: "Are you free tomorrow at 10am for a quick sync on the roadmap?",
		htmlBody: "<p>Are you free tomorrow at 10am for a quick sync on the roadmap?</p>",
		flags: "",
	},
	h(2),
);

inbox(
	5,
	{
		subject: "Invoice #2841 from Fastmail",
		fromAddress: "billing@fastmail.com",
		fromName: "Fastmail Billing",
		toAddresses: '["alex@company.io"]',
		textBody: "Your invoice for January 2026 is attached.",
		htmlBody: "<p>Your invoice for January 2026 is attached.</p>",
		flags: "\\Seen",
	},
	h(5),
);

inbox(
	6,
	{
		subject: "Deployment complete — v0.8.2",
		fromAddress: "ci@github.com",
		fromName: "GitHub Actions",
		toAddresses: '["alex@company.io"]',
		textBody: "Workflow run deploy-prod completed successfully.",
		htmlBody: "<p>Workflow run <code>deploy-prod</code> completed successfully.</p>",
		flags: "\\Seen",
	},
	h(8),
);

inbox(
	7,
	{
		subject: "Q1 OKR tracking — week 2 update",
		fromAddress: "ops@company.io",
		fromName: "Ops Bot",
		toAddresses: '["team@company.io"]',
		textBody: "Weekly OKR tracking report attached.",
		htmlBody: "<p>Weekly OKR tracking report attached.</p>",
		flags: "\\Seen",
	},
	h(24),
);

inbox(
	8,
	{
		subject: "Your account security summary",
		fromAddress: "security@github.com",
		fromName: "GitHub Security",
		toAddresses: '["alex@company.io"]',
		textBody: "We noticed a new sign-in to your account.",
		htmlBody: "<p>We noticed a new sign-in to your account.</p>",
		flags: "\\Seen",
	},
	h(30),
);

const sentMsgId = createTestMessage(db, accountId, sentId, 1, {
	subject: "Re: Q1 design review — final feedback",
	fromAddress: "alex@company.io",
	fromName: "Alex Rivera",
	toAddresses: '["priya@design.io","mike@company.io","sarah@company.io"]',
	date: new Date(h(0.8)).toISOString(),
	textBody:
		"Great feedback, both. I'll incorporate these into the next iteration. Sarah, Thursday works — let's do 10am.",
	flags: "\\Seen",
});

// Link messages to labels
for (const msgId of inboxMessageIds) {
	addMessageLabel(db, msgId, inboxLabelId);
}
addMessageLabel(db, sentMsgId, sentLabelId);

// Update folder counts (3 unread: threadId3 + Jordan + design thread first reply)
db.prepare("UPDATE folders SET message_count = ?, unread_count = ? WHERE id = ?").run(
	inboxMessageIds.length,
	3,
	inboxId,
);
db.prepare("UPDATE folders SET message_count = 1, unread_count = 0 WHERE id = ?").run(sentId);

const context = createTestContext(db);
const { app } = createApp(context);

if (context.scheduler) await context.scheduler.stop();

console.log(`Screenshot server starting on http://127.0.0.1:${PORT}`);

serve({ port: PORT, fetch: app.fetch });
