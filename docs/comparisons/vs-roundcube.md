# Stork vs Roundcube

Choosing between Stork and Roundcube? Both are self-hosted email clients, but they serve different needs. This page breaks down the differences so you can pick the right tool.

## At a Glance

| | Stork | Roundcube |
|---|---|---|
| **What it is** | Self-hosted email client with encrypted local storage | PHP-based webmail client |
| **Deployment** | Docker (single container) | PHP + web server + MySQL/PostgreSQL |
| **Encryption at rest** | ✅ AES-256 via SQLCipher | ❌ |
| **Local storage** | ✅ SQLite (self-contained) | ✅ MySQL or PostgreSQL (external) |
| **Full-text search** | ✅ FTS5 (fast, indexed) | ⚠️ Basic (server-side IMAP SEARCH) |
| **Web UI** | React + Tailwind | jQuery |
| **Label-based organization** | ✅ Gmail-style labels | ❌ Folders only |
| **Compose & send** | ✅ SMTP | ✅ SMTP |
| **Recovery key** | ✅ 24-word BIP39 mnemonic | ❌ |
| **Plugin ecosystem** | Connector architecture (IMAP, SMTP, SES, CF Workers) | Large plugin library (calendar, contacts, managesieve) |
| **Multi-user** | Single-user (per container) | Multi-user with shared DB |

## Architecture Differences

**Roundcube** is a traditional webmail client. It talks to your IMAP server on every request — when you open a message, Roundcube fetches it from IMAP in real time. There's no local copy of your email. The MySQL/PostgreSQL database stores contacts, settings, and cache, but your mail stays on the IMAP server. This means Roundcube is stateless with respect to your email — fast to set up, but search and browsing speed depend entirely on your IMAP server's performance.

**Stork** syncs your entire mailbox into local SQLite storage, encrypted with AES-256. Once synced, all operations — search, browsing, threading — happen against the local database, not the IMAP server. This makes Stork faster for search-heavy workflows and means your email is available even if the IMAP server is temporarily unreachable. The trade-off is that the initial sync takes time (proportional to mailbox size) and uses local disk space.

```
Roundcube architecture:
  Browser → Roundcube (PHP) → IMAP server (mail lives here)
                             → SMTP server (sending)
                             → MySQL/PostgreSQL (settings, cache)

Stork architecture:
  Browser → Stork (Node.js) → SQLite/SQLCipher (mail lives here, encrypted)
                             → IMAP server (sync source)
                             → SMTP server (sending)
```

## When to Choose Roundcube

- **Multi-user shared hosting** — Roundcube handles multiple users with a shared database and per-user IMAP connections. Ideal for organizations or mail hosting providers.
- **Calendar and contacts integration** — Roundcube's plugin ecosystem includes CalDAV calendar, CardDAV contacts, and Sieve filter management. If you need these today, Roundcube has them.
- **Thin-client deployment** — since Roundcube doesn't store mail locally, it uses minimal disk space and works well on constrained VPSes.
- **Familiarity** — Roundcube has been around since 2005 and is the default webmail for cPanel, Plesk, and most hosting panels. Documentation and community support are extensive.

## When to Choose Stork

- **Encryption at rest** — Stork encrypts your entire mailbox with AES-256 via SQLCipher. The database is unreadable without your password. Roundcube stores nothing encrypted at rest.
- **Fast local search** — FTS5-powered full-text search across your entire mailbox, instantly. No dependency on IMAP server search capabilities.
- **Taking ownership of your email** — Stork's connector mode lets you use your mail provider as a transient delivery pipe while keeping the only copy of your email encrypted on your hardware.
- **Simple deployment** — `docker compose up` and you're running. No PHP, no external database server, no web server configuration.
- **Label-based organization** — if you're coming from Gmail and prefer labels over rigid folder hierarchies, Stork's organizational model will feel familiar.

## Migration Path

### From Roundcube to Stork

There's no direct Roundcube-to-Stork migration tool because Roundcube doesn't store your email — it's all on the IMAP server. Migration is straightforward:

1. Deploy Stork and connect it to the same IMAP server Roundcube uses.
2. Stork syncs your entire mailbox from the IMAP server into encrypted local storage.
3. Once synced, verify your mail is complete in Stork.
4. Optionally enable connector mode to start treating the IMAP server as a delivery edge.
5. Decommission Roundcube when ready.

Your Roundcube contacts and settings won't transfer automatically — export contacts as vCard from Roundcube and re-import them when Stork adds address book support.

### From Stork to Roundcube

Since Stork syncs from IMAP, your mail is still on the IMAP server (in mirror mode). Point Roundcube at the same server and you're back. If you're in connector mode, you'll need to re-sync mail from Stork's local storage back to an IMAP server first — Stork doesn't currently support IMAP server export, so this would require manual intervention.

## Feature Comparison Detail

### Search

Roundcube relies on IMAP SEARCH, which varies wildly between servers. Dovecot with FTS (Solr or Xapian) is fast; a basic Dovecot install without FTS is slow on large mailboxes. Stork runs FTS5 locally, so search performance is consistent regardless of your IMAP server.

### Security Model

Roundcube inherits whatever security your IMAP server provides. If the server's disk is unencrypted, your email is readable by anyone with server access. Stork encrypts the local database with AES-256 — even root on the host machine can't read your email without the password. A BIP39 recovery key ensures you can recover if you forget your password.

### Deployment Complexity

Roundcube needs PHP, a web server (Apache/Nginx), and a database server (MySQL/PostgreSQL). Most hosting panels bundle it, but standalone deployment involves configuring multiple services. Stork is a single Docker container — the database is embedded.
