# Getting Started

This guide walks you through your first session with Stork — from launching the container to reading, searching, and organizing your email. If you haven't installed Stork yet, see the [Quick Start](../README.md#quick-start) section.

## 1. Launch Stork

The fastest way to get running:

```bash
docker run -d --init \
  -p 127.0.0.1:3100:3100 \
  -v ~/stork-data:/app/data \
  --restart unless-stopped \
  --memory-swappiness=0 \
  --ulimit core=0 \
  --security-opt no-new-privileges:true \
  ghcr.io/paperkite-hq/stork:latest
```

Open [http://localhost:3100](http://localhost:3100) in your browser. You'll see the setup screen.

## 2. Set Up Encryption

Stork encrypts everything on disk — emails, attachments, credentials, and the search index. The first thing you'll do is create a password.

**Create your encryption password.** Choose something strong (12+ characters). This password is used to derive an AES-256 encryption key via Argon2id. It unlocks the database every time Stork starts — there's no separate login step.

After you set your password, Stork displays a **24-word recovery mnemonic**. This is critical:

- **Write it down on paper** or save it in a password manager.
- **Store it separately from your password.** If you lose both, your data is unrecoverable.
- The recovery mnemonic lets you reset your password if you forget it. You can rotate it later from Settings > Security if it's ever compromised.

Once you confirm your recovery mnemonic is saved, Stork unlocks and you'll see the Welcome screen.

> **Every restart requires unlocking.** When the container restarts, Stork boots into a locked state. Open the web UI and enter your password to unlock. All API requests return `423 Locked` until you do.

## 3. Connect Your Email

The Welcome screen prompts you to connect your first email account. You'll need your IMAP server details:

| Field | Example (Gmail) | Example (Fastmail) |
|-------|-----------------|-------------------|
| IMAP Host | `imap.gmail.com` | `imap.fastmail.com` |
| IMAP Port | `993` | `993` |
| Username | `you@gmail.com` | `you@fastmail.com` |
| Password | App Password | App Password |
| SMTP Host (optional) | `smtp.gmail.com` | `smtp.fastmail.com` |
| SMTP Port | `587` | `587` |

**Important notes:**

- **Gmail** requires an [App Password](https://support.google.com/accounts/answer/185833) — your regular password won't work.
- **ProtonMail** requires the [ProtonMail Bridge](https://proton.me/mail/bridge) running locally (IMAP on `127.0.0.1:1143`).
- **SMTP is optional.** Without it, you can read mail but not send. You can add SMTP credentials later in Settings.

See the [User Guide](user-guide.md#common-imapsmtp-settings) for a full provider table.

Enter your credentials and click connect. Stork validates the connection before saving.

## 4. Your First Sync

After connecting your email, Stork immediately starts syncing.

**What happens during the initial sync:**

1. Stork fetches your folder list from the IMAP server.
2. Each folder becomes a **label** (more on this in step 6).
3. Messages are downloaded, encrypted, and stored locally. The full-text search index is built as messages arrive.

**How long does it take?** Depends on your mailbox size. A few thousand messages sync in under a minute. Tens of thousands may take several minutes. You can start using Stork while the sync is still running — messages appear as they're downloaded.

**The sync status indicator** in the UI shows progress. Once the initial sync completes, Stork syncs automatically every 5 minutes. You can also trigger a manual sync at any time.

**Good to know:**

- Stork **does not modify your IMAP server by default**. The sync is read-only — no messages are deleted, moved, or modified on the server. It's safe to use against a production mailbox. To use Stork as a permanent local archive (auto-delete from IMAP after sync), enable **Connector mode** in Settings > Inbound.
- Subsequent syncs are **incremental** — only new messages are fetched, so they're fast.
- If sync fails (network issue, bad credentials), Stork uses exponential backoff and retries automatically.

## 5. Searching Email

Once messages have synced, you can search across everything.

Press `/` or click the search icon to open the search panel. Stork uses SQLite FTS5 for fast full-text search across subjects, senders, recipients, and message bodies.

**Search examples:**

| Query | What it finds |
|-------|--------------|
| `quarterly report` | Messages containing both words (anywhere) |
| `"quarterly report"` | Messages containing the exact phrase |
| `meeting NOT cancelled` | "meeting" but not "cancelled" |
| `from:jane budget` | "from:jane" and "budget" across all fields |

Search results appear instantly, even across large mailboxes. The FTS5 index is encrypted along with everything else — it's built at sync time and doesn't require a separate indexing step.

## 6. Using Labels

Stork organizes email with **labels instead of folders**. This is a deliberate design choice — labels are more flexible because a single message can have multiple labels.

### How labels work

When Stork syncs from your IMAP server, each folder name automatically becomes a label. Your Inbox folder becomes the `Inbox` label, Sent becomes `Sent`, and so on. These IMAP-synced labels appear in the sidebar alongside any labels you create.

### The sidebar

The sidebar is split into two sections:

- **Promoted views** (top): Inbox, Unread, and All Mail. These are always visible.
  - **Inbox** — messages with the Inbox label. Your default landing view.
  - **Unread** — all unread messages across every label. Useful when your server sorts mail into folders automatically.
  - **All Mail** — every message, regardless of labels.
- **Labels** (below the divider): All other labels — Sent, Drafts, Trash, custom labels, etc.

### Creating labels

Click **+ Create label** at the bottom of the label list. Give it a name and optionally pick a color.

### Labeling messages

When viewing a message, click the tag icon to open the label picker. Check or uncheck labels to add or remove them. A message can have as many labels as you want.

### Archiving

When viewing the Inbox, press `e` to archive a message. This removes the Inbox label — the message stays in All Mail and any other labels it has. Archiving means "I'm done with this, get it out of my inbox."

### Editing and deleting labels

Right-click any label you created in the sidebar to edit or delete it. IMAP-synced labels (Inbox, Sent, etc.) can't be modified. Deleting a label removes it from all messages but doesn't delete the messages.

## Next Steps

You're up and running. Here are some things to explore:

- **Keyboard shortcuts** — press `?` to see all available shortcuts.
- **Dark mode** — toggle from the settings or theme button.
- **Multiple accounts** — connect more email accounts from Settings. Each syncs independently.
- **Compose email** — click the compose button (requires SMTP configured).
- **Change your password** — Settings > Security. This is instant regardless of database size.

For the full reference, see the [User Guide](user-guide.md). For configuration options (data directory, port, reverse proxy), see [Configuration](configuration.md).
