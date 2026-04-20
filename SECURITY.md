# Security Policy

Stork's primary security claim is **encryption at rest**: every email, attachment, header, label, and full-text-search index is encrypted on disk with AES-256. This document describes the threat model, the cryptographic design, what Stork does and does not protect against, and how to report vulnerabilities.

## Reporting a Vulnerability

**Email**: [hailey+security@paperkite.sh](mailto:hailey+security@paperkite.sh)

Please include:
- A description of the vulnerability
- Steps to reproduce (a proof-of-concept repo or minimal container setup is ideal)
- Potential impact — especially whether data at rest, credentials, or the container boundary are affected
- A suggested fix, if you have one

**Please do not open public GitHub issues for security vulnerabilities.**

### Response targets

- Acknowledgement within **48 hours**
- Triage assessment within **7 days**
- Fix released within **14 days** for high/critical issues; lower-severity issues are scheduled into a normal release

Coordinated disclosure is welcomed. Reporters who want a CVE or public credit are accommodated; anonymous reporting is also fine.

## Supported Versions

Only the most recent minor release receives security fixes. Stork is pre-1.0 and releases frequently — upgrade promptly.

| Version | Supported |
|---------|-----------|
| 0.7.x   | Yes       |
| < 0.7   | No        |

## Threat Model

Stork is designed for a **self-hosted deployment** on infrastructure the user controls (a home server, a VPS, a Kubernetes node). The adversary model assumes an attacker who can gain offline access to persisted data but cannot execute code inside the container while it is unlocked.

### What Stork protects against

- **Offline disk compromise.** A stolen laptop, backup tape, seized VM image, or leaked cloud-provider snapshot yields only opaque ciphertext. Without the password or recovery mnemonic, an attacker cannot read any message content, subject lines, addresses, labels, attachments, or the full-text-search index.
- **Backup exfiltration.** Cloud or off-site backups of the Docker volume are safe to store on untrusted infrastructure — the data files are encrypted and the `stork.keys` envelope is bound to a password the attacker does not have.
- **Host co-tenant read access.** On a shared host, a neighbouring process with read access to the volume directory sees only ciphertext. (Write access or container escape is out of scope — see below.)
- **Casual inspection.** Sysadmins, bystanders, or anyone with filesystem access to the persisted volume cannot read mail without authenticating.
- **IMAP/SMTP credential theft from disk.** Mail-server credentials are stored inside the encrypted database, not in plaintext config files or environment variables. An offline attacker cannot pivot to your mail provider.

### What Stork does NOT protect against

These are explicit non-goals. Believing Stork defends against these would be a security misunderstanding.

- **A live, unlocked container.** Once unlocked, the vault key lives in process memory and the database is decrypted on demand. Any attacker who gains code execution in the container, reads its RAM, or attaches a debugger can read everything. Treat an unlocked container the same way you would treat an unlocked laptop.
- **The mail provider.** Stork reads mail via IMAP from your existing provider (Gmail, Fastmail, Mailcow, Dovecot, etc.). The provider sees every message as it arrives and every message you send via SMTP. In **Mirror mode** (the default evaluation mode), mail also remains on the provider after Stork syncs it — so historical mail is readable by the provider indefinitely. **Connector mode** deletes server-side copies after sync, but only for mail received after you switched modes; anything already on the provider stays there until you clean it up. Stork's encryption is about protecting mail *after* it reaches your self-hosted storage, not about shielding it from the provider.
- **Mail in transit.** Messages to and from IMAP/SMTP servers are protected by the TLS connection Stork negotiates with those servers, not by Stork itself. Downgrade or MITM attacks between Stork and a misconfigured mail server are the mail server's problem.
- **Credential theft while unlocked.** If the container is unlocked and an attacker has code execution inside it, they can read IMAP/SMTP credentials out of the decrypted database and impersonate you to your mail provider. No client-side encryption defends against this scenario.
- **Active network attackers on the API.** The web UI speaks plain HTTP by default and is expected to be bound to `127.0.0.1` or placed behind a reverse proxy that terminates TLS. Exposing the Stork API directly to the public internet without a reverse proxy is a misconfiguration.
- **Compromised host kernel.** If the Linux kernel, hypervisor, or container runtime is compromised, the vault key can be extracted from the container's address space. This is out of scope for an application-level defence.
- **Weak passwords.** Argon2id raises the cost of offline brute force substantially, but a three-word password is still guessable. Use a long, high-entropy password.
- **Traffic analysis.** An attacker with sustained disk access can observe the total encrypted volume size, its growth rate over time, and the timing of writes. They cannot read content, but they can infer mailbox activity levels.

### Mirror vs Connector mode — security implications

Stork has two operational modes that materially change the exposure profile:

