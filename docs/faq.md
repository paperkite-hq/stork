# FAQ

## Will Stork delete email from my IMAP server?

**Not by default.** The sync engine is read-only unless you opt in. Out of the box, Stork fetches messages and flags but never modifies anything on your IMAP server — safe to use against a production mailbox.

If you want to use Stork as your permanent email archive, enable **Archive mode** in Settings > Accounts for that account. With this enabled, Stork automatically removes messages from the IMAP server after it has successfully synced them locally. Your IMAP provider becomes a transient delivery edge — mail arrives there, Stork picks it up and stores it encrypted locally, then clears it from the server. This setting is per-account and off by default.

## What happens to archive mode if Stork crashes mid-sync?

Archive mode is crash-safe. When Stork fetches a new message, it immediately marks it `pending_archive` in the database before moving on. Phase 3 (the IMAP deletion step) queries this column rather than relying on an in-memory list.

If the process is killed after fetching messages (Phase 1) but before deleting them from the server (Phase 3), the pending flag persists in the database. On the next sync cycle, Stork finds the flagged messages and completes the deletion — no messages are left stranded on the server indefinitely.

The flag is cleared to zero once `deleted_from_server` is confirmed.

## Will full-text search scale to a large mailbox?

Yes. Stork uses SQLite's [FTS5](https://www.sqlite.org/fts5.html) extension, which is designed for exactly this. FTS5 maintains an inverted index that handles millions of rows efficiently — 10+ years of email (hundreds of thousands of messages) is well within its comfort zone. Combined with WAL mode (enabled by default), searches stay fast even while new messages are being synced in the background.
