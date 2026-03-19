# Contributing to Stork

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/paperkite-hq/stork.git
cd stork

# Install dependencies (requires Bun 1.2+)
bun install
cd frontend && bun install && cd ..

# Run in development mode (backend + frontend)
bun run dev

# In a separate terminal, run the frontend dev server
cd frontend && bun run dev
```

Open `http://localhost:5173` for the frontend dev server (hot reload), or `http://localhost:3100` for the built version.

## Running Tests

```bash
# All tests (backend + frontend)
bun test

# Backend only
bun run test:backend

# Frontend only
bun run test:frontend

# E2E container test (requires Docker)
bun run test:e2e
```

## Code Style

- TypeScript throughout (backend and frontend)
- Formatting and linting via [Biome](https://biomejs.dev/)
- Run `bun run lint` before submitting a PR
- Run `bun run format` to auto-fix formatting

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests if you're adding new functionality
4. Run `bun test` and `bun run lint` to verify
5. Open a pull request with a clear description of what you changed and why

## Project Structure

```
src/
  api/server.ts          — REST API (Hono)
  connectors/types.ts    — Connector interface definitions
  search/search.ts       — Full-text search (FTS5)
  storage/               — SQLite schema, migrations, queries
  sync/                  — IMAP sync engine, connection pool, scheduler
  index.ts               — Entry point

frontend/src/
  components/            — React components (inbox, compose, search, etc.)
  api.ts                 — API client
  App.tsx                — Main app shell
  hooks.ts               — Custom React hooks

tests/                   — Backend tests (unit + integration)
frontend/src/components/__tests__/  — Frontend component tests
```

## Reporting Issues

Found a bug or have a feature request? Open an issue on GitHub. Please include:
- What you expected to happen
- What actually happened
- Steps to reproduce (if applicable)
- Your environment (OS, Bun version, Docker version)
