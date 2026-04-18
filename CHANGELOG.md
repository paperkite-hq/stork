# Changelog

## Unreleased

Performance, UI polish, and security improvements since v0.7.0.

- **KDF parameter fix** — unlock now uses the KDF parameters stored at encryption time, not current defaults. Prevents lockout after a KDF strength upgrade. Clearer error separation between wrong-password and database-corruption failures.
- **Hot/cold attachment storage** — attachment blobs moved to a separate database file (`attachments.db`), keeping the main database lean for faster queries on large mailboxes. IMAP label rename support added.
- **Multi-stage Docker build** — production image no longer ships build tools, devDependencies, or source code. Significantly smaller runtime image.
- **Threaded message view** — messages in the same thread are visually grouped in the message list with indentation and thread indicators.
- **Customisable label icons** — pick from a built-in icon set for each label; icons appear in the sidebar and message list.
- **Hover archive button** — archive messages directly from the message list on hover, with contextual toast ("Archived" for inbox, "Removed from \<label\>" for custom labels) and 7-second undo window.
- **Performance fixes** — three root causes of ~60s page refresh on a 5.2 GB database identified and fixed (cached count queries, optimised label lookups, reduced re-renders).
- **Label sync fix** — user label removals now persist across sync cycles instead of being re-applied from server state.
- **UI polish** — label dropdown checkboxes no longer shrink with long names; sync progress time display no longer causes layout jumps.
- **`.env.example`** — configuration discovery file for Docker deployments.
- **Test coverage** — new tests for cached count paths and label edge cases.

## v0.7.0 (2026-04-06)

Connector polish, storage compression, and onboarding improvements.

- **Connector mode transition wizard** — guided UX flow when switching from Mirror to Connector mode. Offers "Re-label from server" (reconcile label changes from other clients) and "Clean Server" (batch-remove already-synced messages from your provider). The transition from evaluation to commitment is now a first-class product moment, not a checkbox.
- **Clean Server action** — one-click removal of already-synced messages from your mail provider. Queries all locally-synced messages grouped by folder and batch-deletes in groups of 100. Available from the transition wizard and as a standalone action in connector settings.
- **Re-label from server** — on-demand reconciliation pass that detects folder changes made by external IMAP clients since messages were first synced. Fetches current UID lists, compares against locally-stored memberships, and updates labels to match. Detects cross-folder moves via RFC 5322 Message-ID correlation.
- **zlib compression** — `html_body`, `raw_headers`, and attachment blobs are now zlib-compressed in SQLite, reducing database size for large mailboxes.
- **HTML text extraction** — new `html_text_body` column extracts plain text from HTML-only emails for FTS5 indexing, so full-text search works on messages that have no text/plain part.
- **Hash-based attachment deduplication** — identical attachments across messages are stored once, saving disk space in mailboxes with forwarded or repeated attachments.
- **Outbound connector upsell** — composing a message without an outbound connector configured now guides you through creating one, instead of silently failing.
- **Welcome wizard improvements** — connector-agnostic copy, R2 connector option on first run, credential testing during setup, auto-generated display names from email address.
- **Connector mode radio buttons** — replaced the checkbox toggle with clearer radio buttons and a first-time warning explaining the implications.
- **Filter drill-down fix** — label suggestion chips now work progressively: each active filter drives suggestions for the next, with already-active labels excluded. The related-labels endpoint returns labels from the intersection of all active filters.
- **Stable wizard height** — step indicator and connector type tabs no longer cause layout jumps when switching steps.
- **Attachment blob storage** — R2 and webhook ingest paths now enforce attachment data in `RawMessage` and store blobs correctly.
- **Test coverage** — new tests for ConnectorsTab (inbound + outbound), re-label-from-server endpoint, filter drill-down E2E, and pre-migration hooks.

## v0.6.0 (2026-03-31)

Connector-first architecture — connectors and identities replace the old accounts model.

- **Connector-first model** — the "accounts" concept is gone. Inbound connectors (IMAP, Cloudflare Email, Cloudflare R2) bring mail in; outbound connectors (SMTP, SES) send mail out. Identities are pure name + email pairs attached to outbound connectors. This lets you mix connectors freely: e.g., receive via Cloudflare Email, send via AWS SES. Database schema, API endpoints, and UI all reflect the new model.
- **Cloudflare R2 queue connector** — poll-based inbound connector that reads email from a Cloudflare R2 bucket, useful for high-volume or batched ingestion workflows.
- **Cloudflare Email webhook** — `POST /api/webhook/cloudflare-email/:connectorId` receives push-based mail from a Cloudflare Email Worker with bearer auth and Message-ID deduplication.
- **Connector mode** — renamed from "Vault mode." The name better reflects that this is a property of the inbound connector: after syncing, remove messages from the source. The onboarding screen explains the philosophy before you flip the switch.
- **Unified-first navigation** — Inbox, Unread, and All Mail views are cross-identity by default. Identity labels in the sidebar let you drill into a single identity's messages.
- **Unified label store** — labels are global across all identities, so you can apply labels like "Needs reply" consistently across a multi-identity setup.
- **Guided setup wizard** — step-by-step flow for adding your first email, replacing the old form-heavy settings page.
- **Onboarding philosophy callout** — "Two minutes to understand how Stork thinks about email" intro on the add-email screen, updated with Connector mode language.
- **Dual-license clause moved** — commercial licensing terms moved from README to dedicated LICENSING.md. README license section is now clean open source.
- **Security fixes** — upgraded nodemailer to v8.0.4 (SMTP injection), patched happy-dom and picomatch (high-severity frontend vulns).
- **Error batching** — repeated sync errors are now summarized after 3 consecutive identical messages instead of logging each one individually.

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
