# API Reference

Stork exposes a REST API at `/api/`. All responses are JSON.

## Container Lifecycle

Stork boots into an encrypted, locked state. Before any data routes are accessible, the container must be set up (first run) or unlocked (subsequent runs). All data endpoints return `423 Locked` until the container is unlocked.

### Get container status

```
GET /api/status
```

Returns the current container state: `setup` (no encryption configured), `locked` (encrypted, awaiting password), or `unlocked` (ready for use).

**Response**: `200 OK`
```json
{ "state": "locked" }
```

### Initial setup

```
POST /api/setup
Content-Type: application/json
```

First-run endpoint. Creates the encryption keys and unlocks the container. Only accessible when the container is in the `setup` state.

**Request body**:
```json
{ "password": "your-secure-password" }
```

Password must be at least 12 characters.

**Response**: `201 Created`
```json
{ "recoveryMnemonic": "abandon ability able about above absent absorb abstract absurd abuse access accident..." }
```

The response includes a 24-word BIP39 recovery mnemonic. **Store this securely — it is the only way to recover your data if you forget your password.** It is shown once and cannot be retrieved again.

**Response**: `409 Conflict` (if already initialized)

### Unlock

```
POST /api/unlock
Content-Type: application/json
```

Unlocks the container with a password or recovery mnemonic. Only accessible in the `locked` state. Failed attempts trigger progressive rate limiting (exponential backoff).

**With password**:
```json
{ "password": "your-secure-password" }
```

**With recovery mnemonic** (resets password):
```json
{
  "recoveryMnemonic": "abandon ability able ...",
  "newPassword": "your-new-password"
}
```

When using the recovery mnemonic, a `newPassword` is required — the old password is replaced.

**Response**: `200 OK`
```json
{ "ok": true }
```

**Response**: `401 Unauthorized` (invalid credentials) | `409 Conflict` (not initialized)

### Change password

```
POST /api/change-password
Content-Type: application/json
```

Changes the encryption password. Requires the container to be unlocked. This is an O(1) operation — the vault key is re-wrapped with the new password; the database is not re-encrypted.

**Request body**:
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

New password must be at least 12 characters.

**Response**: `200 OK` | `401 Unauthorized` (wrong current password)

### Rotate recovery key

```
POST /api/rotate-recovery-key
Content-Type: application/json
```

Generates a new recovery mnemonic, invalidating the old one. Requires the container to be unlocked. This is an O(1) operation — only the recovery envelope is re-wrapped.

**Request body**:
```json
{ "password": "your-current-password" }
```

**Response**: `200 OK`
```json
{ "recoveryMnemonic": "new mnemonic words..." }
```

**Response**: `401 Unauthorized` (wrong password)

## Health

### Health check

```
GET /api/health
```

Always accessible regardless of container state. Use for Docker health checks and load balancer probes.

**Response**: `200 OK`
```json
{ "status": "ok", "version": "0.1.0" }
```

## Accounts

### List accounts

```
GET /api/accounts
```

Returns all configured email accounts (passwords excluded).

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Work",
    "email": "user@example.com",
    "imap_host": "imap.example.com",
    "smtp_host": "smtp.example.com",
    "created_at": "2026-01-15T10:30:00.000Z"
  }
]
```

### Create account

```
POST /api/accounts
Content-Type: application/json
```

**Required fields**: `name`, `email`, `imap_host`, `imap_user`, `imap_pass`

**Optional fields**: `imap_port` (default: 993), `imap_tls` (default: 1), `smtp_host`, `smtp_port` (default: 587), `smtp_tls` (default: 1), `smtp_user`, `smtp_pass`, `sync_delete_from_server` (default: 0)

**Request body**:
```json
{
  "name": "Work",
  "email": "user@example.com",
  "imap_host": "imap.example.com",
  "imap_user": "user@example.com",
  "imap_pass": "app-password-here",
  "smtp_host": "smtp.example.com",
  "smtp_user": "user@example.com",
  "smtp_pass": "app-password-here"
}
```

**Response**: `201 Created`
```json
{ "id": 1 }
```

The new account is automatically registered with the sync scheduler and begins syncing immediately.

### Get account

```
GET /api/accounts/:accountId
```

Returns a single account with all fields except passwords.

**Response**: `200 OK` | `404 Not Found`

### Update account

```
PUT /api/accounts/:accountId
Content-Type: application/json
```

Partial update — only include fields you want to change.

**Request body**:
```json
{
  "name": "Personal",
  "smtp_host": "smtp.newserver.com"
}
```

**Response**: `200 OK` | `400 Bad Request` (no fields provided)

### Delete account

```
DELETE /api/accounts/:accountId
```

Deletes the account and all associated folders, messages, and attachments (cascading delete).

**Response**: `200 OK` | `404 Not Found`

## Folders

### List folders

```
GET /api/accounts/:accountId/folders
```

Returns all synced folders for an account.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "path": "INBOX",
    "name": "Inbox",
    "special_use": "\\Inbox",
    "message_count": 1523,
    "unread_count": 12,
    "last_synced_at": "2026-01-15T10:35:00.000Z"
  }
]
```

