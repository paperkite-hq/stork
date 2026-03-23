/**
 * Captures screenshots of the Stork UI for README documentation.
 * Uses Playwright to render the app with realistic seed data.
 *
 * Usage: npx tsx scripts/capture-screenshots.ts
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { createApp } from "../src/api/server.js";
import {
	addMessageLabel,
	createTestAccount,
	createTestContext,
	createTestDb,
	createTestFolder,
	createTestLabel,
	createTestMessage,
} from "../src/test-helpers/test-db.js";

const PORT = 13250;
const OUTPUT_DIR = join(import.meta.dirname, "..", "docs", "screenshots");

// Seed realistic-looking email data
function seedData() {
	const db = createTestDb();

	const accountId = createTestAccount(db, {
		name: "Alex Chen",
		email: "alex@stork.email",
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

	const now = new Date();
	const inboxMsgIds: number[] = [];

	// Realistic inbox messages
	const emails = [
		{
			subject: "Your API keys have been rotated",
			fromAddress: "security@stripe.com",
			fromName: "Stripe",
			textBody:
				"Your live API keys were rotated as requested. The old keys will stop working in 24 hours.",
			htmlBody:
				"<p>Your live API keys were rotated as requested. The old keys will stop working in 24 hours.</p>",
			flags: "",
			hoursAgo: 0.5,
		},
		{
			subject: "Re: Q2 infrastructure budget review",
			fromAddress: "maria.santos@company.com",
			fromName: "Maria Santos",
			textBody:
				"I reviewed the numbers — we can probably cut the staging cluster costs by 30% if we move to spot instances.",
			htmlBody:
				"<p>I reviewed the numbers — we can probably cut the staging cluster costs by 30% if we move to spot instances.</p>",
			flags: "",
			hoursAgo: 1,
		},
		{
			subject: "Invitation: Architecture review — Wednesday 2pm",
			fromAddress: "calendar@google.com",
			fromName: "Google Calendar",
			textBody: "You have been invited to Architecture review on Wednesday at 2:00 PM PST.",
			htmlBody:
				"<p>You have been invited to <strong>Architecture review</strong> on Wednesday at 2:00 PM PST.</p>",
			flags: "",
			hoursAgo: 2,
		},
		{
			subject: "PR #847: Migrate auth middleware to OIDC",
			fromAddress: "notifications@github.com",
			fromName: "GitHub",
			textBody:
				"@jordan-lee requested your review on PR #847. 14 files changed, 342 additions, 89 deletions.",
			htmlBody:
				"<p><strong>@jordan-lee</strong> requested your review on PR #847. 14 files changed, 342 additions, 89 deletions.</p>",
			flags: "\\Seen",
			hoursAgo: 3,
		},
		{
			subject: "Monthly billing summary — March 2026",
			fromAddress: "billing@aws.amazon.com",
			fromName: "AWS Billing",
			textBody:
				"Your AWS charges for March 2026: $2,847.33. View your detailed bill in the console.",
			htmlBody:
				"<p>Your AWS charges for March 2026: <strong>$2,847.33</strong>. View your detailed bill in the console.</p>",
			flags: "\\Seen",
			hoursAgo: 5,
		},
		{
			subject: "Your Hetzner server cx41-prod-02 is back online",
			fromAddress: "support@hetzner.com",
			fromName: "Hetzner",
			textBody:
				"The maintenance window for your server cx41-prod-02 has completed. All services are operational.",
			htmlBody:
				"<p>The maintenance window for your server <code>cx41-prod-02</code> has completed. All services are operational.</p>",
			flags: "\\Seen",
			hoursAgo: 8,
		},
		{
			subject: "Design review notes from today",
			fromAddress: "priya.patel@company.com",
			fromName: "Priya Patel",
			textBody:
				"Here are the notes from today's design review. Main takeaway: we should simplify the onboarding flow.",
			htmlBody:
				"<p>Here are the notes from today's design review. Main takeaway: we should simplify the onboarding flow.</p>",
			flags: "\\Seen",
			hoursAgo: 10,
		},
		{
			subject: "Re: Database migration plan",
			fromAddress: "kevin.wu@company.com",
			fromName: "Kevin Wu",
			textBody:
				"Ran the migration on staging — zero downtime, all assertions passed. Ready for prod whenever you are.",
			htmlBody:
				"<p>Ran the migration on staging — zero downtime, all assertions passed. Ready for prod whenever you are.</p>",
			flags: "\\Seen,\\Flagged",
			hoursAgo: 12,
		},
		{
			subject: "CircleCI build failed: main @ a3f2c1d",
			fromAddress: "builds@circleci.com",
			fromName: "CircleCI",
			textBody: "Build #4521 failed on main. Failing step: integration-tests. Duration: 4m 32s.",
			htmlBody:
				"<p>Build <strong>#4521</strong> failed on main. Failing step: integration-tests. Duration: 4m 32s.</p>",
			flags: "\\Seen",
			hoursAgo: 18,
		},
		{
			subject: "Weekly digest: 12 new vulnerabilities in your dependencies",
			fromAddress: "noreply@snyk.io",
			fromName: "Snyk",
			textBody: "12 new vulnerabilities found across 3 projects. 2 critical, 4 high, 6 medium.",
			htmlBody:
				"<p>12 new vulnerabilities found across 3 projects. <strong>2 critical</strong>, 4 high, 6 medium.</p>",
			flags: "\\Seen",
			hoursAgo: 24,
		},
	];

	for (let i = 0; i < emails.length; i++) {
		const e = emails[i];
		const date = new Date(now.getTime() - e.hoursAgo * 3600_000);
		const msgId = createTestMessage(db, accountId, inboxId, i + 1, {
			subject: e.subject,
			fromAddress: e.fromAddress,
			fromName: e.fromName,
			toAddresses: '["alex@stork.email"]',
			date: date.toISOString(),
			textBody: e.textBody,
			htmlBody: e.htmlBody,
			flags: e.flags,
		});
		inboxMsgIds.push(msgId);
	}

	// Thread conversation
	const threadId1 = "<deploy-1@company.com>";
	const threadId2 = "<deploy-2@company.com>";
	const threadId3 = "<deploy-3@company.com>";

	const t1 = createTestMessage(db, accountId, inboxId, 20, {
		messageId: threadId1,
		subject: "Re: Production deploy checklist",
		fromAddress: "sarah.kim@company.com",
		fromName: "Sarah Kim",
		toAddresses: '["alex@stork.email","team@company.com"]',
		date: new Date(now.getTime() - 4 * 3600_000).toISOString(),
		textBody:
			"I've updated the runbook with the new rollback procedure. Can someone double-check the health check endpoints?",
		htmlBody:
			"<p>I've updated the runbook with the new rollback procedure. Can someone double-check the health check endpoints?</p>",
		flags: "\\Seen",
	});
	inboxMsgIds.push(t1);

	const t2 = createTestMessage(db, accountId, inboxId, 21, {
		messageId: threadId2,
		subject: "Re: Production deploy checklist",
		fromAddress: "alex@stork.email",
		fromName: "Alex Chen",
		toAddresses: '["sarah.kim@company.com","team@company.com"]',
		date: new Date(now.getTime() - 3.5 * 3600_000).toISOString(),
		textBody:
			"Health checks look good. I added a canary step that gates on p99 latency before promoting to 100%.",
		htmlBody:
			"<p>Health checks look good. I added a canary step that gates on p99 latency before promoting to 100%.</p>",
		inReplyTo: threadId1,
		references: threadId1,
		flags: "\\Seen",
	});
	inboxMsgIds.push(t2);

	const t3 = createTestMessage(db, accountId, inboxId, 22, {
		messageId: threadId3,
		subject: "Re: Production deploy checklist",
		fromAddress: "sarah.kim@company.com",
		fromName: "Sarah Kim",
		toAddresses: '["alex@stork.email","team@company.com"]',
		date: new Date(now.getTime() - 3 * 3600_000).toISOString(),
		textBody:
			"Perfect. Let's target Thursday morning for the deploy — gives us a full business day to monitor.",
		htmlBody:
			"<p>Perfect. Let's target Thursday morning for the deploy — gives us a full business day to monitor.</p>",
		inReplyTo: threadId2,
		references: `${threadId1} ${threadId2}`,
		flags: "\\Seen",
	});
	inboxMsgIds.push(t3);

	// Sent message
	const sentMsgId = createTestMessage(db, accountId, sentId, 1, {
		subject: "Updated deployment runbook",
		fromAddress: "alex@stork.email",
		fromName: "Alex Chen",
		toAddresses: '["team@company.com"]',
		date: new Date(now.getTime() - 6 * 3600_000).toISOString(),
		textBody:
			"Attached is the updated deployment runbook with the new zero-downtime migration steps.",
		flags: "\\Seen",
	});

	// Link messages to labels
	for (const msgId of inboxMsgIds) {
		addMessageLabel(db, msgId, inboxLabelId);
	}
	addMessageLabel(db, sentMsgId, sentLabelId);

	// Update folder counts
	db.prepare("UPDATE folders SET message_count = ?, unread_count = ? WHERE id = ?").run(
		inboxMsgIds.length,
		3,
		inboxId,
	);
	db.prepare("UPDATE folders SET message_count = 1, unread_count = 0 WHERE id = ?").run(sentId);

	return db;
}

async function captureScreenshots() {
	if (!existsSync(OUTPUT_DIR)) {
		mkdirSync(OUTPUT_DIR, { recursive: true });
	}

	// Start server
	const db = seedData();
	const context = createTestContext(db);
	const { app } = createApp(context);
	if (context.scheduler) await context.scheduler.stop();

	const server = serve({ port: PORT, fetch: app.fetch });
	console.log(`Screenshot server running on http://127.0.0.1:${PORT}`);

	// Launch browser
	const browser = await chromium.launch();
	const browserContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 2, // Retina-quality screenshots
	});
	const page = await browserContext.newPage();

	try {
		// 1. Inbox view
		console.log("Capturing inbox view...");
		await page.goto(`http://127.0.0.1:${PORT}`);
		await page.waitForSelector("button", { timeout: 10000 });
		// Wait for messages to load
		await page.getByText("Your API keys have been rotated").waitFor({ timeout: 10000 });
		await page.waitForTimeout(500);
		await page.screenshot({
			path: join(OUTPUT_DIR, "inbox.png"),
		});
		console.log("  ✓ inbox.png");

		// 2. Thread/message detail view — click the thread message
		console.log("Capturing thread view...");
		await page
			.getByRole("button", { name: /Production deploy checklist/ })
			.first()
			.click();
		// Wait for thread content to appear
		await page
			.getByText(/updated the runbook/)
			.first()
			.waitFor({ timeout: 10000 });
		await page.waitForTimeout(500);
		await page.screenshot({
			path: join(OUTPUT_DIR, "thread.png"),
		});
		console.log("  ✓ thread.png");

		// 3. Compose modal
		console.log("Capturing compose form...");
		await page
			.getByRole("button", { name: /compose/i })
			.first()
			.click();
		await page.waitForTimeout(500);
		// Wait for compose form inputs to appear
		await page.locator("input").first().waitFor({ timeout: 10000 });
		await page.screenshot({
			path: join(OUTPUT_DIR, "compose.png"),
		});
		console.log("  ✓ compose.png");

		console.log(`\nAll screenshots saved to ${OUTPUT_DIR}`);
	} finally {
		await browser.close();
		server.close();
	}
}

captureScreenshots().catch((err) => {
	console.error("Failed to capture screenshots:", err);
	process.exit(1);
});
