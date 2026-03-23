# Changelog

## v0.3.0 (2026-03-23)

First stable release. Promotes v0.3.0-alpha with additional bug fixes:

- **Read-only demo mode** — `STORK_DEMO_MODE=1` with pre-seeded data for hosted demos
- **Rich text compose** — HTML/plain toggle with expand mode
- **Browser navigation** — back/forward support, search result prev/next navigation
- **Sender whitelist** — persistent per-sender remote image loading
- **Auto-recovery UI** — reconnects automatically when container restarts or goes offline
- **Entropy-based password strength** — real-time strength meter during setup
- **Security policy** — vulnerability reporting process documented
- **Fly.io deployment** — ready-to-use config for hosted demo
- **Cloudflare Email Workers + AWS SES** — additional connector implementations
- Numerous bug fixes: CSP image loading, draft preservation on send failure, dark mode email rendering, responsive settings modal, favicon redesign

## v0.3.0-alpha (2026-03-22)

- **Pluggable connectors** — IMAP and SMTP are now modular connectors behind a common interface, preparing for future transports (Cloudflare Email Workers, SES)
- **Recovery key rotation** — two-phase rotation with power-failure resilience; rotate your BIP39 mnemonic without risk of data loss
- **Podman compatibility** — fully-qualified base images work with both Docker and Podman
- **Comparison table** — README now compares Stork against Roundcube, Bichon, and Mailu
- **Use-case docs** — three complete use-case guides (encrypted Gmail backup, Mailcow webmail, VPN-based private access)
- **Issue templates** — bug report and feature request templates for contributors
- **Improved test coverage** — IMAP connector and sync errors API now tested; branch coverage back above 80%

## v0.2.0-alpha (2026-03-21)

- **Encryption at rest** — AES-256 whole-database encryption via SQLCipher; container boots locked, password unlocks
- **Recovery key** — 24-word BIP39 mnemonic backup for password recovery
- **HTML email sandboxing** — defense-in-depth with sandboxed iframe, DOMPurify, CSP headers
- **Sync error tracking** — persistent error classification with automatic resolution on successful sync
- **Docker HEALTHCHECK** — `/api/health` endpoint with container health monitoring
- **GHCR publishing** — pre-built images on `ghcr.io/paperkite-hq/stork`
- **Labels** — Gmail-style label organization replacing rigid folder hierarchies
- **Archive workflow** — archive removes Inbox label, message stays in All Mail
- **Getting Started guide** — first-run walkthrough with encryption setup, account configuration, search, labels
- **Screenshots** — inbox, thread, and compose views in README

## v0.1.0-alpha (2026-03-19)

First tagged release. Core functionality is working:

- **IMAP sync** — incremental sync from any IMAP server with proper MIME parsing and attachment extraction
- **SQLite storage** — local storage with FTS5 full-text search
- **SMTP sending** — compose, reply, and reply-all via configured SMTP server
- **Web UI** — inbox view, message threads, compose modal, search panel, keyboard shortcuts, dark mode, mobile responsive
- **Sync scheduling** — connection pooling and automatic refresh for multi-account setups
- **Docker deployment** — single-container with Docker Compose or direct `docker run`
- **First-run experience** — welcome screen guides new users through IMAP configuration
