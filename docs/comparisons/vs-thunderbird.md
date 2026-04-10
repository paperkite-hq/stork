# Stork vs Thunderbird

Stork and Thunderbird are both email clients, but they approach the problem differently. Thunderbird is a desktop application; Stork is a self-hosted web application. This page helps you decide which fits your workflow.

## At a Glance

| | Stork | Thunderbird |
|---|---|---|
| **What it is** | Self-hosted email client (web-based) | Desktop email client |
| **Platform** | Any browser (runs on a server/NAS) | Windows, macOS, Linux |
| **Deployment** | Docker (single container) | Desktop installer |
| **Encryption at rest** | ✅ AES-256 via SQLCipher | ❌ (profile folder is unencrypted) |
| **Access from multiple devices** | ✅ Any device with a browser | ❌ Installed on one machine |
| **Full-text search** | ✅ FTS5 (fast, indexed) | ✅ Gloda (SQLite-based) |
| **Compose & send** | ✅ SMTP | ✅ SMTP |
| **Calendar** | ❌ (planned) | ✅ Built-in (Lightning) |
| **Contacts** | ❌ (planned) | ✅ Built-in address book |
| **PGP/S-MIME** | ❌ (planned) | ✅ Built-in OpenPGP |
| **Offline access** | ✅ (server has all mail locally) | ✅ (with offline folders) |
| **Extensions/add-ons** | Connector architecture | Large add-on ecosystem |
| **Recovery key** | ✅ 24-word BIP39 mnemonic | ❌ |

## Architecture Differences

**Thunderbird** is a traditional desktop email client. It runs on your local machine, connects to IMAP/POP3/SMTP servers, and stores mail in your OS profile directory (typically as mbox or maildir files). Your email lives unencrypted in your home directory — anyone with access to your filesystem can read it. Thunderbird talks directly to your mail server from your desktop.

**Stork** is a self-hosted web application. It runs on a server (your NAS, a VPS, or a home server), syncs mail from IMAP into an encrypted SQLite database, and serves a web UI. You access it from any browser on any device. The database is encrypted at rest with AES-256 — even if someone gains access to the server's filesystem, they can't read your email without the password.

```
Thunderbird architecture:
  Desktop app → IMAP/SMTP server
              → Local profile (mbox files, unencrypted)

Stork architecture:
  Any browser → Stork server → SQLite/SQLCipher (encrypted)
                              → IMAP/SMTP server
```

## When to Choose Thunderbird

- **Desktop-native experience** — Thunderbird integrates with your OS (notifications, drag-and-drop, file system access). If you prefer a native app over a browser tab, Thunderbird is the way to go.
- **Calendar and contacts now** — Thunderbird has a mature built-in calendar (Lightning), address book, and CalDAV/CardDAV sync. Stork doesn't have these yet.
- **PGP encryption for messages** — Thunderbird has built-in OpenPGP support for encrypting individual messages end-to-end. Stork encrypts the database at rest but doesn't yet support per-message PGP/S/MIME.
- **No server to manage** — Thunderbird runs on your desktop with zero infrastructure. Stork needs a server or Docker host.
- **Large add-on ecosystem** — Thunderbird's extensions cover everything from grammar checking to project management integrations.

## When to Choose Stork

- **Encryption at rest** — Stork encrypts your entire mailbox with AES-256 via SQLCipher. Thunderbird stores your profile unencrypted on disk. If your laptop is stolen, Thunderbird's mail is readable; Stork's isn't (without the password).
- **Access from anywhere** — Stork runs on a server and you access it from any browser. Check email from your phone, tablet, or any computer without installing anything. Thunderbird is tied to the machine it's installed on.
- **Server-side availability** — Stork syncs continuously on the server, so your mailbox is always up to date. Thunderbird only syncs when it's running on your desktop.
- **Self-hosted but centralized** — if you have a home server or NAS, Stork gives you a single point of email storage that all your devices can access, encrypted, without relying on the IMAP server to hold your mail.
- **Connector mode** — Stork can fetch mail from your provider and delete it from the server, making your Stork instance the only copy. Thunderbird can sync locally but doesn't have a built-in workflow for clearing the server.

## Migration Path

### From Thunderbird to Stork

Thunderbird stores mail in your profile directory as mbox files. There's no direct import from Thunderbird profiles into Stork yet (it's on the [roadmap](../README.md#planned)). For now:

1. Make sure your mail is still on the IMAP server (Thunderbird in IMAP mode keeps mail on the server by default).
2. Deploy Stork and connect it to the same IMAP server.
3. Stork syncs your mailbox into encrypted local storage.
4. Verify completeness, then optionally enable connector mode.

If you were using Thunderbird in POP3 mode (mail only on your local machine), you'll need to re-upload mail to an IMAP server first — tools like `imapsync` or `mbsync` can help.

### From Stork to Thunderbird

In mirror mode, your mail is still on the IMAP server — just point Thunderbird at it. In connector mode, mail exists only in Stork's encrypted database, so you'd need to restore it to an IMAP server before Thunderbird can access it.

## Feature Comparison Detail

### Search

Both clients offer local full-text search. Thunderbird uses Gloda (Global Database), an SQLite-backed index. Stork uses FTS5 (SQLite's built-in full-text search extension). Both are fast for typical mailbox sizes. Stork's search runs server-side, so results are available from any device; Thunderbird's search only works on the machine where the index was built.

### Security Model

Thunderbird's profile directory is stored unencrypted on your filesystem. If you use full-disk encryption (LUKS, FileVault, BitLocker), your mail is protected when the machine is off — but not while you're logged in. Stork encrypts the database at the application level: the container boots locked and requires a password to unlock. Even a running server with the volume mounted shows only ciphertext until the password is entered.

### Multi-Device Access

This is the fundamental difference. Thunderbird is one machine, one installation. You can run Thunderbird on multiple machines, but each has its own local state, and they don't stay in sync with each other (beyond what the IMAP server provides). Stork is a single server that all your devices access through the browser — one mailbox, one search index, consistent state everywhere.
