# FAQ

## Will Stork delete email from my IMAP server?

**Not by default.** The sync engine is read-only unless you opt in. Out of the box, Stork fetches messages and flags but never modifies anything on your IMAP server — safe to use against a production mailbox.

If you want deletions to sync both ways, enable **Sync deletions** in Settings > Accounts for that account. With this enabled, deleting a message in Stork also deletes it from your IMAP server, and messages deleted on the server are removed locally on the next sync. This setting is per-account and off by default.

## Will full-text search scale to a large mailbox?

Yes. Stork uses SQLite's [FTS5](https://www.sqlite.org/fts5.html) extension, which is designed for exactly this. FTS5 maintains an inverted index that handles millions of rows efficiently — 10+ years of email (hundreds of thousands of messages) is well within its comfort zone. Combined with WAL mode (enabled by default), searches stay fast even while new messages are being synced in the background.
