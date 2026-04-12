# Provider Setup Guides

Step-by-step instructions for connecting Stork to your email provider.

| Provider | Auth method | Notes |
|----------|------------|-------|
| [Gmail](gmail.md) | App Password | Requires 2-Step Verification |
| [Fastmail](fastmail.md) | App Password | Smoothest setup, custom domains supported |
| [Mailcow](mailcow.md) | Mailbox credentials | Self-hosted, Docker networking tips |
| [ProtonMail](protonmail.md) | ProtonMail Bridge | Requires Bridge running locally, paid plan only |

## General IMAP settings

If your provider isn't listed above, you'll need:

| Field | Typical value |
|-------|--------------|
| **IMAP Host** | `imap.yourprovider.com` |
| **IMAP Port** | `993` (SSL/TLS) |
| **SMTP Host** | `smtp.yourprovider.com` |
| **SMTP Port** | `587` (STARTTLS) |
| **Username** | Your full email address |
| **Password** | Your password or App Password |

Most providers use port 993 for IMAP with implicit TLS and port 587 for SMTP with STARTTLS. Check your provider's documentation for exact settings.

## Other providers

These providers use standard IMAP and work with Stork without special configuration:

- **Yahoo Mail** — IMAP: `imap.mail.yahoo.com:993`, SMTP: `smtp.mail.yahoo.com:587`. Requires an [App Password](https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html).
- **iCloud Mail** — IMAP: `imap.mail.me.com:993`, SMTP: `smtp.mail.me.com:587`. Requires an [app-specific password](https://support.apple.com/en-us/102654).
- **Outlook / Microsoft 365** — IMAP: `outlook.office365.com:993`, SMTP: `smtp.office365.com:587`. May require OAuth2 depending on admin settings; App Passwords work if enabled.
- **Zoho Mail** — IMAP: `imap.zoho.com:993`, SMTP: `smtp.zoho.com:587`. Enable IMAP in Zoho settings first.
- **Dovecot (self-hosted)** — Use your server's hostname with standard ports. Direct credentials, no App Password needed.

Can't find your provider? Open an issue — or check your provider's IMAP/SMTP documentation and use the general settings table above.