The `special_use` field indicates the folder type per RFC 6154: `\Inbox`, `\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`, `\All`, `\Flagged`, or `null` for custom folders.

## Labels

Stork uses labels (not folders) as the primary organizational model. IMAP folders are still synced, but messages are organized and browsed by label. When email syncs from an IMAP folder, the folder name automatically becomes a label.

### List labels

```
GET /api/accounts/:accountId/labels
```

Returns all labels for an account with message and unread counts.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Inbox",
    "color": null,
    "source": "imap",
    "created_at": "2026-01-15T10:30:00.000Z",
    "message_count": 1523,
    "unread_count": 12
  },
  {
    "id": 5,
    "name": "Important",
    "color": "#ff0000",
    "source": "user",
    "created_at": "2026-01-16T08:00:00.000Z",
    "message_count": 45,
    "unread_count": 3
  }
]
```

The `source` field indicates how the label was created: `imap` for labels auto-created from IMAP folder names, `user` for manually created labels.

### Create label

```
POST /api/accounts/:accountId/labels
Content-Type: application/json
```

**Required fields**: `name`

**Optional fields**: `color` (hex color string), `source` (default: `user`)

**Request body**:
```json
{
  "name": "Important",
  "color": "#ff0000"
}
```

**Response**: `201 Created`
```json
{ "id": 5 }
```

**Response**: `409 Conflict` (if label name already exists for this account)

### Update label

```
PUT /api/labels/:labelId
Content-Type: application/json
```

Partial update — only include fields you want to change.

**Request body**:
```json
{
  "name": "Very Important",
  "color": "#ff6600"
}
```

**Response**: `200 OK` | `400 Bad Request` (no fields) | `404 Not Found`

### Delete label

```
DELETE /api/labels/:labelId
```

Deletes the label and removes it from all messages (the messages themselves are not deleted).

**Response**: `200 OK` | `404 Not Found`

### List messages by label

```
GET /api/labels/:labelId/messages?limit=50&offset=0
```

Returns messages with this label, sorted by date (newest first). This is the primary way to browse messages in Stork.

**Query parameters**:
- `limit` (default: 50)
- `offset` (default: 0)

**Response**: `200 OK` — same format as folder message listing.

### Get labels for a message

```
GET /api/messages/:messageId/labels
```

Returns all labels applied to a message.

**Response**: `200 OK`
```json
[
  { "id": 1, "name": "Inbox", "color": null, "source": "imap" },
  { "id": 5, "name": "Important", "color": "#ff0000", "source": "user" }
]
```

### Add labels to a message

```
POST /api/messages/:messageId/labels
Content-Type: application/json
```

**Request body**:
```json
{ "label_ids": [1, 5] }
```

Idempotent — adding an already-applied label is a no-op.

**Response**: `200 OK` | `400 Bad Request` | `404 Not Found`

### Remove a label from a message

```
DELETE /api/messages/:messageId/labels/:labelId
```

**Response**: `200 OK`

## Messages

### List messages in a folder

```
GET /api/accounts/:accountId/folders/:folderId/messages?limit=50&offset=0
```

Returns messages sorted by date (newest first). Each message includes a 200-character body preview.

**Query parameters**:
- `limit` (default: 50) — number of messages to return
- `offset` (default: 0) — pagination offset

**Response**: `200 OK`
```json
[
  {
    "id": 42,
    "uid": 1501,
    "message_id": "<abc123@example.com>",
    "subject": "Weekly report",
    "from_address": "boss@example.com",
    "from_name": "Jane Smith",
    "to_addresses": "[\"user@example.com\"]",
    "date": "2026-01-15T09:00:00.000Z",
    "flags": "[\"\\\\Seen\"]",
    "size": 4096,
    "has_attachments": 0,
    "preview": "Hi team, here are this week's numbers..."
  }
]
```

### Get a single message

```
GET /api/messages/:messageId
```

Returns the full message including HTML/text body, headers, and folder info.

**Response**: `200 OK` | `404 Not Found`

### Get message thread

```
GET /api/messages/:messageId/thread
```

Returns all messages in the same thread, determined by `Message-ID`, `In-Reply-To`, and `References` headers. Messages are sorted by date (oldest first).

**Response**: `200 OK`
```json
[
  { "id": 40, "subject": "Re: Weekly report", "date": "2026-01-14T..." },
  { "id": 41, "subject": "Re: Weekly report", "date": "2026-01-15T..." },
  { "id": 42, "subject": "Re: Weekly report", "date": "2026-01-15T..." }
]
```

### Update message flags

```
PATCH /api/messages/:messageId/flags
Content-Type: application/json
```

Add or remove flags (e.g., mark read/unread, star/unstar).

**Request body**:
```json
{
  "add": ["\\Seen"],
  "remove": ["\\Flagged"]
}
```

**Response**: `200 OK`
```json
{ "ok": true, "flags": "\\Seen" }
```

### Move a message

```
POST /api/messages/:messageId/move
Content-Type: application/json
```

Moves a message to a different folder.

**Request body**:
```json
{ "folder_id": 5 }
```

**Response**: `200 OK` | `400 Bad Request` | `404 Not Found`

### Delete a message

```
DELETE /api/messages/:messageId
```

Permanently deletes a message from local storage. Does not affect the IMAP server.

**Response**: `200 OK` | `404 Not Found`

## Attachments

### List attachments

```
GET /api/messages/:messageId/attachments
```

Returns metadata for all attachments on a message.

**Response**: `200 OK`
```json
[
  {
    "id": 7,
    "filename": "report.pdf",
    "content_type": "application/pdf",
    "size": 102400,
    "content_id": null
  }
]
```

### Download attachment

```
GET /api/attachments/:attachmentId
```

Returns the raw attachment data with appropriate `Content-Type` and `Content-Disposition` headers.

## Search

### Search messages

```
GET /api/search?q=quarterly+report&account_id=1&limit=20&offset=0
```

Full-text search across all synced messages using SQLite FTS5.

**Query parameters**:
- `q` (required) — search query. Supports FTS5 syntax:
  - `quarterly report` — matches messages containing both words
  - `"quarterly report"` — phrase match (exact sequence)
  - `quarterly OR annual` — matches either word
  - `quarterly NOT draft` — excludes messages containing "draft"
- `account_id` (optional) — filter results to a specific account
- `limit` (default: 50) — number of results to return
- `offset` (default: 0) — pagination offset

**Response**: `200 OK`
```json
[
  {
    "id": 42,
    "subject": "Q4 Quarterly Report",
    "from_address": "boss@example.com",
    "from_name": "Jane Smith",
    "date": "2026-01-15T09:00:00.000Z",
    "snippet": "...the <mark>quarterly</mark> <mark>report</mark> shows a 15% increase...",
    "folder_path": "INBOX",
    "rank": -2.5
  }
]
```

Snippets include `<mark>` tags around matching terms for highlighting.

## Sync

### Trigger sync

```
POST /api/accounts/:accountId/sync
```

Triggers an immediate sync for the specified account. Returns the sync result.

**Response**: `200 OK`
```json
{
  "folders": [
    {
      "folder": "INBOX",
      "newMessages": 3,
      "updatedFlags": 12,
      "deletedFolders": 0,
      "attachmentsSaved": 1,
      "errors": []
    }
  ],
  "totalNew": 3,
  "totalErrors": 0
}
```

**Response**: `500 Internal Server Error` (if sync fails)

### Get sync status

```
GET /api/sync/status
```

Returns the sync status for all accounts.

**Response**: `200 OK`
```json
{
  "1": {
    "running": false,
    "lastSync": 1737000900000,
    "lastError": null,
    "consecutiveErrors": 0
  }
}
```

### Get folder sync status

```
GET /api/accounts/:accountId/sync-status
```

Returns per-folder sync details including last synced UID.
