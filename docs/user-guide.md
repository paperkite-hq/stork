# User Guide

This guide covers installing, configuring, and using Stork.

## Installation

### Docker Compose (recommended)

```bash
git clone https://github.com/paperkite-hq/stork.git
cd stork
docker compose up -d
```

Open `http://localhost:3100` in your browser.

### Docker (single container)

```bash
git clone https://github.com/paperkite-hq/stork.git
cd stork
docker build -t stork .
docker run --rm --init \
  -p 127.0.0.1:3100:3100 \
  -v ~/stork-data:/app/data \
  --memory-swappiness=0 \
  --ulimit core=0 \
  --security-opt no-new-privileges \
  stork
```

Your data is stored as regular files at `~/stork-data`. The security flags match the `docker-compose.yml` defaults (disabled swap, no core dumps, no privilege escalation) — important for protecting the in-memory encryption key.

### From Source

Requires [Node.js](https://nodejs.org) 22 or later.

```bash
git clone https://github.com/paperkite-hq/stork.git
cd stork
npm install
cd frontend && npm install && npm run build && cd ..
npm run build && npm start
```

## First-Run Setup: Encryption

When you first start Stork, you'll be prompted to create an encryption password. This password protects your entire database — all emails, attachments, and identity credentials are encrypted at rest using SQLCipher (AES-256).

**Choose a strong password** (minimum 12 characters). Stork uses Argon2id key derivation with 64 MiB memory cost to resist brute-force attacks.

After setting your password, Stork displays a **24-word recovery mnemonic**. This is your only fallback if you forget your password.

**Write it down and store it securely.** If you lose both your password and recovery mnemonic, your data is permanently unrecoverable. There is no backdoor, no master key, and no password reset mechanism.

### Unlocking

Every time the container starts, it boots into a locked state. Open the web UI and enter your password to unlock. All API endpoints return `423 Locked` until you do.

### Changing Your Password

Go to Settings > Security to change your password. This is instant regardless of database size — only the key envelope is re-wrapped, not the data.

### Rotating the Recovery Key

If you suspect your recovery mnemonic has been compromised, rotate it from Settings > Security. This generates a new 24-word mnemonic and invalidates the old one. Like password changes, this is an O(1) operation.

### Password Recovery

If you forget your password but have your recovery mnemonic, use it on the unlock screen. You'll be prompted to set a new password. The recovery mnemonic is not invalidated by this process.

## Adding an Email Identity

After unlocking, you'll see the Welcome screen prompting you to add an identity.

You'll need:
- **IMAP server hostname** (e.g., `imap.fastmail.com`, `imap.gmail.com`)
- **IMAP username** — usually your email address
- **IMAP password** — use an app-specific password if your provider supports them (recommended for Gmail, Fastmail, etc.)
- **SMTP server hostname** (optional, for sending) — e.g., `smtp.fastmail.com`
- **SMTP credentials** (optional) — often the same as IMAP

### Common IMAP/SMTP Settings

| Provider | IMAP Host | IMAP Port | SMTP Host | SMTP Port |
|----------|-----------|-----------|-----------|-----------|
| Gmail | imap.gmail.com | 993 | smtp.gmail.com | 587 |
| Fastmail | imap.fastmail.com | 993 | smtp.fastmail.com | 587 |
| Outlook/Hotmail | outlook.office365.com | 993 | smtp.office365.com | 587 |
| Mailcow | your-server.com | 993 | your-server.com | 587 |
| Dovecot | your-server.com | 993 | your-server.com | 587 |
| ProtonMail | 127.0.0.1 (Bridge) | 1143 | 127.0.0.1 (Bridge) | 1025 |

**Gmail users**: You must use an [App Password](https://support.google.com/accounts/answer/185833). Regular passwords won't work with IMAP.

**ProtonMail users**: You'll need the [ProtonMail Bridge](https://proton.me/mail/bridge) running locally.

After entering your credentials, Stork begins syncing immediately. The initial sync may take a few minutes depending on the size of your mailbox.

## Using Stork

### Reading Mail

The interface has three panels:
- **Sidebar** (left) — promoted views (Inbox, Unread, All Mail) at the top, followed by your labels. Click any view or label to see its messages.
- **Message list** (center) — messages in the selected view, newest first. Unread messages are visually distinguished. Click "Load more" at the bottom for older messages.
- **Message detail** (right) — the full message content when you select a message.

### Composing and Replying

Click the compose button to write a new message. When viewing a message, use the Reply or Reply All buttons.

Composing requires SMTP credentials configured on the identity. If you only set up IMAP, you can read mail but not send.

### Search

Click the search icon or press `/` to open the search panel. Stork uses full-text search powered by SQLite FTS5.

**Search tips**:
- `quarterly report` — finds messages containing both "quarterly" and "report"
- `"quarterly report"` — finds the exact phrase
- `from:jane budget` — searches for "from:jane" and "budget" in all indexed fields
- `meeting NOT cancelled` — finds "meeting" but excludes messages containing "cancelled"

Search covers the subject, sender name, sender address, recipient addresses, and message body.

### Keyboard Shortcuts

Press `?` to see available keyboard shortcuts. Navigation, compose, and search actions are all available via keyboard.

### Dark Mode

Toggle dark mode from the settings or use the theme button. Your preference is saved in the browser.

### Multiple Identities

You can add multiple email identities from the Settings panel. Each identity syncs independently on its own schedule. The sidebar shows all identities with their labels.

### Mail Organization Philosophy

Stork uses a **labels, not folders** model inspired by Gmail. Every IMAP folder is synced as a label, and messages can have multiple labels simultaneously. The sidebar is organized into two sections:

**Promoted views** (always at the top of the sidebar):
- **Inbox** — your landing view. Shows messages with the Inbox label. This is portable across providers because every IMAP server has an INBOX folder, which Stork syncs as a label.
- **Unread** — shows all unread messages across every label. This is a Stork-internal unread bit and does not flow back to the IMAP server. Useful when your IMAP server auto-sorts emails into folders — new messages in those folders will surface here.
- **All Mail** — every message for the identity, regardless of labels. Nothing is hidden from this view.

**Labels** (below the divider):
- All other labels (Sent, Drafts, Trash, Spam, custom labels, etc.) appear in the lower section.

#### Archive workflow

Archiving removes the **Inbox** label from a message. The message remains accessible in All Mail and any other labels it has. This mirrors Gmail's archive behavior — "archive" means "I'm done with this, get it out of my inbox."

- The **Archive** action (`e` key) is **only available when viewing the Inbox**. It always removes the Inbox label, regardless of what other labels the message has.
- When viewing All Mail, Unread, or any other label, archive is disabled — these are read-only views where the concept of "archiving" does not apply. To manage labels on messages in these views, use the label picker (tag icon).
- Archiving is purely local — Stork does not move messages on your IMAP server.

#### Labels

Stork organizes email with labels instead of folders. When your email syncs from an IMAP server, each folder name automatically becomes a label. You can also create your own labels to organize mail however you like.

Unlike folders, a message can have multiple labels — so you can tag an email as both "Work" and "Important" without moving it between folders. Labels with unread counts appear in the sidebar for quick navigation.

#### Creating labels

Click **+ Create label** at the bottom of the label list in the sidebar. Enter a name and optionally pick a color from the palette. Press Enter or click "Create label" to save.

#### Editing and deleting labels

Right-click any user-created label in the sidebar to open a context menu with **Edit label** and **Delete label** options. IMAP-synced labels (Inbox, Sent, Drafts, etc.) cannot be edited or deleted.

Deleting a label removes it from all messages but does not delete the messages themselves.

#### Labeling messages

When viewing a message, click the tag icon in the message header to open the label picker. Check or uncheck labels to add or remove them from that message. Changes take effect immediately.

## Sync Behavior

### How Sync Works

Stork syncs mail using the IMAP protocol:

1. **Folder sync** — fetches the list of folders from your IMAP server. Detects new, renamed, and deleted folders.
2. **Message sync** — for each folder, fetches messages newer than what Stork already has (incremental sync using IMAP UIDs).
3. **Flag sync** — updates read/unread/starred status for existing messages.

Sync runs automatically every 5 minutes per identity. You can also trigger a manual sync from the UI.

### What Stork Does NOT Do (by default)

- **Stork does not delete mail from your server by default.** The sync is strictly read-only. To use Stork as a permanent local archive, turn on **Connector mode** in Settings for the inbound connector. With it enabled, Stork automatically removes messages from the IMAP server after syncing them locally — your mail provider becomes a transient delivery edge, and Stork becomes the single source of truth.
- **Stork does not modify flags on the server.** Marking a message as read in Stork only affects local storage. Your IMAP server's flags remain unchanged.

### Switching to Connector Mode

When you're ready to commit to Stork as your primary mail archive, a **transition wizard** guides you through the switch:

1. **Re-label from server** (optional, recommended) — reconciles any folder changes made by other email clients (Thunderbird, phone apps) since messages were first synced. Stork fetches current folder memberships from the server, compares against locally-stored labels, and updates to match. This ensures your labels reflect the current server state before you commit.

2. **Clean Server** (optional) — removes already-synced messages from your mail provider in batches of 100. This clears your provider's mailbox of mail Stork already has, so your provider becomes a clean delivery endpoint. This is a one-time action and cannot be undone.

Both actions are also available individually from the inbound connector settings at any time.

### Sync Errors

If sync fails (network issues, bad credentials, server downtime), Stork uses exponential backoff — it waits longer between retries to avoid hammering the server. The sync status indicator in the UI shows the current state. Once the issue is resolved, sync resumes automatically.

## Configuration

Stork is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `STORK_DATA_DIR` | `./data` | Directory for the SQLite database and attachments |
| `STORK_PORT` | `3100` | HTTP port for the web UI and API |

### Data Storage

All data is stored in `$STORK_DATA_DIR`:
- `stork.db` — encrypted SQLite database (identities, folders, messages, FTS index)
- `stork.keys` — encrypted vault key envelopes (password + recovery key wrappings)
- Attachments are stored inside the SQLite database as BLOBs (encrypted along with everything else)

### Backups

To back up Stork, copy the `stork.db` file while Stork is stopped, or use SQLite's `.backup` command for a live backup.

With Docker Compose:
```bash
docker compose stop
cp /var/lib/docker/volumes/stork_stork-data/_data/stork.db ~/stork-backup.db
docker compose start
```

With a bind mount (direct `docker run`):
```bash
cp ~/stork-data/stork.db ~/stork-backup.db
```

### Reverse Proxy

To run Stork behind a reverse proxy (Nginx, Caddy, Traefik), proxy all traffic to `localhost:3100`.

**Nginx example**:
```nginx
server {
    listen 443 ssl;
    server_name mail.example.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy example**:
```
mail.example.com {
    reverse_proxy localhost:3100
}
```

### Security Considerations

- **Encryption at rest**: All data (emails, credentials, attachments, FTS index) is encrypted using SQLCipher (AES-256). The database files on disk are opaque bytes without the password.
- **Authentication**: The encryption password serves as the primary authentication mechanism. If exposed beyond localhost, you should still use a reverse proxy with additional authentication (e.g., Authelia, Authentik, HTTP Basic Auth, VPN) as defense in depth.
- **Container security**: The `docker-compose.yml` and recommended `docker run` flags disable swap (`mem_swappiness: 0`), core dumps (`ulimit core=0`), and privilege escalation (`no-new-privileges`) to protect the in-memory vault key.
- **Email HTML isolation**: HTML emails are rendered inside a sandboxed iframe that blocks all script execution at the browser level. Even if a novel XSS vector bypasses the HTML sanitizer, the sandbox prevents it from running. Additionally, DOMPurify strips dangerous tags/attributes, CSS `url()` references are neutralized, and Content-Security-Policy headers provide further defense-in-depth. See `docs/architecture.md` for the full security model.
- Attachment filenames are sanitized to prevent path traversal.

## Troubleshooting

### "Connection refused" on port 3100

Stork isn't running. Check container logs:
```bash
docker compose logs stork
```

### Initial sync is slow

The first sync downloads all messages, which can take several minutes for large mailboxes. Subsequent syncs are incremental and much faster.

### Gmail says "Less secure app access"

Use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password. Gmail requires this for IMAP access when 2FA is enabled.

### Sync shows errors but mail still arrives

Transient network errors are normal. Stork retries with backoff. If errors persist, check your IMAP credentials and server connectivity.

### Search returns no results

The FTS index is built automatically as messages are synced. If you just added an identity, wait for the initial sync to complete. The search covers subject, sender, recipients, and body text.
