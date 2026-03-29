/**
 * Demo seed data — populates a Stork database with realistic sample emails
 * for the hosted read-only demo. Shows off threads, labels, search, and
 * attachment indicators.
 */

import type Database from "better-sqlite3-multiple-ciphers";

interface SeedMessage {
	subject: string;
	from_address: string;
	from_name: string;
	to_addresses: string;
	cc_addresses?: string;
	date: string;
	text_body: string;
	html_body: string;
	flags: string;
	message_id: string;
	in_reply_to?: string;
	references?: string;
	has_attachments?: number;
}

const DEMO_ACCOUNT = {
	name: "Alex Demo",
	email: "alex@example.com",
	imap_host: "demo.example.com",
	imap_port: 993,
	imap_tls: 1,
	imap_user: "alex@example.com",
	imap_pass: "demo-not-real",
};

const DEMO_LABELS = [
	{ name: "Inbox", color: "#3b82f6", source: "system" },
	{ name: "Sent", color: "#10b981", source: "system" },
	{ name: "Archive", color: "#6b7280", source: "system" },
	{ name: "Work", color: "#f59e0b", source: "user" },
	{ name: "Open Source", color: "#8b5cf6", source: "user" },
	{ name: "Receipts", color: "#ef4444", source: "user" },
	{ name: "Travel", color: "#06b6d4", source: "user" },
];

// Message-to-label mappings (by message index → label names)
const MESSAGE_LABELS: Record<number, string[]> = {
	0: ["Inbox", "Work"],
	1: ["Inbox", "Work"],
	2: ["Inbox", "Work"],
	3: ["Inbox", "Open Source"],
	4: ["Inbox", "Open Source"],
	5: ["Inbox"],
	6: ["Inbox", "Receipts"],
	7: ["Inbox", "Travel"],
	8: ["Inbox"],
	9: ["Sent"],
	10: ["Inbox", "Open Source"],
	11: ["Inbox"],
	12: ["Archive", "Receipts"],
	13: ["Inbox", "Work"],
	14: ["Inbox"],
};

