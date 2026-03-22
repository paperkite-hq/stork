[![CI](https://github.com/paperkite-hq/stork/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/paperkite-hq/stork/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/paperkite-hq/stork/badges/coverage.json)](https://github.com/paperkite-hq/stork/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

# Stork

**Self-hosted email client with encrypted local storage, IMAP sync, and full-text search.**

> Self-host the client, not the edge.

Stork syncs your email from any IMAP server, stores it locally with **AES-256 encryption at rest**, full-text search, and a modern web interface. Keep using your existing mail server for sending and receiving — Stork handles storage, search, and the UI. Your data is encrypted on disk: without your password, the data directory is opaque bytes.

## Why Stork?

Running your own mail server is hard. Getting deliverability right, maintaining uptime, managing DNS records — it's a lot of work. But handing your data to Gmail isn't great either.

Stork takes a different approach: **let your mail server handle the hard parts** (receiving mail, sending mail, maintaining reputation) while you **self-host everything else** (storage, search, the interface you actually use every day).

- **Encryption at rest** — AES-256 whole-database encryption via SQLCipher. Container boots locked; your password unlocks it. No password = no data.
- **Sync from any IMAP server** — Mailcow, Dovecot, Fastmail, whatever you've got
- **Local SQLite storage** — your mail lives on your hardware, not in the cloud
- **Full-text search** — actually find that email from 3 years ago, instantly. FTS5 search works normally under encryption.
- **Recovery key** — 24-word BIP39 mnemonic backup so a forgotten password doesn't mean lost mail
- **Labels, not folders** — Gmail-style labels replace rigid folder hierarchies
- **Modern web UI** — something you'd actually want to use daily
- **Docker deployment** — `docker compose up` and you're running
- **Delete from server** _(planned)_ — opt-in workflow to remove synced messages from the IMAP server after local storage
- **Pluggable connectors** _(planned)_ — swap in Cloudflare Email Workers, SES, or other services

## Labels Over Folders

Stork is **deliberately opinionated** about email organization: it uses **labels** instead of folders.

Most email clients mirror the IMAP folder tree — rigid, single-parent hierarchies where a message can only live in one place. This made sense when browsing folders was the primary way to find email. It doesn't anymore. If your email client has good search, you rarely navigate by folder.

Stork takes the Gmail approach: when email syncs from an IMAP folder, the folder name becomes a **suggested label** automatically applied to incoming messages. But labels aren't folders — a message can have multiple labels, labels are easy to create and manage, and your organizational system isn't locked to what your IMAP server happens to expose.

**How it works:**
- IMAP folders are still synced for tracking sync state (UIDs, UIDVALIDITY)
- Each folder name automatically becomes a label (source: `imap`)
- New messages get the label matching their IMAP folder
- You can add, remove, and create your own labels freely
- The sidebar shows labels with unread counts, not a folder tree
- Search works across all labels — no more hunting through folders

This is a deliberate design choice: **search is the primary navigation, labels are the primary organization**. If you want traditional folder-based browsing, Stork isn't the right fit — and that's okay.

## Quick Start

### Docker Compose (recommended)

Create a `docker-compose.yml` (or download from the repo):

```yaml
services:
  stork:
    image: ghcr.io/paperkite-hq/stork:latest
    init: true
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - stork-data:/app/data
    restart: unless-stopped

volumes:
  stork-data:
```

```bash
docker compose up -d
```

### Docker Run

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

This:
- Pulls the pre-built image — no clone or build needed
- Binds to **localhost only** (`127.0.0.1`) — not exposed to your network
- Stores the encrypted database in `~/stork-data` (change to any path you like) — regular files that work with your existing backup tooling
- The security flags disable swap, core dumps, and privilege escalation

### Build from Source

If you prefer to build locally:

```bash
git clone https://github.com/paperkite-hq/stork.git
cd stork
docker compose up --build
```

Open `http://localhost:3100` — the setup wizard will guide you through creating a password and connecting your email account. See the [Getting Started guide](docs/getting-started.md) for a full walkthrough.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Web UI                      │
│            (React + Tailwind)                │
├─────────────────────────────────────────────┤
│                REST API                      │
│              (Hono/Node.js)                  │
├──────────┬──────────┬───────────────────────┤
│  IMAP    │  SQLite  │  Full-Text            │
│  Sync    │  Storage │  Search (FTS5)        │
├──────────┴──────────┴───────────────────────┤
│           Connector Layer                    │
│   IMAP  │  SMTP  │  CF Workers  │  SES     │
└─────────────────────────────────────────────┘
```

## Status

🚧 **Early development** — functional but still evolving. Core features work: IMAP sync, local storage with full-text search, web UI, and Docker deployment. See the [roadmap](#roadmap) for what's done and what's next.

## Roadmap

- [x] IMAP sync engine (incremental, resumable)
- [x] SQLite storage with FTS5 full-text search
- [x] SMTP sending via configured server
- [x] Web UI — inbox, threads, compose, search
- [x] Docker single-container deployment
- [x] Label-based organization (Gmail-style, replaces folder navigation)
- [x] Encryption at rest (AES-256 via SQLCipher, locked boot, BIP39 recovery key)
- [ ] Pluggable connector architecture
- [ ] Delete-from-server workflow
- [ ] Multi-account support

## Documentation

- **[Getting Started](docs/getting-started.md)** — first launch, encryption setup, adding an account, search, labels
- **[User Guide](docs/user-guide.md)** — installation, account setup, search tips, backups, reverse proxy
- **[Configuration](docs/configuration.md)** — environment variables, Docker options, database settings
- **[API Reference](docs/api.md)** — full REST API documentation with examples
- **[Architecture](docs/architecture.md)** — system design, codebase walkthrough, design principles
- **[Contributing](CONTRIBUTING.md)** — development setup, running tests, code style

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## Tech Stack

- **Runtime**: [Node.js](https://nodejs.org) 22+
- **Backend**: [Hono](https://hono.dev) (lightweight web framework)
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [SQLCipher](https://www.zetetic.net/sqlcipher/) (AES-256 encryption at rest)
- **Search**: SQLite FTS5
- **IMAP**: [ImapFlow](https://github.com/postalsys/imapflow)
- **SMTP**: [Nodemailer](https://nodemailer.com)
- **Frontend**: React + Tailwind CSS + Vite

## How Stork Compares

| | Stork | Roundcube | Cypht | Thunderbird |
|---|---|---|---|---|
| **Deployment** | Docker (single container) | PHP + web server + DB | PHP | Desktop app |
| **Encryption at rest** | ✅ AES-256 SQLCipher | ❌ | ❌ | ❌ |
| **Local storage** | ✅ SQLite on your host | ✅ MySQL/PostgreSQL | ❌ (stateless) | ✅ local files |
| **Full-text search** | ✅ FTS5 (fast, indexed) | ⚠️ basic | ⚠️ basic | ✅ |
| **Web UI** | ✅ | ✅ | ✅ | ❌ |
| **Label-based org** | ✅ | ❌ (folders only) | ❌ (folders only) | ⚠️ partial |
| **Compose/send** | ✅ | ✅ | ✅ | ✅ |
| **Recovery key** | ✅ BIP39 mnemonic | ❌ | ❌ | ❌ |
| **Self-contained** | ✅ (no PHP, no extra DB) | ❌ | ❌ | ✅ |

**Roundcube** is the most mature option and has the deepest plugin ecosystem. If you need plugins, calendar integration, or multi-user shared hosting, Roundcube is the better fit. Stork's advantages are its single-container deployment, encryption at rest, and modern React UI.

**Cypht** is stateless and modular — good if you want a lightweight webmail that aggregates multiple accounts without local storage. Stork keeps a local encrypted copy of your mail, enabling offline-capable search and a faster interface.

**Thunderbird** is the gold standard for desktop email. If you're happy with a native desktop app, Thunderbird is excellent. Stork is for people who want web-based access to their mail from any device, without sending their data to a cloud provider.

## FAQ

### Will Stork delete email from my IMAP server?

**No.** The sync engine is strictly read-only by default. It fetches messages and flags from your IMAP server but never modifies or deletes anything on the server. A "delete from server" feature is planned as an opt-in workflow — it will only run when you explicitly enable it per account and confirm the action. Safe for testing against a production mailbox.

### Will full-text search scale to a large mailbox?

Yes. Stork uses SQLite's [FTS5](https://www.sqlite.org/fts5.html) extension, which is designed for exactly this. FTS5 maintains an inverted index that handles millions of rows efficiently — 10+ years of email (hundreds of thousands of messages) is well within its comfort zone. Combined with WAL mode (enabled by default), searches stay fast even while new messages are being synced in the background.

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.

Paperkite Technologies LLC retains the right to offer Stork under alternative license terms (e.g., a commercial license for hosted deployments).
