# Changelog

## Unreleased

- **Accounts → Identities rename** — the "accounts" concept is now "identities" throughout. API endpoints moved from `/api/accounts` to `/api/identities`, `account_id` fields renamed to `identity_id`. Identities are pure name + email pairs that reference connectors. Trusted senders are now global (not per-identity). Label source type `"account"` renamed to `"identity"`.
- **Cloudflare Email webhook endpoint** — `POST /api/webhook/cloudflare-email/:connectorId` receives push-based mail from a Cloudflare Email Worker, validates the bearer secret, parses the RFC 5322 payload, and stores it in the INBOX for all identities linked to the connector. Deduplication by Message-ID prevents double-delivery from Cloudflare's at-least-once semantics.
- **Unified-first navigation** — the sidebar identity selector dropdown is removed. In multi-identity mode, the primary "Inbox", "Unread", and "All Mail" navigation items are now cross-identity by default (unified views). Identity labels in the sidebar let you drill into a single identity's messages. Single-identity mode is unchanged.
- **Unified label store** — labels are now global across all identities rather than per-identity, so you can apply labels like "Needs reply" consistently across a multi-identity setup. Schema migration merges any duplicate label names automatically on upgrade.
- **Connector-first identity model** — identities are pure name + email pairs that reference independently-configured inbound and outbound connectors. IMAP settings and SMTP settings live in the Connectors tab, not in the identity form. This lets you mix connectors freely: e.g., receive via Cloudflare Email, send via AWS SES.
- **Connector mode rename** — "Vault mode" is now "Connector mode" throughout the UI and docs. The name better reflects that this is a property of the inbound connector, not the identity.
- **All Unread + All Mail** — the sidebar now includes All Unread and All Mail views in addition to All Inboxes, all spanning every connected identity.
- **Onboarding philosophy callout** — restored the "Two minutes to understand how Stork thinks about email" intro on the add-email screen, updated with Connector mode language.

## v0.5.0 (2026-03-26)

Multi-account unified inbox.

- **Unified inbox** — when two or more accounts are configured, an "All Accounts" section appears at the top of the sidebar with an "All Inboxes" view showing messages from all accounts' inboxes combined, sorted by date. Each message in the unified view shows the account email it belongs to. Unread count badge aggregates across all accounts.

## v0.4.0 (2026-03-25)

Vault mode — the core sync philosophy made real.

- **Mirror mode & Vault mode** — two sync modes reflecting where you are in your journey. Mirror mode (default) keeps your provider as a backup while you evaluate; Vault mode makes Stork your permanent encrypted home and treats your provider as just the delivery pipe. An onboarding callout explains the choice before you connect your first account; the sidebar shows an ambient reminder while any account is still in mirror mode.
- **Interleaved fetch + delete** — in vault mode, Stork deletes from the server every 100 messages during the initial sync instead of one big sweep at the end. A large mailbox starts clearing gradually from the first batch.
- **Crash-safe vault mode** — pending deletions are tracked in the database so an interrupted sync picks up where it left off on restart, with no messages left stranded.
- **Desktop notifications** — browser notifications on new mail arrival (respects browser permission).
- **Per-account default view** — configure each account to open on Inbox, Unread, or All Mail.
- **Inline search results** — search results appear directly in the message list panel; prev/next navigation cycles through matches; search terms are highlighted in the message detail pane.
- **Trusted senders panel** — manage per-sender remote image permissions from the Settings UI.
- **Performance** — cached unread and all-message counts eliminate full-table scans on large mailboxes; additional SQLite pragmas for databases over 1 GB.
- **Pluggable connectors** — IMAP, SMTP, Cloudflare Email Workers, and AWS SES connectors all wired in via a common `IngestConnector`/`SendConnector` interface; vault mode generalizes cleanly to any connector that implements `deleteMessages()`.
- Bug fixes: UID FETCH for folders with very large UIDs, batch server deletions for large vault-mode mailboxes, restored security hardening flags in all documentation docker-compose snippets.

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