const DEMO_MESSAGES: SeedMessage[] = [
	{
		subject: "Q2 Infrastructure Migration Plan",
		from_address: "jordan@acme-corp.com",
		from_name: "Jordan Lee",
		to_addresses: "alex@example.com",
		date: "2026-03-22T09:15:00Z",
		text_body: `Hi Alex,

Attached is the Q2 migration plan for moving our remaining services to Kubernetes. Key milestones:

1. Week 1-2: Containerize the billing service and auth gateway
2. Week 3-4: Set up staging cluster with Istio mesh
3. Week 5-6: Load testing and gradual traffic shift
4. Week 7-8: Full cutover and decommission legacy VMs

The estimated cost savings are ~40% on compute once we right-size the pods. I've included the capacity planning spreadsheet.

Let me know if you have concerns about the timeline — we can discuss at Thursday's standup.

Best,
Jordan`,
		html_body:
			"<p>Hi Alex,</p><p>Attached is the Q2 migration plan for moving our remaining services to Kubernetes. Key milestones:</p><ol><li>Week 1-2: Containerize the billing service and auth gateway</li><li>Week 3-4: Set up staging cluster with Istio mesh</li><li>Week 5-6: Load testing and gradual traffic shift</li><li>Week 7-8: Full cutover and decommission legacy VMs</li></ol><p>The estimated cost savings are ~40% on compute once we right-size the pods. I've included the capacity planning spreadsheet.</p><p>Let me know if you have concerns about the timeline — we can discuss at Thursday's standup.</p><p>Best,<br>Jordan</p>",
		flags: "\\Seen",
		message_id: "<migration-plan-001@acme-corp.com>",
		has_attachments: 1,
	},
	{
		subject: "Re: Q2 Infrastructure Migration Plan",
		from_address: "alex@example.com",
		from_name: "Alex Demo",
		to_addresses: "jordan@acme-corp.com",
		date: "2026-03-22T10:30:00Z",
		text_body: `Jordan,

Looks solid. Two questions:

1. Are we keeping the Redis cluster on bare metal or migrating that too? The latency requirements for the session store are tight.
2. Who's handling the DNS cutover? Last time DevOps and Platform both thought the other team was doing it.

I'll review the spreadsheet before Thursday.

— Alex`,
		html_body:
			"<p>Jordan,</p><p>Looks solid. Two questions:</p><ol><li>Are we keeping the Redis cluster on bare metal or migrating that too? The latency requirements for the session store are tight.</li><li>Who's handling the DNS cutover? Last time DevOps and Platform both thought the other team was doing it.</li></ol><p>I'll review the spreadsheet before Thursday.</p><p>— Alex</p>",
		flags: "\\Seen",
		message_id: "<migration-reply-002@example.com>",
		in_reply_to: "<migration-plan-001@acme-corp.com>",
		references: "<migration-plan-001@acme-corp.com>",
	},
	{
		subject: "Re: Q2 Infrastructure Migration Plan",
		from_address: "jordan@acme-corp.com",
		from_name: "Jordan Lee",
		to_addresses: "alex@example.com",
		cc_addresses: "platform-team@acme-corp.com",
		date: "2026-03-22T11:05:00Z",
		text_body: `Good points both.

1. Redis stays on bare metal — agreed, we can't risk the latency hit. I'll add an explicit exclusion note.
2. DNS cutover is Platform's responsibility. CC'ing them now so it's on their radar from day one.

Updated doc coming this afternoon.

— J`,
		html_body:
			"<p>Good points both.</p><ol><li>Redis stays on bare metal — agreed, we can't risk the latency hit. I'll add an explicit exclusion note.</li><li>DNS cutover is Platform's responsibility. CC'ing them now so it's on their radar from day one.</li></ol><p>Updated doc coming this afternoon.</p><p>— J</p>",
		flags: "",
		message_id: "<migration-reply-003@acme-corp.com>",
		in_reply_to: "<migration-reply-002@example.com>",
		references: "<migration-plan-001@acme-corp.com> <migration-reply-002@example.com>",
	},
	{
		subject: "[stork] Issue #42: Add CalDAV calendar sync",
		from_address: "notifications@github.com",
		from_name: "GitHub",
		to_addresses: "alex@example.com",
		date: "2026-03-21T18:22:00Z",
		text_body: `New issue opened by @maria-dev:

## Feature Request: CalDAV Calendar Sync

It would be great if Stork could sync calendar events alongside email. Many self-hosted setups (Mailcow, Mail-in-a-Box) include CalDAV.

### Use case
I run Mailcow with SOGo for calendars. I'd love a unified interface for both email and calendar without depending on SOGo's web UI.

### Proposal
- Add a CalDAV connector similar to the existing IMAP connector
- Display events in a sidebar or dedicated calendar view
- Support read-only sync initially

---
Reply to this email directly or view it on GitHub:
https://github.com/paperkite-hq/stork/issues/42`,
		html_body:
			"<p>New issue opened by <strong>@maria-dev</strong>:</p><h2>Feature Request: CalDAV Calendar Sync</h2><p>It would be great if Stork could sync calendar events alongside email. Many self-hosted setups (Mailcow, Mail-in-a-Box) include CalDAV.</p><h3>Use case</h3><p>I run Mailcow with SOGo for calendars. I'd love a unified interface for both email and calendar without depending on SOGo's web UI.</p><h3>Proposal</h3><ul><li>Add a CalDAV connector similar to the existing IMAP connector</li><li>Display events in a sidebar or dedicated calendar view</li><li>Support read-only sync initially</li></ul>",
		flags: "\\Seen",
		message_id: "<github-issue-42@github.com>",
	},
	{
		subject: "[stork] PR #38: feat: add keyboard shortcuts for navigation",
		from_address: "notifications@github.com",
		from_name: "GitHub",
		to_addresses: "alex@example.com",
		date: "2026-03-21T14:10:00Z",
		text_body: `Pull request opened by @kenji-keys:

## Add keyboard shortcuts for message navigation

This PR adds vim-style keyboard shortcuts:
- j/k: Navigate between messages
- o/Enter: Open selected message
- u: Return to message list
- r: Reply
- a: Archive
- s: Star/unstar
- /: Focus search

All shortcuts are documented in the help modal (press ?).

Tests: 12 new integration tests covering all shortcuts.

---
Review this pull request:
https://github.com/paperkite-hq/stork/pull/38`,
		html_body:
			"<p>Pull request opened by <strong>@kenji-keys</strong>:</p><h2>Add keyboard shortcuts for message navigation</h2><p>This PR adds vim-style keyboard shortcuts:</p><ul><li><code>j/k</code>: Navigate between messages</li><li><code>o/Enter</code>: Open selected message</li><li><code>u</code>: Return to message list</li><li><code>r</code>: Reply</li><li><code>a</code>: Archive</li><li><code>s</code>: Star/unstar</li><li><code>/</code>: Focus search</li></ul><p>All shortcuts are documented in the help modal (press <code>?</code>).</p><p>Tests: 12 new integration tests covering all shortcuts.</p>",
		flags: "\\Seen",
		message_id: "<github-pr-38@github.com>",
	},
	{
		subject: "Your Hetzner invoice for March 2026",
		from_address: "billing@hetzner.com",
		from_name: "Hetzner Online",
		to_addresses: "alex@example.com",
		date: "2026-03-20T06:00:00Z",
		text_body: `Dear Customer,

Your invoice for March 2026 is available.

Server: CX41 (Nuremberg DC)
Period: 2026-03-01 to 2026-03-31
Amount: €14.16 (incl. VAT)

You can download the full invoice from your Hetzner Robot panel.

Kind regards,
Hetzner Online GmbH`,
		html_body:
			"<p>Dear Customer,</p><p>Your invoice for March 2026 is available.</p><table><tr><td>Server</td><td>CX41 (Nuremberg DC)</td></tr><tr><td>Period</td><td>2026-03-01 to 2026-03-31</td></tr><tr><td>Amount</td><td>€14.16 (incl. VAT)</td></tr></table><p>You can download the full invoice from your Hetzner Robot panel.</p><p>Kind regards,<br>Hetzner Online GmbH</p>",
		flags: "\\Seen",
		message_id: "<invoice-march-2026@hetzner.com>",
		has_attachments: 1,
	},
	{
		subject: "Order Confirmation — Portable USB-C Hub",
		from_address: "orders@electronics-store.example",
		from_name: "TechGear Shop",
		to_addresses: "alex@example.com",
		date: "2026-03-19T22:45:00Z",
		text_body: `Thank you for your order!

Order #TG-90421
Item: USB-C Hub 7-in-1 (HDMI, 3x USB-A, SD, microSD, PD 100W)
Qty: 1
Total: $34.99

Estimated delivery: March 24-26, 2026
Tracking: Will be emailed when shipped.

Thank you for shopping with TechGear!`,
		html_body:
			"<p>Thank you for your order!</p><p><strong>Order #TG-90421</strong></p><table><tr><td>Item</td><td>USB-C Hub 7-in-1 (HDMI, 3x USB-A, SD, microSD, PD 100W)</td></tr><tr><td>Qty</td><td>1</td></tr><tr><td>Total</td><td>$34.99</td></tr></table><p>Estimated delivery: March 24-26, 2026</p>",
		flags: "\\Seen",
		message_id: "<order-90421@electronics-store.example>",
	},
	{
		subject: "Flight Confirmation: SEA → NRT, April 12",
		from_address: "confirmations@airline.example",
		from_name: "Pacific Airways",
		to_addresses: "alex@example.com",
		date: "2026-03-18T15:30:00Z",
		text_body: `Booking Confirmed!

Passenger: Alex Demo
Flight: PA 207
Route: Seattle-Tacoma (SEA) → Tokyo Narita (NRT)
Date: April 12, 2026
Depart: 11:40 AM PDT
Arrive: April 13, 3:15 PM JST
Seat: 24A (Window)
Class: Economy

Confirmation Code: XKPF92

Check in opens 24 hours before departure.

Safe travels!
Pacific Airways`,
		html_body:
			"<h2>Booking Confirmed!</h2><table><tr><td>Passenger</td><td>Alex Demo</td></tr><tr><td>Flight</td><td>PA 207</td></tr><tr><td>Route</td><td>Seattle-Tacoma (SEA) → Tokyo Narita (NRT)</td></tr><tr><td>Date</td><td>April 12, 2026</td></tr><tr><td>Depart</td><td>11:40 AM PDT</td></tr><tr><td>Arrive</td><td>April 13, 3:15 PM JST</td></tr><tr><td>Seat</td><td>24A (Window)</td></tr></table><p>Confirmation Code: <strong>XKPF92</strong></p>",
		flags: "\\Seen,\\Flagged",
		message_id: "<flight-pa207@airline.example>",
		has_attachments: 1,
	},
	{
		subject: "Weekly digest: Self-Hosted Newsletter",
		from_address: "digest@selfhosted-weekly.example",
		from_name: "Self-Hosted Weekly",
		to_addresses: "alex@example.com",
		date: "2026-03-17T12:00:00Z",
		text_body: `Self-Hosted Weekly #147

Top stories this week:

1. Immich v2.0 released — native video transcoding, face recognition improvements
2. Nextcloud Hub 9 announcement — real-time collaboration, AI assistant built-in
3. New Proxmox VE 9.0 beta — BTRFS improvements, better GPU passthrough
4. Tutorial: Running your own email server in 2026 (it's still hard, but getting easier)
5. Stork — new self-hosted email client with encrypted local storage

Community picks:
- Audiobookshelf hits 100k Docker pulls
- Mealie recipe manager adds meal planning

Happy self-hosting!
— The SH Weekly team`,
		html_body:
			"<h1>Self-Hosted Weekly #147</h1><h2>Top stories this week:</h2><ol><li>Immich v2.0 released — native video transcoding, face recognition improvements</li><li>Nextcloud Hub 9 announcement — real-time collaboration, AI assistant built-in</li><li>New Proxmox VE 9.0 beta — BTRFS improvements, better GPU passthrough</li><li>Tutorial: Running your own email server in 2026 (it's still hard, but getting easier)</li><li><strong>Stork</strong> — new self-hosted email client with encrypted local storage</li></ol><h3>Community picks:</h3><ul><li>Audiobookshelf hits 100k Docker pulls</li><li>Mealie recipe manager adds meal planning</li></ul>",
		flags: "",
		message_id: "<digest-147@selfhosted-weekly.example>",
	},
	{
		subject: "Re: Database backup strategy",
		from_address: "alex@example.com",
		from_name: "Alex Demo",
		to_addresses: "sam@acme-corp.com",
		date: "2026-03-17T09:20:00Z",
		text_body: `Sam,

I set up the automated backup pipeline yesterday. Here's what's running:

- PostgreSQL: pg_dump every 6 hours, compressed, encrypted with age, uploaded to B2
- SQLite (app configs): daily rsync to the backup volume
- Retention: 7 daily, 4 weekly, 12 monthly

The restore script is at /opt/backups/restore.sh — I tested a full restore on the staging box and it completed in under 4 minutes for our current dataset.

Monitoring: Healthchecks.io pings after each successful backup. If a backup misses its window, we get a PagerDuty alert.

Let me know if you want me to add anything else to the backup scope.

— Alex`,
		html_body:
			"<p>Sam,</p><p>I set up the automated backup pipeline yesterday. Here's what's running:</p><ul><li>PostgreSQL: pg_dump every 6 hours, compressed, encrypted with age, uploaded to B2</li><li>SQLite (app configs): daily rsync to the backup volume</li><li>Retention: 7 daily, 4 weekly, 12 monthly</li></ul><p>The restore script is at <code>/opt/backups/restore.sh</code> — I tested a full restore on the staging box and it completed in under 4 minutes for our current dataset.</p><p>Monitoring: Healthchecks.io pings after each successful backup. If a backup misses its window, we get a PagerDuty alert.</p><p>Let me know if you want me to add anything else to the backup scope.</p><p>— Alex</p>",
		flags: "\\Seen",
		message_id: "<backup-strategy-reply@example.com>",
		in_reply_to: "<backup-strategy-001@acme-corp.com>",
		references: "<backup-strategy-001@acme-corp.com>",
	},
	{
		subject: "[stork] New release: v0.3.0-alpha",
		from_address: "notifications@github.com",
		from_name: "GitHub",
		to_addresses: "alex@example.com",
		date: "2026-03-22T07:00:00Z",
		text_body: `New release published: v0.3.0-alpha

## What's New
- SMTP and IMAP pluggable connectors for easier testing
- Two-phase recovery key rotation (power-failure safe)
- Comparison table vs Roundcube, Bichon, Mailu in README
- 3 complete use-case guides: Gmail backup, Mailcow webmail, VPN access
- Issue templates and CONTRIBUTING.md

## Bug Fixes
- Fixed fully-qualified base image for Podman compatibility
- Reduced UI jumpiness on email list hover

## Stats
- 773 tests, 81% branch coverage
- Docker image: ghcr.io/paperkite-hq/stork:v0.3.0-alpha

Full changelog: https://github.com/paperkite-hq/stork/releases/tag/v0.3.0-alpha`,
		html_body:
			"<h2>New release published: v0.3.0-alpha</h2><h3>What's New</h3><ul><li>SMTP and IMAP pluggable connectors for easier testing</li><li>Two-phase recovery key rotation (power-failure safe)</li><li>Comparison table vs Roundcube, Bichon, Mailu in README</li><li>3 complete use-case guides: Gmail backup, Mailcow webmail, VPN access</li><li>Issue templates and CONTRIBUTING.md</li></ul><h3>Bug Fixes</h3><ul><li>Fixed fully-qualified base image for Podman compatibility</li><li>Reduced UI jumpiness on email list hover</li></ul><h3>Stats</h3><ul><li>773 tests, 81% branch coverage</li><li>Docker image: <code>ghcr.io/paperkite-hq/stork:v0.3.0-alpha</code></li></ul>",
		flags: "",
		message_id: "<github-release-v030@github.com>",
	},
	{
		subject: "Reminder: Dentist appointment Thursday 2pm",
		from_address: "reminders@calendar.example",
		from_name: "Calendar Reminder",
		to_addresses: "alex@example.com",
		date: "2026-03-22T08:00:00Z",
		text_body: `Reminder: You have an upcoming appointment.

Event: Dentist — routine cleaning
Date: Thursday, March 26, 2026
Time: 2:00 PM PST
Location: 1234 Pine St, Suite 200

This is an automated reminder from your calendar.`,
		html_body:
			"<p><strong>Reminder:</strong> You have an upcoming appointment.</p><table><tr><td>Event</td><td>Dentist — routine cleaning</td></tr><tr><td>Date</td><td>Thursday, March 26, 2026</td></tr><tr><td>Time</td><td>2:00 PM PST</td></tr><tr><td>Location</td><td>1234 Pine St, Suite 200</td></tr></table>",
		flags: "",
		message_id: "<cal-reminder-326@calendar.example>",
	},
	{
		subject: "Your Backblaze B2 invoice — February 2026",
		from_address: "billing@backblaze.com",
		from_name: "Backblaze",
		to_addresses: "alex@example.com",
		date: "2026-03-01T04:00:00Z",
		text_body: `Your Backblaze B2 Cloud Storage invoice is ready.

Account: alex@example.com
Period: February 2026
Storage: 247 GB
Downloads: 12 GB
Amount: $1.48

Thank you for using Backblaze B2!`,
		html_body:
			"<p>Your Backblaze B2 Cloud Storage invoice is ready.</p><table><tr><td>Account</td><td>alex@example.com</td></tr><tr><td>Period</td><td>February 2026</td></tr><tr><td>Storage</td><td>247 GB</td></tr><tr><td>Downloads</td><td>12 GB</td></tr><tr><td>Amount</td><td>$1.48</td></tr></table>",
		flags: "\\Seen",
		message_id: "<invoice-feb-2026@backblaze.com>",
		has_attachments: 1,
	},
	{
		subject: "Sprint retro notes — March 20",
		from_address: "priya@acme-corp.com",
		from_name: "Priya Sharma",
		to_addresses: '["alex@example.com","jordan@acme-corp.com","sam@acme-corp.com"]',
		date: "2026-03-20T17:45:00Z",
		text_body: `Team,

Here are the retro notes from today's session.

What went well:
- Deployment pipeline is much faster after the caching changes (build time down from 8min to 2min)
- Zero incidents this sprint — first time in Q1!
- New monitoring dashboards caught the memory leak before it hit prod

What to improve:
- Code review turnaround still averaging 2 days — aim for <24h
- Need better documentation for the new microservices
- On-call runbook for the billing service is outdated

Action items:
- Alex: Update billing service runbook by Friday
- Jordan: Set up review reminders in Slack
- Sam: Document the new auth service endpoints

See you all Monday!
— Priya`,
		html_body:
			"<p>Team,</p><p>Here are the retro notes from today's session.</p><h3>What went well:</h3><ul><li>Deployment pipeline is much faster after the caching changes (build time down from 8min to 2min)</li><li>Zero incidents this sprint — first time in Q1!</li><li>New monitoring dashboards caught the memory leak before it hit prod</li></ul><h3>What to improve:</h3><ul><li>Code review turnaround still averaging 2 days — aim for &lt;24h</li><li>Need better documentation for the new microservices</li><li>On-call runbook for the billing service is outdated</li></ul><h3>Action items:</h3><ul><li>Alex: Update billing service runbook by Friday</li><li>Jordan: Set up review reminders in Slack</li><li>Sam: Document the new auth service endpoints</li></ul>",
		flags: "",
		message_id: "<retro-march-20@acme-corp.com>",
	},
	{
		subject: "Tailscale: New device connected to your tailnet",
		from_address: "notifications@tailscale.com",
		from_name: "Tailscale",
		to_addresses: "alex@example.com",
		date: "2026-03-19T20:10:00Z",
		text_body: `A new device has connected to your tailnet.

Device: pixel-8-pro
OS: Android 15
IP: 100.64.0.7
User: alex@example.com

If you don't recognize this device, you can remove it from your admin console.

— Tailscale`,
		html_body:
			"<p>A new device has connected to your tailnet.</p><table><tr><td>Device</td><td>pixel-8-pro</td></tr><tr><td>OS</td><td>Android 15</td></tr><tr><td>IP</td><td>100.64.0.7</td></tr><tr><td>User</td><td>alex@example.com</td></tr></table><p>If you don't recognize this device, you can remove it from your admin console.</p>",
		flags: "\\Seen",
		message_id: "<tailscale-device-notify@tailscale.com>",
	},
];

