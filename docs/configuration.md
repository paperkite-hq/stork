# Configuration Reference

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORK_DATA_DIR` | `./data` | Directory where the SQLite database and attachment data are stored |
| `STORK_PORT` | `3100` | Port the HTTP server listens on |
| `STORK_DEMO_MODE` | _(unset)_ | Set to `1` to run in read-only demo mode with sample data |

## Docker Compose

The default `docker-compose.yml` pulls the pre-built image from GitHub Container Registry:

```yaml
services:
  stork:
    image: ghcr.io/paperkite-hq/stork:latest
    init: true
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - stork-data:/app/data
    environment:
      - STORK_PORT=3100
    restart: unless-stopped
    mem_swappiness: 0
    ulimits:
      core: 0
    security_opt:
      - no-new-privileges:true

volumes:
  stork-data:
```

To build from source instead, replace the `image:` line with `build: .`.

### Using a bind mount instead of a volume

To store data at a specific path on the host:

```yaml
services:
  stork:
    build: .
    init: true
    ports:
      - "3100:3100"
    volumes:
      - ./my-data:/app/data
    environment:
      - STORK_PORT=3100
    restart: unless-stopped
    mem_swappiness: 0
    ulimits:
      core: 0
    security_opt:
      - no-new-privileges:true
```

### Changing the port

```yaml
    ports:
      - "8080:8080"
    environment:
      - STORK_PORT=8080
```

### Binding to localhost only

For security, bind to `127.0.0.1` so Stork is not accessible from the network:

```yaml
    ports:
      - "127.0.0.1:3100:3100"
```

## Demo Mode

Set `STORK_DEMO_MODE=1` to run Stork as a read-only demo with pre-seeded sample data. In demo mode:

- The container starts pre-unlocked with 15 sample emails, 7 labels, and 1 demo account
- All write operations (create, update, delete) return `403 Forbidden`
- No IMAP sync runs (no real mail server connection)
- The database is unencrypted (no setup/unlock flow)
- A banner displays at the top of the UI

A separate compose file is provided:

```bash
docker compose -f docker-compose.demo.yml up -d
```

This is useful for hosting a public demo so potential users can explore the interface without installing anything.

## Health Check

The Docker image includes a built-in `HEALTHCHECK` that polls `GET /api/health` every 30 seconds. Docker marks the container as `healthy` once the endpoint returns 200.

Additional endpoints for monitoring:

| Endpoint | Auth | Response |
|----------|------|----------|
| `GET /api/health` | None | `{"status":"ok","version":"0.1.0"}` |
| `GET /api/status` | None | `{"state":"setup\|locked\|unlocked"}` |

## Database

Stork uses SQLite via `better-sqlite3-multiple-ciphers` for encrypted local storage. The following PRAGMA settings are applied at startup:

| PRAGMA | Value | Purpose |
|--------|-------|---------|
| `key` | (vault key) | AES-256 encryption key derived from user password — applied before any other operations |
| `journal_mode` | WAL | Allows concurrent reads during writes (sync + API reads) |
| `foreign_keys` | ON | Enforces cascading deletes (delete account → delete folders → delete messages) |
| `busy_timeout` | 5000 | Waits up to 5 seconds for a lock before returning SQLITE_BUSY |

### Encryption

All database files (`stork.db`, `stork.db-shm`, `stork.db-wal`) are encrypted at the page level by SQLCipher. The encryption key (vault key) is loaded into memory only after the user unlocks the container, and is zeroed from memory immediately after being passed to SQLCipher.

Key derivation uses Argon2id with 64 MiB memory cost, 3 iterations, and 1 parallelism lane. The container requires a minimum of 512 MiB RAM.

### Schema Migrations

Migrations run automatically on startup. The current schema version is tracked in the `schema_version` table. To run migrations manually:

```bash
npm run db:migrate
```

## Sync Settings

Sync behavior is configured per-account via the API or Settings UI.

| Setting | Default | Description |
|---------|---------|-------------|
| Sync interval | 5 minutes | How often Stork checks for new mail |
| Connector mode | Off | Auto-delete messages from the IMAP server after syncing them locally (treats IMAP as a transient delivery edge; Stork becomes your permanent encrypted email home) |

### Connection Pool

Internal connection pool settings (not currently user-configurable):

| Setting | Default | Description |
|---------|---------|-------------|
| Max connections per account | 1 | Concurrent IMAP connections per account |
| Max total connections | 10 | Total IMAP connections across all accounts |
| Idle timeout | 5 minutes | How long an unused connection stays open |

### Error Backoff

When sync fails repeatedly, the retry interval increases:

| Consecutive failures | Retry interval |
|---------------------|----------------|
| 1 | 5 minutes (normal) |
| 2 | 10 minutes |
| 3 | 20 minutes |
| 4+ | 30 minutes (max) |

Once a sync succeeds, the interval resets to normal.
