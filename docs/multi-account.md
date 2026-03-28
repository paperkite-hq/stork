# Multi-Account Support

Stork takes a **unified-first** approach to multiple email accounts. Rather than treating each account as an isolated mailbox you switch between, Stork treats all your accounts as inbound flows into one unified mail system.

## Philosophy

Most people who manage multiple email addresses still have one "self" — a work address, a personal address, maybe a project alias. They don't want to mentally switch contexts to find an email; they want one place that shows everything, with enough context to know where a message came from.

Stork is built around this model:

- **One instance, multiple accounts.** Run one Stork container for all your personal email. Only run separate instances when you need true isolation (e.g., employer-mandated separation of work data).
- **Unified views are first-class.** "All Inboxes", "All Mail", and "All Unread" span every connected account. Per-account views are available but secondary.
- **Source-labeled messages.** Every message shows which account it arrived on, so you always know where you are in the unified view.
- **Smart reply identity.** When replying, Stork defaults to the account that received the original message, but lets you choose any account as the sender.

## How It Works

### Sidebar Navigation

When you have more than one account connected, the sidebar shows an **All Accounts** section at the top:

- **All Inboxes** — inbox messages across every account, sorted by date
- **All Unread** — every unread message across every account
- **All Mail** — every stored message across every account

Below that, the per-account section shows the currently selected account's labels (Inbox, Sent, Drafts, etc.) and any user-created labels for that account.

### Account Badges

In any unified view (All Inboxes, All Unread, All Mail), each message row shows the account name it belongs to — e.g., "Work" or "Personal" — so you can tell at a glance where a message came from without losing the unified context.

### Sending From the Right Account

When composing a new message, the "From" field defaults to the currently selected account. When replying to a message, it defaults to the account that received it. You can always change the sender using the From dropdown in the compose window.

## Decoupled Inbound and Outbound Connectors

Stork's connector architecture separates how mail enters the system (inbound: IMAP, Cloudflare Email Workers) from how mail leaves it (outbound: SMTP, AWS SES). Each account today configures both an inbound and outbound connector as a pair, but the system is designed to eventually support a many-to-many model: `n` inbound connectors and `m` outbound connectors, where you pick a sender identity and outbound connector independently when composing.

This is useful when, for example, your mail provider is Fastmail (inbound IMAP) but you want to send via your own AWS SES endpoint for better deliverability. The two sides don't need to be tied together.

See [Writing Custom Connectors](./writing-connectors.md) for the connector interface design.

## When to Run Separate Instances

The unified model is the right default. Run separate Stork instances only when:

- Your employer requires work email to be kept on separate infrastructure
- You're managing email for separate organizations that must not share a database
- You specifically want completely separate encryption passphrases per mailbox

For everything else — multiple personal addresses, aliases, family accounts — one instance handles it more elegantly than switching between separate containers.