// ─── Second demo account (work email) ────────────────────────────────────────

const DEMO_ACCOUNT_2 = {
	name: "Alex (Work)",
	email: "a.demo@acme-corp.com",
	imap_host: "mail.acme-corp.com",
	imap_port: 993,
	imap_tls: 1,
	imap_user: "a.demo@acme-corp.com",
	imap_pass: "demo-not-real",
};

const DEMO_LABELS_2 = [
	{ name: "Inbox", color: "#3b82f6", source: "system" },
	{ name: "Sent", color: "#10b981", source: "system" },
	{ name: "Archive", color: "#6b7280", source: "system" },
	{ name: "Code Reviews", color: "#f59e0b", source: "user" },
	{ name: "Announcements", color: "#8b5cf6", source: "user" },
];

const MESSAGE_LABELS_2: Record<number, string[]> = {
	0: ["Inbox", "Code Reviews"],
	1: ["Inbox", "Announcements"],
	2: ["Inbox"],
	3: ["Sent"],
};

const DEMO_MESSAGES_2: SeedMessage[] = [
	{
		subject: "Code review: feat/cache-invalidation",
		from_address: "sam@acme-corp.com",
		from_name: "Sam Okonkwo",
		to_addresses: "a.demo@acme-corp.com",
		date: "2026-03-22T13:00:00Z",
		text_body: `Hey Alex,

Can you take a look at my PR when you get a chance? It's the cache invalidation rework — touches the CDN edge config and the Redis eviction logic.

PR: https://github.com/acme-corp/platform/pull/714

Main things I'd like eyes on:
- The TTL fallback logic in cache-manager.ts
- Whether the test coverage for edge cases looks sufficient

Shouldn't take long — maybe 20-30 min. Thanks!

— Sam`,
		html_body:
			"<p>Hey Alex,</p><p>Can you take a look at my PR when you get a chance? It's the cache invalidation rework — touches the CDN edge config and the Redis eviction logic.</p><p>PR: <a href='https://github.com/acme-corp/platform/pull/714'>acme-corp/platform#714</a></p><p>Main things I'd like eyes on:</p><ul><li>The TTL fallback logic in <code>cache-manager.ts</code></li><li>Whether the test coverage for edge cases looks sufficient</li></ul><p>Shouldn't take long — maybe 20-30 min. Thanks!</p><p>— Sam</p>",
		flags: "",
		message_id: "<pr-review-714@acme-corp.com>",
	},
	{
		subject: "All-hands recording now available — March 2026",
		from_address: "people@acme-corp.com",
		from_name: "Acme People Team",
		to_addresses: "all@acme-corp.com",
		date: "2026-03-21T19:30:00Z",
		text_body: `Hi everyone,

The recording from Tuesday's all-hands is now available in the company portal.

Key announcements:
- Q1 closed at 112% of plan — great work across the board
- Engineering headcount: 3 new hires starting in April
- New PTO policy effective May 1: unlimited PTO with a 10-day minimum
- Office closure: April 18 for company offsite

Recording link: https://intranet.acme-corp.com/all-hands/2026-03
Slides: attached

See you next quarter!
— People Team`,
		html_body:
			"<p>Hi everyone,</p><p>The recording from Tuesday's all-hands is now available in the company portal.</p><h3>Key announcements:</h3><ul><li>Q1 closed at 112% of plan — great work across the board</li><li>Engineering headcount: 3 new hires starting in April</li><li>New PTO policy effective May 1: unlimited PTO with a 10-day minimum</li><li>Office closure: April 18 for company offsite</li></ul>",
		flags: "\\Seen",
		message_id: "<allhands-mar2026@acme-corp.com>",
		has_attachments: 1,
	},
	{
		subject: "Action required: update Node.js to 22.x by April 1",
		from_address: "security@acme-corp.com",
		from_name: "Acme Security",
		to_addresses: "engineering@acme-corp.com",
		date: "2026-03-20T10:00:00Z",
		text_body: `Engineering team,

Node.js 18.x reaches end-of-life on April 30, 2026. We are requiring all services to migrate to Node.js 22.x by April 1 to stay ahead of the EOL and align with our updated security baseline.

Action items:
1. Update your Dockerfile base images to node:22-alpine
2. Update .nvmrc / .node-version files
3. Run your test suite — Node 22 breaks some older CJS/ESM interop patterns
4. Update package.json engines field

If you need help, reach out in #platform-migration.

— Acme Security`,
		html_body:
			"<p>Engineering team,</p><p>Node.js 18.x reaches end-of-life on April 30, 2026. We are requiring all services to migrate to Node.js 22.x by April 1 to stay ahead of the EOL and align with our updated security baseline.</p><h3>Action items:</h3><ol><li>Update your Dockerfile base images to <code>node:22-alpine</code></li><li>Update <code>.nvmrc</code> / <code>.node-version</code> files</li><li>Run your test suite — Node 22 breaks some older CJS/ESM interop patterns</li><li>Update <code>package.json</code> engines field</li></ol><p>If you need help, reach out in <code>#platform-migration</code>.</p>",
		flags: "",
		message_id: "<security-node22@acme-corp.com>",
	},
	{
		subject: "Re: Code review: feat/cache-invalidation",
		from_address: "a.demo@acme-corp.com",
		from_name: "Alex (Work)",
		to_addresses: "sam@acme-corp.com",
		date: "2026-03-22T14:45:00Z",
		text_body: `Sam,

Left comments on GitHub. Overall looks solid — the TTL logic is clean. Two minor nits:
- The fallback should probably log a warning rather than silently succeeding
- One edge case in the test around concurrent eviction isn't covered

Approved with those addressed.

— Alex`,
		html_body:
			"<p>Sam,</p><p>Left comments on GitHub. Overall looks solid — the TTL logic is clean. Two minor nits:</p><ul><li>The fallback should probably log a warning rather than silently succeeding</li><li>One edge case in the test around concurrent eviction isn't covered</li></ul><p>Approved with those addressed.</p><p>— Alex</p>",
		flags: "\\Seen",
		message_id: "<pr-review-714-reply@acme-corp.com>",
		in_reply_to: "<pr-review-714@acme-corp.com>",
		references: "<pr-review-714@acme-corp.com>",
	},
];

