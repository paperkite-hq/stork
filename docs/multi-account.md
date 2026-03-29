# Multi-Identity Support

Stork takes a **unified-first** approach to multiple email identities. Rather than treating each identity as an isolated mailbox you switch between, Stork treats all your identities as inbound flows into one unified mail system.

## Philosophy

Most people who manage multiple email addresses still have one "self" — a work address, a personal address, maybe a project alias. They don't want to mentally switch contexts to find an email; they want one place that shows everything, with enough context to know where a message came from.

Stork is built around this model:

- **One instance, multiple identities.** Run one Stork container for all your personal email. Only run separate instances when you need true isolation (e.g., employer-mandated separation of work data).
- **Unified views are first-class.** "Inbox", "Unread", and "All Mail" span every connected identity in multi-identity mode.
- **Auto-labeled by identity.** Every incoming message is automatically labeled with its receiving identity's name (e.g., "Work", "Personal"). These labels appear in the sidebar alongside other labels, enabling composable filtering.
- **Multi-label drill-down.** Click an identity label to see all its messages. Then Cmd/Ctrl+click another label (like "Inbox") to narrow down further. Labels compose via intersection — you see messages matching ALL selected labels.
- **Smart reply identity.** When replying, Stork defaults to the identity that received the original message, but lets you choose any identity as the sender.
- **Global labels.** Labels are instance-wide, not per-identity. "Needs reply" means the same thing regardless of which identity a message arrived on.

## How It Works

### Sidebar Navigation

When you have more than one identity connected, the top-level sidebar entries — **Inbox**, **Unread**, and **All Mail** — automatically become cross-identity unified views.

Identity labels appear in a dedicated section of the sidebar. Click one to see all messages from that identity. Cmd/Ctrl+click to add it to a multi-label filter — for example, click "Work" then Cmd+click "Inbox" to see only Work's inbox messages.

In single-identity mode, the sidebar behaves exactly the same — there's no visible change; the unified logic simply has one source.

### Multi-Label Filtering

Stork supports filtering by multiple labels simultaneously:

1. **Click** a label to view it exclusively (replaces the current view)
2. **Cmd/Ctrl+click** a label to add it to the active filter (intersection)
3. Active filter labels are shown as pills above the label list, each removable with ×
4. **Clear** removes all filters and returns to the previous single-label view

This makes the identity labels especially powerful — you can drill down from "Work" into "Work + Inbox", "Work + Receipts", etc.

### Sending From the Right Identity

When composing a new message, Stork shows a **From** dropdown (in multi-identity mode) pre-populated with the contextually appropriate identity:

- **New message:** defaults to the first identity, or whichever identity's view you're currently in
- **Reply / Reply All:** defaults to the identity that received the original message
- **Forward:** same as reply

You can always change the sender using the From dropdown. The chosen identity determines which outbound connector is used to deliver the message.

**Design note:** The From picker shows identities (names and addresses), not raw connectors. This is intentional — users think "send this as work@company.com", not "send via SMTP server X". The connector is an implementation detail resolved automatically from the chosen identity's default outbound connector.

## Connector Architecture

Stork separates how mail enters the system from how mail leaves it:

- **Inbound connectors** handle message ingestion: IMAP polling, Cloudflare Email Workers webhook
- **Outbound connectors** handle sending: SMTP, AWS SES

Connectors are configured independently in Settings → Connectors, then referenced by identities. An identity is purely a name + email address that points to one inbound and one outbound connector. This `n × m` model means you can, for example, receive via Fastmail IMAP but send through your own AWS SES endpoint for better deliverability — without any coupling between the two.

### Mirror vs Connector Mode

This setting lives on the **inbound connector** (not the identity), because it's a property of how Stork interacts with the inbound source:

- **Mirror mode** (default): Stork reads alongside your provider. Both hold copies. Actions in Stork are local only. Perfect for trying Stork.
- **Connector mode**: Stork becomes your permanent encrypted email home. Messages are removed from the inbound source after each sync. Back up your database.

This setting only applies to IMAP connectors — for push-based connectors (like Cloudflare Email), messages are delivered once and there's nothing to "delete from server."

Configure this in Settings → Connectors → edit the inbound IMAP connector.

### Adding a New Connector Type

Adding a new connector type only requires implementing the `IngestConnector` or `SendConnector` interface and registering it in the connector registry.

See [Writing Custom Connectors](./writing-connectors.md) for the interface definitions and a walkthrough.

## When to Run Separate Instances

The unified model is the right default. Run separate Stork instances only when:

- Your employer requires work email to be kept on separate infrastructure
- You're managing email for separate organizations that must not share a database
- You specifically want completely separate encryption passphrases per mailbox

For everything else — multiple personal addresses, aliases, family members — one instance handles it more elegantly than switching between separate containers.
