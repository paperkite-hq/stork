# Encryption at Rest — Technical Design

## Motivation

Stork stores email data locally in a SQLite database inside your self-hosted Docker container. Encryption at rest protects against an attacker who gains access to the container's persistent volume — for example through a stolen disk, compromised host storage, or a cloud provider breach. Without encryption, every historical email in your mailbox is readable in plaintext by anyone with file-system access.

With encryption at rest, an attacker holding your disk gets only opaque encrypted bytes. Gaining access to your historical email would require either running arbitrary code inside the live container or reading its memory — both substantially harder than offline file access.

**Threat model**: Protect persisted data against offline access. This does NOT protect data in transit to/from IMAP/SMTP servers (that is protected by TLS between your container and those servers) or data in memory while the container is running and unlocked. Importantly, encryption at rest does NOT protect you from a service provider snooping on email that is actively passing through their servers — we deliberately accept that trade-off, but sleep better knowing an attacker can only observe currently incoming and outgoing email, not retroactively read your full stored history.

## Architecture Overview

The database is encrypted with a random **Vault Key** (also called the Master Data Key, MDK). The vault key is never exposed directly — it is stored on disk wrapped by one of two unlock envelopes, either of which can recover it:

```
      Password                    Recovery Mnemonic (BIP39)
          │                                  │
          ▼                                  ▼
┌──────────────────────┐        ┌─────────────────────────┐
│   Argon2id KDF       │        │   BIP39 → 32-byte key   │
│   password + salt    │        │   (256 bits of entropy) │
│   → Key Enc. Key     │        │                         │
└────────┬─────────────┘        └─────────────┬───────────┘
         │ password envelope                   │ recovery envelope
         └─────────────────────┬───────────────┘
                               │
                               ▼
              ┌────────────────────────────────────┐
              │   Unwrap Vault Key (MDK)            │
              │   AES-256-GCM decrypt               │
              │   (whichever envelope matches)      │
              └────────────────┬───────────────────┘
                               │
                               ▼
              ┌────────────────────────────────────┐
              │   Vault Key passed to SQLCipher     │
              │   Entire database decrypted         │
              └────────────────────────────────────┘
```

### Key Hierarchy: Vault Key + Unlock Envelopes

The design separates the actual data encryption key (the vault key) from the credentials used to unlock it. This is the standard pattern used by password managers (Bitwarden, 1Password), LUKS, and iOS Data Protection.

**Vault Key (MDK)**: A random 256-bit AES key generated once during initial setup. This is the only key that ever touches data. It lives in memory while the container is unlocked and on disk only in wrapped (encrypted) form.

**Key Encryption Key (KEK)**: Derived from the user's password using Argon2id. Wraps the vault key as the "password envelope." The KEK exists only in memory during unlock and is never persisted.

**Recovery Key**: A high-entropy BIP39 mnemonic generated at setup. Independently wraps the same vault key as the "recovery envelope."

**Why this design?** Because the vault key is what wraps all data, and the envelopes only wrap the vault key (a small fixed-size blob), any credential change — password change or recovery key rotation — is O(1) regardless of database size. The database itself is untouched. This is sometimes called the "vault key pattern" and is the industry standard for systems that need both password changes and recovery without full re-encryption.

## Encryption Scope

The entire SQLite database is encrypted — not individual columns. This includes `stork.db`, `stork.db-shm`, and `stork.db-wal`. Per-column encryption is intentionally avoided: encrypting only data columns leaves structural metadata (row counts, column lengths, relationship patterns) readable on disk, which enables structural analysis attacks and leaks information about mailbox shape and volume.

Whole-database encryption substantially reduces this attack surface: a locked container's data directory is opaque bytes. An attacker with disk access can still observe the total size and growth rate of the encrypted file, but cannot read any message content, headers, metadata, or structural information about your mailbox.

### Implementation approach

Stork uses **SQLCipher** — a widely-deployed SQLite extension that encrypts the entire database at the page level using AES-256. Stork uses `better-sqlite3` compiled against SQLCipher as a drop-in replacement for standard SQLite. This is transparent to the application: all SQL queries work normally, FTS5 full-text search works normally, and WAL files (`stork.db-shm`, `stork.db-wal`) are encrypted automatically alongside the main database file.

SQLCipher was chosen over the alternative (an encrypted filesystem layer such as gocryptfs) because it requires no OS-level FUSE dependencies, is battle-tested across large-scale production deployments (Signal, WhatsApp, and others), and handles all three SQLite files transparently with no container configuration changes.

### Full-text search