- **Mirror mode** (default during evaluation): Stork copies mail from your provider. Mail remains on the provider. Losing Stork does not lose mail; compromising the provider still exposes all mail. Encryption at rest protects *Stork's* copy but does not change the provider's visibility.
- **Connector mode**: Stork deletes messages from the provider after syncing. Your provider loses long-term visibility of mail received after you switched modes. Losing the `stork.keys` file or forgetting both password and recovery mnemonic means **that mail is gone** — the provider no longer has a copy.

Connector mode raises both the confidentiality posture (less provider exposure) and the recovery risk (no fallback). Most users should run Mirror mode until they trust their Stork backups.

## Cryptographic Details

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| Database encryption | AES-256 in CBC mode with HMAC-SHA-512 (via SQLCipher) | 4096-byte page encryption; SQLCipher v4 defaults; internal PBKDF2 disabled (Stork supplies a raw 256-bit key) |
| Password KDF | Argon2id | 64 MiB memory, 3 iterations, 1 parallelism, 32-byte output, 32-byte random salt |
| Key wrapping (password and recovery envelopes) | AES-256-GCM | 12-byte random IV (fresh per wrap), 16-byte GCM auth tag |
| Recovery key | BIP39 mnemonic | 24 words, 256 bits of entropy; converted to raw 32-byte key via `bip39.mnemonicToEntropy` |
| Random generation | Node.js `crypto.randomBytes` | CSPRNG; backed by `getrandom(2)` on Linux |
| Password-equality check | `crypto.timingSafeEqual` | Constant-time comparison |

### SQLCipher implementation

Stork uses [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) — a better-sqlite3 fork bundling SQLCipher-compatible page-level encryption. The entire SQLite database is encrypted at the page level, including:

- `stork.db` — messages, headers, identities, credentials, labels, and the FTS5 index
- `stork.db-wal` and `stork.db-shm` — SQLite's write-ahead log and shared memory (encrypted transparently by the engine)
- `attachments.db` — attachment blobs, attached as a second encrypted database using the same vault key

SQLCipher's built-in PBKDF2 key derivation is **disabled** — the raw 32-byte vault key is passed via `PRAGMA key = "x'...'"`. This avoids double-KDF (Argon2id → SQLCipher's PBKDF2) and ensures the strong Argon2id derivation is the only stretching step.

### Attachment handling

Attachments are stored as BLOBs inside `attachments.db`, content-addressed by SHA-256 for deduplication, and zlib-compressed before insertion. They are **not encrypted separately** — they inherit whole-database encryption from SQLCipher. There is no per-attachment IV or key because no per-attachment encryption exists; the SQLCipher page cipher handles all row data uniformly. This is intentional: per-column or per-blob encryption would leak structural metadata (row counts, blob lengths, presence/absence patterns) to an offline attacker, which whole-database encryption hides.

### Full-text search

The FTS5 index is stored in the same encrypted SQLite database. It is opaque on disk and operates normally on the in-memory decrypted state once the container is unlocked. Encryption does not break search.

### Envelope format

See [`docs/encryption-design.md`](docs/encryption-design.md) for the full `stork.keys` file layout, the boot/unlock/shutdown state machine, the password-change and recovery-key-rotation protocols, and the rationale for the vault-key pattern.

## Key Handling

### In-memory lifecycle

- The vault key (MDK) exists in a Node.js `Buffer` in process memory only while the container is unlocked.
- The KEK (Argon2id output used to unwrap the MDK) exists transiently during unlock and is zeroed with `crypto.randomFill` before the buffer is released.
- On graceful shutdown (SIGTERM/SIGINT), the SQLCipher database handle is closed, the MDK `Buffer` is overwritten with random bytes, and references are released.
- On a hard crash or `kill -9`, the MDK is not explicitly zeroed — it is freed along with the process, but the underlying pages may not be scrubbed immediately. Container hardening (see below) addresses this.

### Locked vs unlocked states

When Stork starts, it is **locked**:

- All API endpoints return `423 Locked` except `/api/health` and `/api/unlock`.
- The sync scheduler does not start; no IMAP connections are opened.
- The web UI shows only the unlock screen.
- Unlock attempts are rate-limited with progressive backoff (1s, 2s, 4s, ... up to 30s) to slow online password guessing.

After a correct unlock, the MDK is held in memory, SQLCipher opens the database, and the sync scheduler starts. The container transitions back to locked on restart; Stork does not cache the unlocked state across container reboots.

### BIP39 recovery

A 24-word BIP39 mnemonic is generated once at setup and displayed to the user with a prominent warning. It is the only other way to unwrap the vault key if the password is forgotten. Both the password envelope and the recovery envelope wrap the same MDK independently, so rotating the password does not invalidate the recovery mnemonic and vice versa.

Rotation is supported for both credentials:
- **Password change**: O(1) — re-derives KEK with a new salt and re-wraps the MDK. The database is untouched.
- **Recovery-key rotation**: O(1), two-phase (prepare + confirm) for power-failure resilience. The old mnemonic remains valid until confirmation.

