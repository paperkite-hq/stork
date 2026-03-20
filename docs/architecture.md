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
  connectors/types.ts        Connector interfaces (IngestConnector, SendConnector)
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
- **Delete-from-server** — opt-in workflow to remove messages from the IMAP server after they've been synced locally. Marks deleted messages in the database.
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

### Connector Interfaces (`src/connectors/types.ts`)

Stork defines two connector interfaces for pluggable mail transport:

- **`IngestConnector`** — abstracts how mail enters the system. Methods: `connect()`, `disconnect()`, `listFolders()`, `fetchMessages()`, and optional `deleteMessages()`. The IMAP sync engine implements this pattern (though not yet refactored to the interface).
- **`SendConnector`** — abstracts how mail leaves. Methods: `send()` and `verify()`. Currently backed by Nodemailer/SMTP.

Future connectors (Cloudflare Email Workers, SES, etc.) will implement these interfaces.

### SQLite Storage (`src/storage/`)

**Database initialization** (`db.ts`):
- Opens SQLite via `@signalapp/better-sqlite3` (SQLCipher fork) at `$STORK_DATA_DIR/stork.db`.
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

## Design Principles

1. **Self-host the client, not the edge.** Don't compete with mail servers — complement them. Let Postfix/Dovecot/Fastmail handle MX records, DKIM, and deliverability. Stork handles storage, search, and the UI.

2. **SQLite is the right database.** A single-user email client doesn't need PostgreSQL. SQLite with WAL mode handles concurrent reads during sync, FTS5 provides search without Elasticsearch, and the entire database is a single file you can backup with `cp`.

3. **Incremental, resumable sync.** Never re-download messages you already have. Use IMAP UIDs and UIDVALIDITY to track sync position. Handle server-side folder recreation gracefully.

4. **Read-only by default.** The sync engine never modifies the IMAP server unless the user explicitly opts in to delete-from-server. Safe to point at a production mailbox.

5. **One container, zero config.** `docker compose up` should give you a working email client. No external databases, no Redis, no environment variables required for basic operation.
