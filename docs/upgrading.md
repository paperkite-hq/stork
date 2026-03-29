# Upgrading

## Will my data survive an upgrade?

**Yes.** Stork uses automatic schema migrations — when the container starts, it checks the current database schema version and applies any pending migrations before accepting connections. No manual steps required.

This means upgrading is as simple as pulling the new image and restarting:

```bash
docker compose pull
docker compose up -d
```

Your encrypted database, identities, labels, and all synced email carry forward automatically.

## How migrations work

Stork tracks a `schema_version` number in the database. On startup, it compares this against the version built into the release. If the database is behind, each intermediate migration runs sequentially — the same deterministic path every time, whether you're upgrading from v1 to v15 or from v14 to v15.

Migrations are embedded in the application binary (not external SQL files), so there's nothing to download or run separately.

## Backup recommendations

While migrations are designed to be safe, **back up your database before major version upgrades** — especially when jumping multiple versions.

### Where the database lives

| Setup | Path |
|-------|------|
| Default Docker Compose (named volume) | Docker volume `stork-data` → `/app/data/` inside the container |
| Bind mount | Whatever host path you mapped to `/app/data` (e.g., `./my-data` or `~/stork-data`) |
| `docker run` example from README | `~/stork-data/` on the host |

The database consists of three files:

| File | Purpose |
|------|---------|
| `stork.db` | Main encrypted SQLite database |
| `stork.db-wal` | Write-Ahead Log (buffered writes) |
| `stork.db-shm` | WAL shared memory |

All three are encrypted by SQLCipher. Back up all three together.

### Backup steps

**Stop the container first** to ensure a consistent snapshot (no in-flight writes):

```bash
# Stop the container
docker compose stop

# Named volume: copy files out
docker run --rm -v stork-data:/data -v $(pwd):/backup alpine \
  cp -a /data/. /backup/stork-backup-$(date +%Y%m%d)/

# Bind mount: just copy the directory
cp -a ~/stork-data ~/stork-backup-$(date +%Y%m%d)

# Restart
docker compose up -d
```

### Restoring from backup

To restore, stop the container, replace the data files with your backup, and start again:

```bash
docker compose stop

# Named volume
docker run --rm -v stork-data:/data -v $(pwd)/stork-backup-20260328:/backup alpine \
  sh -c 'rm -rf /data/* && cp -a /backup/. /data/'

# Bind mount
rm -rf ~/stork-data/* && cp -a ~/stork-backup-20260328/. ~/stork-data/

docker compose up -d
```

## Downgrading

Schema migrations are forward-only — Stork does not support downgrading to a previous schema version. If an upgrade causes issues, restore from your pre-upgrade backup.

## Troubleshooting

**Container won't start after upgrade**: Check logs with `docker compose logs stork`. Migration errors will appear at startup. If you see a migration failure, restore your backup and [open an issue](https://github.com/paperkite-hq/stork/issues).

**Database locked error**: Ensure only one Stork container is running against the same data directory. Stop any old containers before starting the new version.