See `docs/encryption-design.md` for the full rotation protocol.

### If a credential is compromised

- **Password leak**: rotate the password immediately. The MDK is unchanged; no database re-encryption needed.
- **Recovery mnemonic leak**: rotate the recovery key immediately. If you suspect the attacker also has the `stork.keys` file (meaning they may have already unwrapped the MDK), you should additionally **rekey the database** via SQLCipher's rekey API to generate a fresh MDK. This is O(n) in database size.
- **Container compromise while unlocked**: assume the MDK and all mail are exposed. Rotate mail-server passwords (IMAP/SMTP) with your provider, rebuild the container from a trusted image, and restore from a known-good backup. Rotate the vault password and recovery key afterwards.

## What Is NOT Encrypted

Be explicit about the boundary. The following live on disk **in plaintext** and are not protected by the vault key:

- **Container logs** (`stdout`/`stderr`, captured by the Docker daemon). Stork does its best to avoid logging message content, but routine operational logs — sync progress, connector names, folder names, error messages, HTTP request paths — are plaintext. Treat your Docker log driver's output as unencrypted.
- **File sizes and timestamps** on the encrypted database file. An attacker with disk access can infer total mailbox volume and activity frequency, though not content.
- **Environment variables and `docker-compose.yml`**. Any config passed to the container at startup (e.g. `STORK_DATA_DIR`, `PORT`) is visible to anyone with access to the host.
- **Memory pages while unlocked** (see below for mitigations).
- **Network traffic**. IMAP/SMTP connections inherit whatever TLS the remote server offers; the Stork API is plain HTTP by default and relies on a reverse proxy or `127.0.0.1` binding for confidentiality.
- **Process metadata**: PID, open file descriptors, `/proc/<pid>/maps` — a privileged user on the host sees these.

If any of these vectors matter for your threat model, compensate at the operational layer: restrict log driver access, run on a full-disk-encrypted host, use Docker secrets rather than env vars, put Stork behind an authenticated reverse proxy.

## Container Hardening

The recommended `docker-compose.yml` and `docker run` flags are **not optional** for a deployment that takes encryption at rest seriously:

- `--memory-swappiness=0` / `mem_swappiness: 0` — prevents the vault key from being swapped to disk.
- `--ulimit core=0` / `ulimits: core: 0` — prevents core dumps (which would include the vault key).
- `--security-opt no-new-privileges` — blocks setuid escalation inside the container.
- Bind to `127.0.0.1:3100` by default — do not expose directly to the public internet; use a reverse proxy with TLS and authentication.

If you remove these flags, you are accepting that the vault key may land on disk in a swap file or core dump, which defeats the point of encryption at rest.

## In Scope for Security Reports

- **Cryptographic weaknesses** — flaws in the SQLCipher integration, Argon2id parameters, vault-key wrapping, BIP39 handling, IV/nonce reuse, key zeroing.
- **Authentication bypass** — paths that access decrypted data without a valid password or recovery mnemonic; paths that bypass the locked-mode API gate.
- **Container escape** — vulnerabilities that allow breaking out of the Docker container from within Stork's code.
- **API vulnerabilities** — injection, authentication bypass, SSRF, path traversal, unauthorized access.
- **XSS / CSRF** — script execution via HTML mail that escapes the iframe sandbox or bypasses DOMPurify + CSP; CSRF against state-changing API endpoints.
- **IMAP/SMTP credential handling** — insecure in-memory storage, accidental logging of credentials, TLS validation bypass.
- **Denial of service** — crashes triggered by crafted mail, malformed MIME, or oversized inputs that could lock a user out of their archive.
- **Dependency vulnerabilities** — exploitable issues in pinned dependencies that affect Stork specifically.

## Out of Scope

- Social engineering, physical attacks, or attacks on the user's local machine.
- Issues in unmodified third-party components where the upstream has a newer fix we have not yet picked up — report those upstream (we will pull in fixes on normal release cadence).
- Weaknesses in mail providers, IMAP servers, SMTP servers, or TLS certificates outside Stork's control.
- Weaknesses arising from a user deploying with the hardening flags removed, the API exposed to the public internet without a reverse proxy, or a trivially guessable password.
- Missing HTTP security headers on endpoints bound to `127.0.0.1` — the expected deployment terminates TLS and adds headers at the reverse proxy.
- Reports generated by automated scanners without a demonstrated exploit path.

## Prior Art and References

- SQLCipher: <https://www.zetetic.net/sqlcipher/>
- `better-sqlite3-multiple-ciphers`: <https://github.com/m4heshd/better-sqlite3-multiple-ciphers>
- Argon2 RFC 9106: <https://www.rfc-editor.org/rfc/rfc9106>
- BIP39: <https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki>
- Stork encryption design: [`docs/encryption-design.md`](docs/encryption-design.md)
