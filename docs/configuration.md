# Configuration Reference

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORK_DATA_DIR` | `./data` | Directory where the SQLite database and attachment data are stored |
| `STORK_PORT` | `3100` | Port the HTTP server listens on |

## Docker Compose

The default `docker-compose.yml`:

```yaml
services:
  stork:
    build: .
    init: true
    ports:
      - "3100:3100"
    volumes:
      - stork-data:/app/data
    environment:
      - STORK_PORT=3100
    restart: unless-stopped

volumes:
  stork-data:
```

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

## Database

Stork uses SQLite with the following PRAGMA settings applied at startup:

| PRAGMA | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | WAL | Allows concurrent reads during writes (sync + API reads) |
| `foreign_keys` | ON | Enforces cascading deletes (delete account → delete folders → delete messages) |
| `busy_timeout` | 5000 | Waits up to 5 seconds for a lock before returning SQLITE_BUSY |

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
| Delete from server | Off | Whether to remove messages from the IMAP server after syncing |

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