Full-text search (FTS5) is fully supported under whole-database encryption. SQLCipher encrypts the entire database file including FTS virtual tables — the FTS5 index is encrypted at rest and operates normally on the in-memory decrypted state. There is no trade-off between encryption and search.

## Cryptographic Primitives

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| Key derivation | Argon2id | 64 MiB memory, 3 iterations, 1 parallelism, 32-byte output |
| Database encryption | AES-256 (via SQLCipher) | 4096-byte page encryption, PBKDF2 key derivation disabled (we supply raw key) |
| Key wrapping | AES-256-GCM | 12-byte random IV, 16-byte auth tag (wraps MDK with KEK) |
| Random generation | Node.js `crypto.randomBytes` | CSPRNG for MDK, salts, IVs — backed by OS `getrandom(2)` on Linux |

## Key Storage

A key file is stored alongside the database at `{STORK_DATA_DIR}/stork.keys`:

```json
{
  "version": 1,
  "kdf": {
    "algorithm": "argon2id",
    "salt": "<base64 32-byte random salt>",
    "memoryCost": 65536,
    "timeCost": 3,
    "parallelism": 1
  },
  "wrappedMasterKey": {
    "password": {
      "iv": "<base64 12-byte IV>",
      "ciphertext": "<base64 encrypted MDK>",
      "tag": "<base64 16-byte auth tag>"
    },
    "recovery": {
      "iv": "<base64 12-byte IV>",
      "ciphertext": "<base64 encrypted MDK>",
      "tag": "<base64 16-byte auth tag>"
    }
  }
}
```

This file is essential — if lost, data is unrecoverable. The Docker volume must be backed up as a unit (database files + key file together).

## Container Lifecycle

### Boot sequence (new installation)

1. Container starts, detects no `stork.keys` file
2. API serves only `/api/health` and the setup UI
3. User visits web UI, sees "Set up encryption password" screen
4. User enters password (with strength meter and confirmation field)
5. Backend generates random MDK and recovery key, derives KEK from password, wraps MDK twice (with KEK and recovery key), writes `stork.keys`
6. Web UI displays the 24-word BIP39 recovery mnemonic with a prominent warning — user must acknowledge before continuing
7. Container transitions to "unlocked" state, normal operation begins

### Boot sequence (existing installation)

1. Container starts, detects `stork.keys` file
2. API enters **locked mode**: all endpoints return `423 Locked` except `/api/health` and `/api/unlock`
3. Sync scheduler does NOT start
4. Web UI shows unlock screen: password input + prominent warning
5. User enters password → `POST /api/unlock` → backend derives KEK, attempts to unwrap MDK
6. If password correct: MDK passed to SQLCipher as the database key, API transitions to unlocked mode, sync scheduler starts
7. If password wrong: 423 response with error, progressive rate limiting (1s, 2s, 4s... up to 30s delay)

### Locked mode behavior

While locked, the container is intentionally inert:

- No IMAP connections (can't open encrypted database to read account credentials)
- No API responses except health check and unlock
- Web UI shows only the unlock screen
- No background jobs or sync activity

### Graceful shutdown

On SIGTERM/SIGINT:

1. Stop sync scheduler
2. Close SQLCipher database connection (key evicted from SQLite's memory)
3. Zero out in-memory MDK (`crypto.randomFill` overwrite, not just `delete`)
4. Exit

## Password Change

1. User enters current password + new password via settings UI
2. Backend derives old KEK, verifies it unwraps MDK successfully
3. Backend derives new KEK (new random salt), re-wraps MDK
4. Writes updated `stork.keys` atomically (write to temp file, then rename)
5. Old KEK and new KEK zeroed from memory

The database itself is untouched — SQLCipher's database key (the MDK) is unchanged. Only the wrapping of the MDK changes. This is O(1) regardless of database size.

## Recovery Key

Stork generates a recovery key during initial setup. The recovery key is a second independent wrapping of the MDK — it is unrelated to the user's password and allows the MDK to be unwrapped if the password is forgotten.

### Format

The recovery key is displayed as a **24-word BIP39 mnemonic** (256 bits of entropy), the same human-readable format used by hardware wallets. For example:

```
witch collapse practice feed shame open
despair creek road again ice least
```

The user writes this down and stores it somewhere safe (offline, physically secure). The web UI shows it once on setup with a prominent warning and requires acknowledgement before proceeding.

### Lifecycle

- **Generated once at setup.** The recovery wrapping is stored in `stork.keys` as a second `wrappedMasterKey` entry keyed by `"recovery"`.
- **Password changes do not require a new recovery key.** Changing the password re-wraps the MDK with a new KEK but does not change the MDK itself — the recovery wrapping remains valid.
- **Routine recovery key rotation is O(1) and two-phase.** The user can rotate their recovery key at any time — for example, after writing it down somewhere that was later visible to others, or simply as a periodic security hygiene step. Rotation only re-wraps the MDK with a freshly generated recovery key; the MDK and the database are untouched. This is as fast as a password change regardless of database size. Rotation uses a two-phase protocol for power-failure resilience: Phase 1 (prepare) generates the new recovery envelope and stores it as `pendingRecovery` alongside the existing `recovery` envelope — both the old and new mnemonics work during this window. Phase 2 (confirm) promotes the pending envelope and deletes the old one — only the new mnemonic works after confirmation. If the user loses power or closes their browser before confirming, the old mnemonic still works and the pending rotation can be cancelled or retried.
- **If the recovery key is compromised** (an attacker possesses both the `stork.keys` file and the mnemonic, meaning they may have already unwrapped the MDK), the user should rotate the recovery key immediately and then also rotate the MDK itself using SQLCipher's rekey API — which re-encrypts the entire database with a new MDK. This MDK rotation is O(n) proportional to database size. Treat the recovery key as equivalent to the password in terms of sensitivity.

### Recovery (forgotten password) flow

1. User navigates to the unlock screen and selects "Forgot password / Use recovery key"
2. User enters the 24-word mnemonic
3. Backend validates the mnemonic, derives the recovery key bytes, attempts to unwrap MDK
4. If successful: MDK loaded, user sets a new password (which re-wraps MDK with new KEK), recovery key remains valid

### Recovery key rotation flow (two-phase)

**Phase 1 — Prepare:**

1. User navigates to Settings → Security → Rotate Recovery Key
2. User enters current password to authorize (backend unwraps MDK as verification)
3. Backend generates a new 24-word BIP39 mnemonic
4. Backend wraps the MDK with the new recovery key bytes (fresh random IV)
5. Writes the new envelope as `pendingRecovery` in `stork.keys` — the existing `recovery` envelope is preserved
6. Web UI displays new mnemonic with a prominent note that the old phrase still works

**Phase 2 — Confirm:**

7. User checks acknowledgement that they've written down the new phrase
8. UI sends confirmation request (re-authenticates with password)
9. Backend promotes `pendingRecovery` to `recovery` and deletes the old envelope
10. Old mnemonic is now invalid

**Cancellation:** At any point before step 8, the user (or the UI on page load) can cancel the pending rotation, which removes the `pendingRecovery` envelope and leaves the original recovery key intact.

**Power-failure resilience:** If power is lost between Phase 1 and Phase 2, `stork.keys` contains both envelopes. On next boot, `unlockWithRecovery` tries both — so the old mnemonic still works. The UI detects the pending state on mount and offers the user the choice to cancel or re-display the new phrase.

The `stork.keys` file format (see [Key Storage](#key-storage)) stores password-wrapped and recovery-wrapped MDK under separate keys in `wrappedMasterKey`, with an optional `pendingRecovery` key during rotation. All entries encrypt the same MDK, using independent random IVs.

## Security Considerations

- **Argon2id parameters**: The parameters (64 MiB memory, 3 iterations) are non-negotiable. Stork requires a minimum of **512 MiB RAM** in the container — reducing Argon2id parameters to accommodate under-resourced containers is not supported. Under-resourcing the container is a misconfiguration, not a use case.
- **SQLCipher key supply**: SQLCipher's built-in PBKDF2 key derivation is disabled (`PRAGMA key` receives the raw MDK). This prevents key-stretching from being done twice and gives us full control over the KDF (Argon2id is superior to SQLCipher's default PBKDF2).
- **Side-channel resistance**: Argon2id is designed to resist timing attacks. Password comparison uses `crypto.timingSafeEqual`.
- **Memory zeroing**: Node.js (like all JS runtimes) does not guarantee that the GC zeroes memory before reclaiming it. Stork explicitly overwrites sensitive Buffers (MDK, KEK) using `crypto.randomFill` before releasing references — this is the best available mitigation under Node.js's memory model and overwrites the bytes before the GC can move the object.
- **Swap/core dumps**: The MDK exists in memory while the container is unlocked and could be swapped to disk or appear in core dumps. The provided `docker-compose.yml` sets `mem_swappiness: 0` and `ulimits: core: 0` to mitigate this. These settings are not optional — do not remove them in production deployments.
