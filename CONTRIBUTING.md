# Contributing to Stork

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/paperkite-hq/stork.git
cd stork

# Install dependencies (requires Node.js 22+)
npm install
cd frontend && npm install && cd ..

# Run in development mode (backend + frontend)
npm run dev

# In a separate terminal, run the frontend dev server
cd frontend && npm run dev
```

Open `http://localhost:5173` for the frontend dev server (hot reload), or `http://localhost:3100` for the built version.

## Environment Variables

Stork is configured entirely through environment variables — no `.env` file is required.

| Variable | Default | Description |
|----------|---------|-------------|
| `STORK_DATA_DIR` | `./data` | Directory where the SQLite database and attachments are stored |
| `STORK_PORT` | `3100` | Port the HTTP server listens on |
| `STORK_DEMO_MODE` | _(unset)_ | Set to `1` to run in read-only demo mode with pre-seeded sample data |
| `STORK_FAST_KDF` | _(unset)_ | Set to `1` to use fast key derivation parameters (for tests only — **never in production**) |

### Demo Mode

Demo mode is useful for working on the frontend without connecting to a real mail server:

```bash
STORK_DEMO_MODE=1 npm run dev
```

This starts Stork pre-unlocked with 15 sample emails, 7 labels, and 1 demo identity. All write operations return `403 Forbidden` and no IMAP sync runs. See [`docs/configuration.md`](docs/configuration.md) for full details.

### Fast KDF for Tests

Stork uses Argon2id for key derivation, which is intentionally slow (64 MiB memory, 3 iterations). For development and testing, set `STORK_FAST_KDF=1` to use fast parameters — this makes tests ~3x faster:

```bash
STORK_FAST_KDF=1 npm run test:backend
```

The coverage script sets this automatically: `npm run test:coverage`.

## Running Tests

```bash
# All tests (backend + frontend)
npm test

# Backend only
npm run test:backend

# Frontend only
npm run test:frontend

# E2E container test (requires Docker)
npm run test:e2e

# E2E UI tests (Playwright)
npm run test:e2e-ui

# Coverage report (80% threshold enforced)
npm run test:coverage
```

### Test Architecture

Stork has four test tiers:

1. **Unit tests** (`src/**/*.test.ts`) — test individual functions and modules using in-memory SQLite databases
2. **Integration tests** (`tests/**/*.test.ts`) — test API endpoints and sync logic with mock IMAP/SMTP servers
3. **E2E UI tests** (`tests/e2e/`) — Playwright tests that drive the full browser UI against a seeded test server
4. **Container tests** (`tests/e2e-container.test.ts`) — verify the Docker image builds and runs correctly

### Test Helpers & Fixtures

Tests use factory functions from `src/test-helpers/test-db.ts` to create in-memory databases with seed data:

```typescript
import {
  createTestDb,
  createTestInboundConnector,
  createTestIdentity,
  createTestFolder,
  createTestLabel,
  createTestMessage,
  createTestContext,
  addMessageLabel,
} from "../src/test-helpers/test-db.js";

// Create a fresh in-memory database with all migrations applied
const db = createTestDb();

// Seed data using factory functions
const connectorId = createTestInboundConnector(db, { name: "My Connector" });
const identityId = createTestIdentity(db, { email: "dev@example.com" });
const folderId = createTestFolder(db, connectorId, "INBOX", { specialUse: "\\Inbox" });
const labelId = createTestLabel(db, "Work");
const messageId = createTestMessage(db, connectorId, folderId, 1, {
  subject: "Hello",
  textBody: "Test body",
});
addMessageLabel(db, messageId, labelId);

// For API-level tests, create a pre-unlocked context
const context = createTestContext(db);
```

Each factory function accepts an `overrides` object so you only specify the fields you care about — sensible defaults fill in the rest.

### Mock Servers

For tests that need IMAP or SMTP interaction, use the mock servers:

- `src/test-helpers/mock-imap-server.ts` — simulates an IMAP server for sync tests
- `src/test-helpers/mock-smtp-server.ts` — simulates an SMTP server for send tests

### E2E Seed Data

The E2E UI tests run against a pre-seeded test server (`tests/e2e/start-test-server.ts`) that creates ~20 messages with varied content: unread messages, starred messages, threaded conversations, attachments, and user-defined labels. This server starts automatically via Playwright's `webServer` config.

## Frontend Development

The frontend is a separate React app in `frontend/` with its own `package.json`:

```bash
cd frontend
npm install    # separate install required
npm run dev    # Vite dev server on :5173 — proxies API calls to :3100
npm test       # frontend unit tests (Vitest + happy-dom)
```

The frontend dev server hot-reloads on changes. The backend must be running separately (`npm run dev` in the project root) for API calls to work.

Frontend tests live in `frontend/src/__tests__/` and test React hooks, utilities, and the API client.

## Code Style

- TypeScript throughout (backend and frontend)
- Formatting and linting via [Biome](https://biomejs.dev/)
- Run `npm run lint` before submitting a PR
- Run `npm run format` to auto-fix formatting

## Database Migrations

Migrations run automatically on startup. To run them manually:

```bash
npm run db:migrate
```

When adding a new migration, create a SQL file in `src/storage/migrations/` and add it to the migration runner. The current schema version is tracked in the `schema_version` table.

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests if you're adding new functionality
4. Run `npm test` and `npm run lint` to verify
5. Open a pull request with a clear description of what you changed and why

## Project Structure

```
src/
  api/server.ts          — REST API (Hono)
  connectors/            — Pluggable connector architecture (IMAP, Cloudflare R2)
  crypto/                — Encryption, key derivation, container lifecycle
  demo/                  — Demo mode seed data
  search/search.ts       — Full-text search (FTS5)
  storage/               — SQLite schema, migrations, queries
  sync/                  — IMAP sync engine, connection pool, scheduler
  test-helpers/          — Factory functions, mock IMAP/SMTP servers
  index.ts               — Entry point

frontend/src/
  components/            — React components (inbox, compose, search, etc.)
  __tests__/             — Component and hook tests
  api.ts                 — API client
  App.tsx                — Main app shell
  hooks.ts               — Custom React hooks

tests/                   — Backend integration tests
tests/e2e/               — Playwright E2E tests and test server
docs/                    — Architecture, configuration, troubleshooting
```

## Reporting Issues

Found a bug or have a feature request? Open an issue on GitHub. Please include:
- What you expected to happen
- What actually happened
- Steps to reproduce (if applicable)
- Your environment (OS, Node.js version, Docker version)
