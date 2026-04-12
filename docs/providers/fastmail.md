# Fastmail

Connect Stork to your Fastmail using IMAP and SMTP.

Fastmail supports IMAP natively and is one of the smoothest providers to connect. You'll need an **App Password** for third-party access.

## Step 1: Generate an App Password

1. Log in to [Fastmail](https://app.fastmail.com)
2. Go to **Settings > Privacy & Security > Integrations > App Passwords**
3. Click **New App Password**
4. Name it "Stork" and select **Mail (IMAP/POP/SMTP)** as the access level
5. Click **Generate Password** and copy the result

## Step 2: Connect in Stork

Use these settings when adding a new inbound connector:

| Field | Value |
|-------|-------|
| **IMAP Host** | `imap.fastmail.com` |
| **IMAP Port** | `993` |
| **Username** | `you@fastmail.com` |
| **Password** | Your App Password |

For sending (outbound connector):

| Field | Value |
|-------|-------|
| **SMTP Host** | `smtp.fastmail.com` |
| **SMTP Port** | `587` |
| **Username** | `you@fastmail.com` |
| **Password** | Same App Password |

> **Custom domains:** If you use a custom domain with Fastmail, your username is still your full email address (e.g., `you@yourdomain.com`).

## Fastmail-specific notes

- **Folders**: Fastmail uses real IMAP folders (not Gmail-style labels). Stork converts these into labels during sync, so your folder hierarchy appears as a flat label list.
- **Aliases**: If you have multiple aliases on Fastmail, add each as a separate identity on an outbound connector in Stork to send from any of them.
- **JMAP**: Fastmail pioneered JMAP as a modern replacement for IMAP. Stork currently syncs via IMAP; JMAP support is on the [roadmap](../README.md#roadmap).

## Connector mode with Fastmail

Fastmail is an ideal candidate for connector mode. Once you're comfortable with Stork:

1. Switch to connector mode in Settings > Inbound
2. Use the transition wizard to optionally clean old messages from Fastmail
3. New messages arrive at Fastmail, get fetched by Stork, and are deleted from Fastmail in batches

Your Fastmail subscription still handles receiving and sending — Stork handles storage and search.

## Troubleshooting

**"Authentication failed" error:**
- Make sure you're using the App Password, not your Fastmail login password
- Verify the App Password has IMAP/SMTP access (not just CalDAV or CardDAV)

**Missing folders:**
- Fastmail has some internal folders (e.g., Notes) that may not appear via IMAP. Only mail folders are synced.
