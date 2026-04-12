# Gmail

Connect Stork to your Gmail using IMAP and SMTP.

Gmail requires an **App Password** instead of your regular Google password. This is a 16-character password that grants access to a specific app without exposing your main credentials.

## Prerequisites

- A Google account with [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) enabled (required for App Passwords)
- IMAP enabled in Gmail settings (usually on by default)

## Step 1: Enable IMAP in Gmail

1. Open [Gmail Settings](https://mail.google.com/mail/u/0/#settings/fwdandpop)
2. Go to **Forwarding and POP/IMAP**
3. Under **IMAP access**, select **Enable IMAP**
4. Click **Save Changes**

## Step 2: Generate an App Password

1. Go to [App Passwords](https://myaccount.google.com/apppasswords) in your Google account
2. Enter a name (e.g., "Stork") and click **Create**
3. Google shows a 16-character password — copy it immediately (you won't see it again)

> **Note:** If you don't see the App Passwords option, 2-Step Verification isn't enabled. Enable it first at [Security settings](https://myaccount.google.com/signinoptions/two-step-verification).

## Step 3: Connect in Stork

Use these settings when adding a new inbound connector in Stork:

| Field | Value |
|-------|-------|
| **IMAP Host** | `imap.gmail.com` |
| **IMAP Port** | `993` |
| **Username** | `you@gmail.com` |
| **Password** | Your 16-character App Password |

For sending (outbound connector):

| Field | Value |
|-------|-------|
| **SMTP Host** | `smtp.gmail.com` |
| **SMTP Port** | `587` |
| **Username** | `you@gmail.com` |
| **Password** | Same App Password |

## Gmail-specific notes

- **Labels vs folders**: Gmail uses labels internally, but exposes them as IMAP folders. Stork syncs these as labels, so your Gmail label structure carries over naturally.
- **"All Mail" folder**: Gmail's All Mail folder contains every message. Stork deduplicates by Message-ID, so you won't get duplicate copies even though the same message appears in multiple folders.
- **Sent Mail**: Gmail auto-saves sent messages. If you send via Stork's SMTP, Gmail's Sent folder will have a copy, and Stork will sync it back with the appropriate label.
- **Large mailboxes**: Gmail accounts often have tens of thousands of messages. Initial sync may take a while — Stork syncs incrementally, so you can start reading as messages arrive.

## Connector mode with Gmail

When you switch to connector mode, Stork fetches new messages and deletes them from Gmail's servers in batches. This is particularly useful if you're concerned about Google's access to your email history — over time, your Gmail server becomes empty while Stork holds the encrypted archive.

## Troubleshooting

**"Invalid credentials" error:**
- Make sure you're using the App Password, not your Google account password
- Regenerate the App Password if you've revoked it or changed your Google password

**"IMAP not enabled" error:**
- Check Gmail Settings > Forwarding and POP/IMAP > IMAP access is set to Enabled

**Slow initial sync:**
- Gmail rate-limits IMAP connections. If sync stalls, it usually resumes within a few minutes. Check the sync status in Settings > Inbound.
