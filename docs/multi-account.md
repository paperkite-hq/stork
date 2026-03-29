# Multi-Account Support

Stork takes a **unified-first** approach to multiple email accounts. Rather than treating each account as an isolated mailbox you switch between, Stork treats all your accounts as inbound flows into one unified mail system.

## Philosophy

Most people who manage multiple email addresses still have one "self" — a work address, a personal address, maybe a project alias. They don't want to mentally switch contexts to find an email; they want one place that shows everything, with enough context to know where a message came from.

Stork is built around this model:

- **One instance, multiple accounts.** Run one Stork container for all your personal email. Only run separate instances when you need true isolation (e.g., employer-mandated separation of work data).
- **Unified views are first-class.** "Inbox", "Unread", and "All Mail" span every connected account in multi-account mode. Per-account drill-in is available but secondary.
- **Source-labeled messages.** Every message shows which account it arrived on, so you always know where you are in the unified view.
- **Smart reply identity.** When replying, Stork defaults to the account that received the original message, but lets you choose any identity as the sender.
- **Global labels.** Labels are instance-wide, not per-account. "Needs reply" means the same thing regardless of which account a message arrived on.

## How It Works

### Sidebar Navigation

When you have more than one account connected, the top-level sidebar entries — **Inbox**, **Unread**, and **All Mail** — automatically become cross-account unified views. No separate "All Accounts" section needed; those views are just the default.

An **Accounts** section at the bottom of the sidebar lists each connected account as a drill-in button for when you want to focus on one account's messages specifically.

In single-account mode, the sidebar behaves exactly the same — there's no visible change; the unified logic simply has one source.

### Account Badges

In unified views, each message row shows the account name it belongs to — e.g., "Work" or "Personal" — so you can tell at a glance where a message came from.

### Sending From the Right Account

When composing a new message, Stork shows a **From** dropdown (in multi-account mode) pre-populated with the contextually appropriate identity:

- **New message:** defaults to the first account, or whichever account's view you're currently in
- **Reply / Reply All:** defaults to the account that received the original message
- **Forward:** same as reply

You can always change the sender using the From dropdown. The chosen identity determines which outbound connector is used to deliver the message.

**Design note:** The From picker shows identities (account names and addresses), not raw connectors. This is intentional — users think "send this as work@company.com", not "send via SMTP server X". The connector is an implementation detail resolved automatically from the chosen identity's default outbound connector.

## Connector Architecture

Stork separates how mail enters the system from how mail leaves it:

- **Inbound connectors** handle message ingestion: IMAP polling, Cloudflare Email Workers webhook
- **Outbound connectors** handle sending: SMTP, AWS SES

Connectors are configured independently in Settings → Connectors, then referenced by accounts. An account is purely an identity (name + email address) that points to one inbound and one outbound connector. This `n × m` model means you can, for example, receive via Fastmail IMAP but send through your own AWS SES endpoint for better deliverability — without any coupling between the two.

Adding a new connector type only requires implementing the `IngestConnector` or `SendConnector` interface and registering it in the connector registry.

See [Writing Custom Connectors](./writing-connectors.md) for the interface definitions and a walkthrough.

## When to Run Separate Instances

The unified model is the right default. Run separate Stork instances only when:

- Your employer requires work email to be kept on separate infrastructure
- You're managing email for separate organizations that must not share a database
- You specifically want completely separate encryption passphrases per mailbox

For everything else — multiple personal addresses, aliases, family accounts — one instance handles it more elegantly than switching between separate containers.
