<p align="center">
  <img src="docs/logo.svg" alt="Stork" width="128">
</p>

<h1 align="center">Stork</h1>

<p align="center">
  <a href="https://github.com/paperkite-hq/stork/releases/latest"><img src="https://img.shields.io/github/v/release/paperkite-hq/stork" alt="Latest Release"></a>
  <a href="https://github.com/paperkite-hq/stork/actions/workflows/ci.yml"><img src="https://github.com/paperkite-hq/stork/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://paperkite-hq.github.io/stork/"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/paperkite-hq/stork/badges/coverage.json" alt="Coverage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
</p>

**Self-hosted email client with encrypted local storage, IMAP sync, and full-text search.**

> Self-host the client, not the edge.

**[Try the read-only demo →](https://stork-demo.paperkite.sh)** — no install needed, sample data pre-loaded.

![Stork inbox](docs/screenshots/inbox.png)

Stork syncs your email from any IMAP server, stores it locally with **AES-256 encryption at rest**, full-text search, and a modern web interface. Keep using your existing mail server for sending and receiving — Stork handles storage, search, and the UI.

- **Encryption at rest** — AES-256 via SQLCipher. Container boots locked; your password unlocks it.
- **Sync from any IMAP server** — Mailcow, Dovecot, Fastmail, whatever you've got
- **Full-text search** — FTS5-powered search across your entire mailbox, instantly
- **Compose & send** — reply, reply-all, forward, and compose via your SMTP server
- **Labels, not folders** — Gmail-style labels replace rigid folder hierarchies ([why?](docs/design-decisions.md))
- **Multi-identity** — connect multiple email identities; unified inbox shows all messages in one view
- **Mirror & Connector modes** — test the waters with your provider as backup, then flip to Connector mode when you're ready to commit
- **Desktop notifications** — new mail alerts as messages arrive
- **Recovery key** — 24-word BIP39 mnemonic so a forgotten password doesn't mean lost mail
- **Single container** — `docker compose up` and you're running. No PHP, no external DB.

## Quick Start

```yaml
# docker-compose.yml
services:
  stork:
    image: ghcr.io/paperkite-hq/stork:latest
    init: true
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - stork-data:/app/data
    restart: unless-stopped
    mem_swappiness: 0
    ulimits:
      core: 0
    security_opt:
      - no-new-privileges:true

volumes:
  stork-data:
```

```bash
docker compose up -d
# Open http://localhost:3100
```

The setup wizard will guide you through creating a password and connecting your email. See the [Getting Started guide](docs/getting-started.md) for a full walkthrough.

<details>
<summary>Docker run (single command)</summary>

```bash
docker run -d --init \
  -p 127.0.0.1:3100:3100 \
  -v ~/stork-data:/app/data \
  --memory-swappiness=0 \
  --ulimit core=0 \
  --security-opt no-new-privileges \
  --restart unless-stopped \
  ghcr.io/paperkite-hq/stork:latest
```

Binds to localhost only, stores the encrypted database in `~/stork-data`, disables swap/core dumps/privilege escalation.
</details>

<details>
<summary>Build from source</summary>

```bash
git clone https://github.com/paperkite-hq/stork.git
cd stork
docker compose up --build
```
</details>

## Screenshots

**Threaded conversations** — messages grouped by thread with expand/collapse, reply, reply-all, and forward:

![Thread view](docs/screenshots/thread.png)

**Compose** — clean compose form with keyboard shortcut to send:

![Compose form](docs/screenshots/compose.png)

## Connector Mode — Your Email, Permanently Yours

Most email clients treat your mail provider as the source of truth. Stork inverts this: **your provider is the delivery edge; Stork is your permanent encrypted archive.**

The idea is simple. Your inbox is full of sensitive history — receipts, contracts, conversations — and right now it lives on someone else's server indefinitely. Stork lets you take it back.

**Mirror mode** (default): Stork syncs a local encrypted copy while leaving your provider's mailbox intact. Use this while you're evaluating — your provider stays your safety net, and you can fall back to its interface at any time.

**Connector mode**: Once you're confident Stork is right for you, flip the switch. New messages are fetched and deleted from your provider in interleaved batches as they arrive — 100 at a time, so your server starts clearing immediately rather than in one big sweep at the end. Your provider becomes just the delivery pipe — a connector that feeds mail into Stork; Stork holds the only copy, AES-256 encrypted, on your own hardware.

```
         Mirror mode                    Connector mode
  ┌──────────────────────┐          ┌──────────────────────┐
  │  Mail provider       │          │  Mail provider       │
  │  (holds all mail)    │          │  (transient — 1 hop) │
  └──────────┬───────────┘          └──────────┬───────────┘
             │ IMAP sync                        │ IMAP sync + delete
             ▼                                  ▼
  ┌──────────────────────┐          ┌──────────────────────┐
  │  Stork               │          │  Stork               │
  │  (encrypted copy)    │          │  (only copy, AES-256)│
  └──────────────────────┘          └──────────────────────┘
```

The UI walks you through this choice when you connect your first email, and surfaces an ambient reminder while any identity is still in mirror mode. The [User Guide](docs/user-guide.md) covers both modes in detail. The connector architecture supports any mail source — not just IMAP — so connector mode generalizes naturally as new connectors are added.

## How Stork Compares

| | Stork | Roundcube | Bichon | Mailu |
|---|---|---|---|---|
| **What it is** | Email client | Webmail client | Email archiver | Full mail server |
| **Deployment** | Docker (single container) | PHP + web server + DB | Docker / binary | Docker (multi-container) |
| **Encryption at rest** | ✅ AES-256 SQLCipher | ❌ | ❌ | ❌ |
| **Local storage** | ✅ SQLite | ✅ MySQL/PostgreSQL | ✅ EML files + Tantivy | ✅ (full server) |
| **Full-text search** | ✅ FTS5 (fast, indexed) | ⚠️ basic | ✅ Tantivy | ✅ Solr |
| **Web UI** | ✅ React | ✅ jQuery | ✅ React | ✅ (Roundcube/Rainloop) |
| **Label-based org** | ✅ | ❌ (folders only) | ❌ | ❌ (folders only) |
| **Compose/send** | ✅ SMTP | ✅ | ❌ (read-only) | ✅ (full MTA) |
| **Recovery key** | ✅ BIP39 mnemonic | ❌ | ❌ | ❌ |
| **Self-contained** | ✅ (no PHP, no extra DB) | ❌ | ✅ | ❌ (many services) |

**Roundcube** is the most mature option with the deepest plugin ecosystem — better for calendar integration or multi-user shared hosting. **Bichon** is focused on email archiving — better for long-term preservation of large mailboxes. **Mailu** is a complete mail server stack — use it if you need to replace your mail infrastructure entirely. Stork is a client that connects to your existing server.

**Detailed comparisons:** [vs Roundcube](docs/comparisons/vs-roundcube.md) · [vs Thunderbird](docs/comparisons/vs-thunderbird.md) · [vs Bichon](docs/comparisons/vs-bichon.md)

## Roadmap

- [x] IMAP sync engine (incremental, resumable)
- [x] SQLite storage with FTS5 full-text search
- [x] SMTP sending via configured server
- [x] Web UI — inbox, threads, compose, search
- [x] Docker single-container deployment
- [x] Label-based organization (Gmail-style)
- [x] Encryption at rest (AES-256 via SQLCipher, BIP39 recovery key)
- [x] Pluggable connector architecture
- [x] Delete-from-server workflow (connector mode)
- [x] Multi-identity support (unified inbox)
- [x] Connector mode transition wizard (clean server, re-label from server)
- [x] zlib compression for large email bodies and attachments
- [x] HTML text extraction for full-text search on HTML-only emails
- [x] Hash-based attachment deduplication

### Planned

- [ ] Filter rules and auto-labeling (server-side, applied on sync)
- [ ] JMAP connector (pluggable alternative to IMAP)
- [ ] CalDAV calendar integration (read-only events from email invites)
- [ ] PGP/S-MIME message encryption and signature verification
- [ ] Push notifications via IMAP IDLE
- [ ] Address book with auto-complete from message history
- [ ] Import from mbox, EML, and Thunderbird profiles
- [ ] Themes and UI customization

## Documentation

- **[Getting Started](docs/getting-started.md)** — first launch, encryption setup, adding an email identity
- **[User Guide](docs/user-guide.md)** — search tips, backups, reverse proxy
- **[Use Cases](docs/use-cases.md)** — encrypted Gmail backup, Mailcow replacement, VPN access
- **[Configuration](docs/configuration.md)** — environment variables, Docker options
- **[API Reference](docs/api.md)** — REST API documentation
- **[Architecture](docs/architecture.md)** — system design and codebase walkthrough
- **[Design Decisions](docs/design-decisions.md)** — labels over folders, and why
- **[Upgrading](docs/upgrading.md)** — migrations, backups, and version upgrades
- **[FAQ](docs/faq.md)** — common questions about sync, search, and data safety
- **[Changelog](CHANGELOG.md)** — release history and what's new
- **[Contributing](CONTRIBUTING.md)** — development setup, running tests

## Development

```bash
npm install
npm run dev    # Start dev server
npm test       # Run tests
npm run lint   # Lint
```

## Tech Stack

[Node.js](https://nodejs.org) 22+ · [Hono](https://hono.dev) · SQLite/[SQLCipher](https://www.zetetic.net/sqlcipher/) · [FTS5](https://www.sqlite.org/fts5.html) · [ImapFlow](https://github.com/postalsys/imapflow) · [Nodemailer](https://nodemailer.com) · React · Tailwind CSS · Vite

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details. [Dual licensing](LICENSING.md) is available for commercial use.