// ─────────────────────────────────────────────────────────────────────────────

export function seedDemoData(db: Database.Database): void {
	// Create inbound connectors
	const inbound1Result = db
		.prepare(
			`INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass, sync_delete_from_server)
		 VALUES (?, 'imap', ?, ?, ?, ?, ?, 1)`,
		)
		.run(
			`${DEMO_ACCOUNT.name} (Inbound)`,
			DEMO_ACCOUNT.imap_host,
			DEMO_ACCOUNT.imap_port,
			DEMO_ACCOUNT.imap_tls,
			DEMO_ACCOUNT.imap_user,
			DEMO_ACCOUNT.imap_pass,
		);
	const inboundId1 = inbound1Result.lastInsertRowid as number;

	// Create outbound connectors (SMTP)
	const outbound1Result = db
		.prepare(
			`INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
		 VALUES (?, 'smtp', ?, 587, 1, ?, 'demo-not-real')`,
		)
		.run(`${DEMO_ACCOUNT.name} (Outbound)`, DEMO_ACCOUNT.imap_host, DEMO_ACCOUNT.email);
	const outboundId1 = outbound1Result.lastInsertRowid as number;

	// Insert demo account linked to connectors
	const accountResult = db
		.prepare(
			`INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass, sync_delete_from_server, inbound_connector_id, outbound_connector_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		)
		.run(
			DEMO_ACCOUNT.name,
			DEMO_ACCOUNT.email,
			DEMO_ACCOUNT.imap_host,
			DEMO_ACCOUNT.imap_port,
			DEMO_ACCOUNT.imap_tls,
			DEMO_ACCOUNT.imap_user,
			DEMO_ACCOUNT.imap_pass,
			inboundId1,
			outboundId1,
		);
	const accountId = accountResult.lastInsertRowid as number;

	// Insert INBOX folder
	const folderResult = db
		.prepare(
			`INSERT INTO folders (account_id, path, name, special_use, uid_validity, uid_next, message_count, unread_count)
		 VALUES (?, 'INBOX', 'Inbox', '\\\\Inbox', 1, ?, ?, ?)`,
		)
		.run(accountId, DEMO_MESSAGES.length + 1, DEMO_MESSAGES.length, 5);
	const folderId = folderResult.lastInsertRowid as number;

	// Insert labels (including account label for this account)
	const labelMap = new Map<string, number>();
	const insertLabel = db.prepare(
		"INSERT OR IGNORE INTO labels (name, color, source) VALUES (?, ?, ?)",
	);
	const lookupLabel = db.prepare("SELECT id FROM labels WHERE name = ?");
	// Create account label
	insertLabel.run(DEMO_ACCOUNT.name, "#3b82f6", "account");
	for (const label of DEMO_LABELS) {
		insertLabel.run(label.name, label.color, label.source);
		const row = lookupLabel.get(label.name) as { id: number };
		labelMap.set(label.name, row.id);
	}
	// Look up account label ID
	const accountLabelRow = lookupLabel.get(DEMO_ACCOUNT.name) as { id: number };
	const accountLabelId = accountLabelRow.id;

	// Insert messages
	const insertMessage = db.prepare(`
		INSERT INTO messages (account_id, folder_id, uid, message_id, in_reply_to, "references",
			subject, from_address, from_name, to_addresses, cc_addresses, date,
			text_body, html_body, flags, has_attachments, size)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertMessageLabel = db.prepare(
		"INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)",
	);

	const insertAll = db.transaction(() => {
		for (let i = 0; i < DEMO_MESSAGES.length; i++) {
			const msg = DEMO_MESSAGES[i];
			const size = msg.text_body.length + (msg.html_body?.length ?? 0);
			const result = insertMessage.run(
				accountId,
				folderId,
				i + 1, // UID
				msg.message_id,
				msg.in_reply_to ?? null,
				msg.references ?? null,
				msg.subject,
				msg.from_address,
				msg.from_name,
				msg.to_addresses,
				msg.cc_addresses ?? null,
				msg.date,
				msg.text_body,
				msg.html_body,
				msg.flags,
				msg.has_attachments ?? 0,
				size,
			);

			// Assign labels (including account label)
			const messageId = result.lastInsertRowid as number;
			insertMessageLabel.run(messageId, accountLabelId);
			const labels = MESSAGE_LABELS[i] ?? [];
			for (const labelName of labels) {
				const labelId = labelMap.get(labelName);
				if (labelId) {
					insertMessageLabel.run(messageId, labelId);
				}
			}
		}
	});

	insertAll();

	// Refresh cached label and account counts so the UI shows correct badges immediately.
	// (These columns are normally maintained by refreshLabelCounts/refreshAccountCounts at
	// the end of each sync cycle, but the demo DB has no sync — seed them directly.)
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

	db.prepare(`
		UPDATE accounts
		SET
			cached_message_count = (SELECT COUNT(*) FROM messages WHERE account_id = ?),
			cached_unread_count = (
				SELECT COUNT(*) FROM messages
				WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
			)
		WHERE id = ?
	`).run(accountId, accountId, accountId);

	// ── Second account ──────────────────────────────────────────────────────

	const inbound2Result = db
		.prepare(
			`INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass, sync_delete_from_server)
		 VALUES (?, 'imap', ?, ?, ?, ?, ?, 1)`,
		)
		.run(
			`${DEMO_ACCOUNT_2.name} (Inbound)`,
			DEMO_ACCOUNT_2.imap_host,
			DEMO_ACCOUNT_2.imap_port,
			DEMO_ACCOUNT_2.imap_tls,
			DEMO_ACCOUNT_2.imap_user,
			DEMO_ACCOUNT_2.imap_pass,
		);
	const inboundId2 = inbound2Result.lastInsertRowid as number;

	const outbound2Result = db
		.prepare(
			`INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
		 VALUES (?, 'smtp', ?, 587, 1, ?, 'demo-not-real')`,
		)
		.run(`${DEMO_ACCOUNT_2.name} (Outbound)`, DEMO_ACCOUNT_2.imap_host, DEMO_ACCOUNT_2.email);
	const outboundId2 = outbound2Result.lastInsertRowid as number;

	const account2Result = db
		.prepare(
			`INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, imap_user, imap_pass, sync_delete_from_server, inbound_connector_id, outbound_connector_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		)
		.run(
			DEMO_ACCOUNT_2.name,
			DEMO_ACCOUNT_2.email,
			DEMO_ACCOUNT_2.imap_host,
			DEMO_ACCOUNT_2.imap_port,
			DEMO_ACCOUNT_2.imap_tls,
			DEMO_ACCOUNT_2.imap_user,
			DEMO_ACCOUNT_2.imap_pass,
			inboundId2,
			outboundId2,
		);
	const accountId2 = account2Result.lastInsertRowid as number;

	const folder2Result = db
		.prepare(
			`INSERT INTO folders (account_id, path, name, special_use, uid_validity, uid_next, message_count, unread_count)
		 VALUES (?, 'INBOX', 'Inbox', '\\\\Inbox', 1, ?, ?, ?)`,
		)
		.run(accountId2, DEMO_MESSAGES_2.length + 1, DEMO_MESSAGES_2.length, 2);
	const folderId2 = folder2Result.lastInsertRowid as number;

	// Create account label for second account
	insertLabel.run(DEMO_ACCOUNT_2.name, "#10b981", "account");
	const accountLabel2Row = lookupLabel.get(DEMO_ACCOUNT_2.name) as { id: number };
	const accountLabel2Id = accountLabel2Row.id;

	const labelMap2 = new Map<string, number>();
	for (const label of DEMO_LABELS_2) {
		insertLabel.run(label.name, label.color, label.source);
		const row = lookupLabel.get(label.name) as { id: number };
		labelMap2.set(label.name, row.id);
	}

	const insertAll2 = db.transaction(() => {
		for (let i = 0; i < DEMO_MESSAGES_2.length; i++) {
			const msg = DEMO_MESSAGES_2[i];
			const size = msg.text_body.length + (msg.html_body?.length ?? 0);
			const result = insertMessage.run(
				accountId2,
				folderId2,
				i + 1,
				msg.message_id,
				msg.in_reply_to ?? null,
				msg.references ?? null,
				msg.subject,
				msg.from_address,
				msg.from_name,
				msg.to_addresses,
				msg.cc_addresses ?? null,
				msg.date,
				msg.text_body,
				msg.html_body,
				msg.flags,
				msg.has_attachments ?? 0,
				size,
			);
			const messageId2 = result.lastInsertRowid as number;
			insertMessageLabel.run(messageId2, accountLabel2Id);
			const labels2 = MESSAGE_LABELS_2[i] ?? [];
			for (const labelName of labels2) {
				const labelId = labelMap2.get(labelName);
				if (labelId) {
					insertMessageLabel.run(messageId2, labelId);
				}
			}
		}
	});

	insertAll2();

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

	db.prepare(`
		UPDATE accounts
		SET
			cached_message_count = (SELECT COUNT(*) FROM messages WHERE account_id = ?),
			cached_unread_count = (
				SELECT COUNT(*) FROM messages
				WHERE account_id = ?
				AND (flags IS NULL OR flags NOT LIKE '%\\Seen%')
			)
		WHERE id = ?
	`).run(accountId2, accountId2, accountId2);
}
