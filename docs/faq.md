# FAQ

## Will Stork delete email from my mail source?

**Not by default.** The sync engine is read-only unless you opt in. Out of the box, Stork fetches messages and flags but never modifies anything on your mail source — safe to use against a production mailbox.

If you want to use Stork as your permanent email archive, enable **Connector mode** in Settings > Inbound for the inbound connector. With this enabled, Stork automatically removes messages from the mail source after it has successfully synced them locally. Your provider becomes a transient delivery edge — mail arrives there, Stork picks it up and stores it encrypted locally, then clears it from the source. This setting is per-connector and off by default.

Stork uses a pluggable [connector architecture](./writing-connectors.md): today the primary ingest connector is IMAP, but future connectors (e.g. a Cloudflare Email Worker that temporarily buffers messages) follow the same model — Stork pulls from the source and, in connector mode, clears it afterward.

## What happens if Stork crashes mid-sync in connector mode?

Connector mode is crash-safe. When Stork fetches a new message, it immediately marks it `pending_archive` in the database before moving on. Phase 3 (the crash-recovery deletion step) queries this column rather than relying on an in-memory list.

If the process is killed after fetching messages (Phase 1) but before deleting them from the server (Phase 3), the pending flag persists in the database. On the next sync cycle, Stork finds the flagged messages and completes the deletion — no messages are left stranded on the server indefinitely.

The flag is cleared to zero once `deleted_from_server` is confirmed.

## What is mirror mode vs connector mode?

Stork has two sync philosophies, selectable per-connector in Settings > Inbound:

**Mirror mode (default):** Stork reads alongside your existing email provider. Both your provider and Stork hold copies of your messages. Your provider stays authoritative — use this while you're evaluating Stork, so you can still fall back to your provider's interface. Heads up: actions you take in Stork (deleting, labeling, archiving) are local only and do not sync back to your provider. Changes on your provider don't flow into Stork either.

**Connector mode:** When you're ready to commit, enable connector mode. After each sync batch, Stork removes messages from the mail source — your provider becomes a transient delivery edge, a connector that feeds mail into Stork. Mail arrives, Stork picks it up, encrypts it on your hardware, and clears it from the source. Stork becomes your permanent, encrypted email home. Make sure your Stork database is backed up before enabling this. Deletions are interleaved with fetching — every 100 messages synced, those 100 are cleared from the server, so a large initial sync gradually clears the source rather than doing one big sweep at the end.

## What is an IMAP UID?

A UID (Unique Identifier) is a stable number that an IMAP server assigns to each message in a mailbox. Unlike sequence numbers (which shift when messages are deleted), UIDs never change or get reused within a mailbox — IMAP servers guarantee this monotonically increasing property. Stork uses UIDs to track sync position: it remembers the highest UID it has seen and, on the next sync, only fetches messages with higher UIDs. This makes incremental sync efficient and correct even after messages are deleted from the server.

## Why IMAP and app passwords instead of Gmail OAuth?

Gmail (and most large providers) offer OAuth 2 as a "modern" alternative to IMAP + app passwords, and it's a reasonable question why Stork doesn't use it. The short answer: OAuth trades some security theater for a pile of operational friction that doesn't fit a self-hosted, offline-capable client.

**Verification friction.** Google's OAuth flow requires the client app to be registered and — for access to mail data — put through Google's app-verification review process. Every self-hoster would need to either register their own Google Cloud project and plug their `client_id` into Stork, or Stork would need to ship a shared `client_id` that's visible in every copy of an OSS codebase (which Google explicitly doesn't support for unverified production apps). Neither story preserves the "one `docker run` and you're done" promise.

**Provider-agnostic by design.** Stork is designed to work identically with any IMAP-capable mail source — Fastmail, Mailcow, Dovecot, Proton Bridge, your ISP's webmail. Building around OAuth would mean each provider with an OAuth flow gets a first-class path and everyone else is a second-class citizen. IMAP + password puts every provider on equal footing, which is exactly what a self-hosted archive tool wants.

**App passwords are actually narrower-scoped.** A Gmail app password grants IMAP/SMTP/POP mail access *only* — it cannot read Calendar, Drive, Contacts, or your account settings. The OAuth mail scopes (`https://mail.google.com/`) grant the same mail-level access but require the broader OAuth plumbing. From a blast-radius perspective, the app password is a narrower credential that you can revoke per-device at any time.

The step-by-step for Gmail specifically (enable 2SV, generate an app password, plug into Stork) lives in the [Gmail provider guide](./providers/gmail.md).

## Will my data survive an upgrade?

**Yes.** Schema migrations run automatically when the container starts — no manual steps needed. Pull the new image, restart, and your encrypted database carries forward. See the [Upgrading guide](./upgrading.md) for backup recommendations and details on how migrations work.

## Will full-text search scale to a large mailbox?

Yes. Stork uses SQLite's [FTS5](https://www.sqlite.org/fts5.html) extension, which is designed for exactly this. FTS5 maintains an inverted index that handles millions of rows efficiently — 10+ years of email (hundreds of thousands of messages) is well within its comfort zone. Combined with WAL mode (enabled by default), searches stay fast even while new messages are being synced in the background.
