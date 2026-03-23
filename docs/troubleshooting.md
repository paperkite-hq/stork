# Troubleshooting

## Error codes

Stork log lines include error codes (e.g. `[STORK-E001]`) to help diagnose issues.

### STORK-E001: Could not lock mailbox

**What it means:** Stork tried to acquire an exclusive lock on a mailbox folder but the IMAP server refused or the connection dropped.

**Common causes:**
- The IMAP connection was interrupted (network issue, DNS resolution failure, server timeout)
- Another client holds an exclusive lock on the folder
- The IMAP server is temporarily overloaded

**What to do:** This is transient — stork will retry on the next sync cycle. If it persists, check your network connection and IMAP server status.

### STORK-E002: Fetch failed

**What it means:** Stork could not fetch new messages from a folder.

**Common causes:**
- Network interruption during a large fetch operation
- IMAP server returned an error for the requested message range
- Connection timeout on a slow or large mailbox

**What to do:** Stork will retry on the next sync cycle. The folder's sync progress is saved, so it will resume from where it left off.

### STORK-E003: Flag sync failed

**What it means:** Stork could not update read/unread/starred status for a batch of messages.

**Common causes:**
- Network interruption during flag synchronization
- IMAP server rejected the flag fetch command
- Connection dropped mid-batch

**What to do:** This is transient — flags will be re-synced on the next cycle.

### STORK-E004: Failed to process message

**What it means:** Stork fetched a message from the server but could not parse or store it locally. This error is marked **permanent** — stork will not retry the same message.

**Common causes:**
- Malformed email with missing or invalid headers (e.g. unparseable date)
- Email contains data types that cannot be stored in the local database
- Corrupt MIME structure that the parser cannot handle

**What to do:** This usually affects only a small number of unusual emails. The message UID is included in the error so you can inspect it with another mail client. If many messages fail, please open an issue.
