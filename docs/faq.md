# FAQ

## Will Stork delete email from my IMAP server?

**No.** The sync engine is strictly read-only by default. It fetches messages and flags from your IMAP server but never modifies or deletes anything on the server. A "delete from server" feature is planned as an opt-in workflow — it will only run when you explicitly enable it per account and confirm the action. Safe for testing against a production mailbox.

## Will full-text search scale to a large mailbox?

Yes. Stork uses SQLite's [FTS5](https://www.sqlite.org/fts5.html) extension, which is designed for exactly this. FTS5 maintains an inverted index that handles millions of rows efficiently — 10+ years of email (hundreds of thousands of messages) is well within its comfort zone. Combined with WAL mode (enabled by default), searches stay fast even while new messages are being synced in the background.
