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

### Rotate recovery key (two-phase)

Recovery key rotation uses a two-phase protocol for power-failure resilience. The old mnemonic continues to work until the rotation is explicitly confirmed.

#### Phase 1 — Prepare

```
POST /api/rotate-recovery-key
Content-Type: application/json
```

Generates a new recovery mnemonic and stores it as a pending rotation. Both old and new mnemonics will work until confirmed. Requires the container to be unlocked. O(1) operation.

**Request body**:
```json
{ "password": "your-current-password" }
```

**Response**: `200 OK`
```json
{ "recoveryMnemonic": "new mnemonic words...", "pending": true }
```

**Response**: `401 Unauthorized` (wrong password)

#### Phase 2 — Confirm

```
POST /api/confirm-recovery-rotation
Content-Type: application/json
```

Promotes the pending recovery key and invalidates the old mnemonic.

**Request body**:
```json
{ "password": "your-current-password" }
```

**Response**: `200 OK` — `{ "ok": true }`
**Response**: `409 Conflict` — no pending rotation exists
**Response**: `401 Unauthorized` (wrong password)

#### Cancel pending rotation

```
POST /api/cancel-recovery-rotation
Content-Type: application/json
```

Removes the pending recovery key. The old mnemonic remains valid.

**Response**: `200 OK` — `{ "ok": true }`

#### Check rotation status

```
GET /api/recovery-rotation-status
```

**Response**: `200 OK`
```json
{ "pending": true }
```

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

## Identities

An identity represents an email address you send and receive as (name + email). Identities reference inbound and outbound connectors for mail transport.

### List identities

```
GET /api/identities
```

Returns all configured email identities.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Work",
    "email": "user@example.com",
    "inbound_connector_id": 1,
    "outbound_connector_id": 2,
    "created_at": "2026-01-15T10:30:00.000Z"
  }
]
```

### Create identity

```
POST /api/identities
Content-Type: application/json
```

**Required fields**: `name`, `email`, `outbound_connector_id`

**Optional fields**: `default_view`

**Request body**:
```json
{
  "name": "Work",
  "email": "user@example.com",
  "inbound_connector_id": 1,
  "outbound_connector_id": 2
}
```

**Response**: `201 Created`
```json
{ "id": 1 }
```

The new identity is automatically registered with the sync scheduler and begins syncing immediately (if an inbound connector is assigned).

### Get identity

```
GET /api/identities/:identityId
```

Returns a single identity with connector names.

**Response**: `200 OK` | `404 Not Found`

### Update identity

```
PUT /api/identities/:identityId
Content-Type: application/json
```

Partial update — only include fields you want to change.

**Request body**:
```json
{
  "name": "Personal"
}
```

**Response**: `200 OK` | `400 Bad Request` (no fields provided)

### Delete identity

```
DELETE /api/identities/:identityId
```

Deletes the identity and all associated folders, messages, and attachments (cascading delete).

**Response**: `200 OK` | `404 Not Found`

## Folders

### List folders

```
GET /api/identities/:identityId/folders
```

Returns all synced folders for an identity.

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
GET /api/labels
```

Returns all labels with message and unread counts.

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

The `source` field indicates how the label was created:

| Source | Created by | Example | Editable | Shown in drill-downs |
|--------|-----------|---------|----------|---------------------|
| `imap` | Auto-created during IMAP sync from folder names | Inbox, Sent, Work | No | Yes |
| `user` | Manually created by the user | Important, Follow-up | Yes | Yes |
| `connector` | Auto-created when adding a mail account (one label per account) | work-imap | No | Yes |

Only `user`-source labels can be renamed, recolored, or deleted by the user — `imap` and `connector` labels are managed automatically by the sync engine.

### Create label

```
POST /api/labels
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

**Response**: `409 Conflict` (if label name already exists)

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

### Get related filter labels

```
GET /api/labels/filter/related?ids=1,5&limit=10
```

Returns labels that appear on messages carrying ALL of the given label IDs — useful for drill-down filter suggestions. Every returned label is guaranteed to intersect the current filter set (so clicking it always narrows the view to a non-empty result). Results are ordered by co-occurrence frequency within the intersection, excluding the filter labels themselves.

**Query parameters**:
- `ids` (required) — comma-separated list of label IDs to intersect
- `limit` (default: 10) — cap on the number of suggestions returned

**Response**: `200 OK`
```json
[
  { "id": 7, "name": "Urgent", "color": "#ff0000", "source": "user", "count": 5 },
  { "id": 9, "name": "Clients", "color": null, "source": "user", "count": 3 }
]
```

Returns `400 Bad Request` if `ids` is missing or all IDs are invalid.

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

## Unified Inbox

Cross-identity inbox views. These endpoints aggregate messages across all configured identities' Inbox labels, letting multi-identity setups see all incoming mail in one place.

### Get unified inbox messages

```
GET /api/inbox/unified?limit=50&offset=0
```

Returns inbox messages across all identities, sorted by date (newest first). Each message includes the `identity_id` field so the UI can show which identity each message belongs to.

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
    "preview": "Hi team, here are this week's numbers...",
    "identity_id": 1
  }
]
```

Messages from all identities' Inbox labels are merged and sorted by date. Identities without an "Inbox" label are excluded. Available once the container is unlocked — returns `423 Locked` otherwise.

### Get unified inbox count

```
GET /api/inbox/unified/count
```

Returns aggregate total and unread message counts across all identities' Inbox labels. Used to display the unified inbox badge count in the sidebar.

**Response**: `200 OK`
```json
{ "total": 147, "unread": 12 }
```

## Messages

### List messages in a folder

```
GET /api/identities/:identityId/folders/:folderId/messages?limit=50&offset=0
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

Permanently deletes a message from local storage. Note: with **Connector mode** enabled, messages are automatically removed from the IMAP server during sync — this endpoint only manages local storage.

**Response**: `200 OK` | `404 Not Found`

## Sending Email

### Send an email

```
POST /api/send
Content-Type: application/json
```

Sends an email via the identity's configured outbound connector and saves it to the local Sent folder.

**Required fields**: `identity_id`, `to` (array of email addresses)

At least one of `subject`, `text_body`, or `html_body` must be provided.

**Optional fields**: `cc` (array), `bcc` (array), `html_body`, `text_body`, `in_reply_to` (Message-ID string for threading), `references` (array of Message-ID strings), `attachments` (array)

**Request body**:
```json
{
  "identity_id": 1,
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "subject": "Hello from Stork",
  "text_body": "Plain text content",
  "html_body": "<p>HTML content</p>",
  "in_reply_to": "<original-msg-id@example.com>",
  "references": ["<original-msg-id@example.com>"],
  "attachments": [
    {
      "filename": "report.pdf",
      "content_type": "application/pdf",
      "content_base64": "base64-encoded-data..."
    }
  ]
}
```

**Response**: `200 OK`
```json
{
  "ok": true,
  "message_id": "<generated-id@example.com>",
  "accepted": ["recipient@example.com"],
  "rejected": [],
  "stored_message_id": 42
}
```

The sent message is automatically stored in the identity's Sent folder (created if it doesn't exist) with the `\Seen` flag. Attachments are also saved locally.

**Response**: `400 Bad Request` (missing fields or SMTP not configured) | `404 Not Found` (invalid identity) | `500 Internal Server Error` (SMTP failure)

### Test SMTP connection

```
POST /api/send/test-smtp
Content-Type: application/json
```

Verifies SMTP credentials without sending a message. Use this during connector setup to validate the SMTP configuration.

**Required fields**: `smtp_host`, `smtp_user`, `smtp_pass`

**Optional fields**: `smtp_port` (default: 587), `smtp_tls` (default: 1)

**Request body**:
```json
{
  "smtp_host": "smtp.example.com",
  "smtp_port": 587,
  "smtp_tls": 1,
  "smtp_user": "user@example.com",
  "smtp_pass": "app-password"
}
```

**Response**: `200 OK`
```json
{ "ok": true }
```

**Response**: `200 OK` (verification failed)
```json
{ "ok": false, "error": "SMTP connection verification failed" }
```

## Drafts

Drafts persist compose state server-side so work is preserved across browser refreshes and devices.

### List drafts

```
GET /api/drafts?identity_id=1
```

Returns all drafts for an identity, sorted by last updated (newest first). Body content is truncated to a 200-character preview.

**Query parameters**:
- `identity_id` (required)

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "identity_id": 1,
    "to_addresses": "alice@example.com",
    "subject": "Draft subject",
    "preview": "First 200 characters of body...",
    "compose_mode": "new",
    "original_message_id": null,
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T11:00:00.000Z"
  }
]
```

### Get a draft

```
GET /api/drafts/:id
```

Returns the full draft including complete body content.

**Response**: `200 OK` | `404 Not Found`

### Create a draft

```
POST /api/drafts
Content-Type: application/json
```

**Required fields**: `identity_id`

**Optional fields**: `to_addresses`, `cc_addresses`, `bcc_addresses`, `subject`, `text_body`, `html_body`, `in_reply_to`, `references`, `original_message_id` (links to the message being replied to/forwarded), `compose_mode` (`new`, `reply`, `reply-all`, `forward` — default: `new`)

**Request body**:
```json
{
  "identity_id": 1,
  "to_addresses": "recipient@example.com",
  "subject": "Work in progress",
  "text_body": "Partial draft...",
  "compose_mode": "new"
}
```

**Response**: `201 Created`
```json
{ "id": 1 }
```

### Update a draft

```
PUT /api/drafts/:id
Content-Type: application/json
```

Partial update — only include fields you want to change. Automatically updates the `updated_at` timestamp.

**Response**: `200 OK` | `400 Bad Request` (no fields) | `404 Not Found`

### Delete a draft

```
DELETE /api/drafts/:id
```

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
GET /api/search?q=quarterly+report&identity_id=1&limit=20&offset=0
```

Full-text search across all synced messages using SQLite FTS5.

**Query parameters**:
- `q` (required) — search query. Supports FTS5 syntax:
  - `quarterly report` — matches messages containing both words
  - `"quarterly report"` — phrase match (exact sequence)
  - `quarterly OR annual` — matches either word
  - `quarterly NOT draft` — excludes messages containing "draft"
- `identity_id` (optional) — filter results to a specific identity
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
POST /api/identities/:identityId/sync
```

Triggers an immediate sync for the specified identity. Returns the sync result.

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

Returns the sync status for all identities.

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
GET /api/identities/:identityId/sync-status
```

Returns per-folder sync details including last synced UID.

## Connectors

Connectors are transport adapters — inbound connectors bring mail in, outbound connectors send mail out. Identities reference outbound connectors for sending.

All connector endpoints are prefixed with `/api/connectors`.

### Inbound Connectors

#### List inbound connectors

```
GET /api/connectors/inbound
```

Returns all configured inbound connectors. Sensitive fields (passwords, secrets) are omitted.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Work IMAP",
    "type": "imap",
    "imap_host": "imap.example.com",
    "imap_port": 993,
    "imap_tls": 1,
    "imap_user": "user@example.com",
    "sync_delete_from_server": 0,
    "cf_r2_account_id": null,
    "cf_r2_bucket_name": null,
    "cf_r2_access_key_id": null,
    "cf_r2_prefix": "pending/",
    "cf_r2_poll_interval_ms": null,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z"
  }
]
```

Supported types: `imap`, `cloudflare-email`, `cloudflare-r2`.

#### Get inbound connector

```
GET /api/connectors/inbound/:connectorId
```

**Response**: `200 OK` | `404 Not Found`

#### Create inbound connector

```
POST /api/connectors/inbound
Content-Type: application/json
```

**Required fields**: `name`, `type`

**IMAP fields**: `imap_host`, `imap_port` (default: 993), `imap_tls` (default: 1), `imap_user`, `imap_pass`, `sync_delete_from_server` (0 = mirror mode, 1 = connector mode)

**Cloudflare R2 fields**: `cf_r2_account_id`, `cf_r2_bucket_name`, `cf_r2_access_key_id`, `cf_r2_secret_access_key`, `cf_r2_prefix` (default: `pending/`), `cf_r2_poll_interval_ms`

**Response**: `201 Created`
```json
{ "id": 1 }
```

#### Update inbound connector

```
PUT /api/connectors/inbound/:connectorId
Content-Type: application/json
```

Partial update — only include fields to change. Password fields are only updated when provided.

**Response**: `200 OK` | `400 Bad Request` | `404 Not Found`

#### Delete inbound connector

```
DELETE /api/connectors/inbound/:connectorId
```

**Response**: `200 OK` | `404 Not Found` | `409 Conflict` (connector has linked identities)

#### Test inbound connector

```
POST /api/connectors/inbound/:connectorId/test
```

Attempts to connect to the IMAP server and list folders. Returns folder count on success.

**Response**: `200 OK`
```json
{ "ok": true, "details": { "folders": 12 } }
```

```json
{ "ok": false, "error": "Authentication failed" }
```

#### Get inbound connector sync status

```
GET /api/connectors/inbound/:connectorId/sync-status
```

Returns the current sync scheduler status for this connector.

**Response**: `200 OK`
```json
{
  "running": false,
  "lastSync": 1737000900000,
  "lastError": null,
  "consecutiveErrors": 0
}
```

#### Trigger inbound connector sync

```
POST /api/connectors/inbound/:connectorId/sync
```

Triggers an immediate sync for the connector.

**Response**: `200 OK` | `404 Not Found`

#### Count synced messages on server

```
GET /api/connectors/inbound/:connectorId/synced-count
```

Returns the number of messages that are stored locally in Stork and still known to exist on the upstream server (`deleted_from_server = 0`). Used by the connector transition wizard to tell the user how much mail would be affected by a clean-server action.

**Response**: `200 OK`
```json
{ "count": 12345 }
```

#### Clean messages from the upstream server

```
POST /api/connectors/inbound/:connectorId/clean-server
```

For IMAP connectors only. Bulk-deletes every message on the upstream IMAP server that Stork has already synced (in batches of 100 UIDs per folder). Stork's encrypted local copies are unaffected. Typically invoked after the transition wizard confirms a mirror-mode → connector-mode switch with "remove from server" selected. This cannot be undone.

**Response**: `200 OK`
```json
{ "deleted": 12345 }
```

- `400 Bad Request` — the connector is not of type `imap`
- `404 Not Found` — no connector with that ID
- `500 Internal Server Error` — scheduler rejected the request (e.g. connector not registered) or the IMAP session errored mid-delete; the response body includes `error`

#### Re-label messages from the upstream server

```
POST /api/connectors/inbound/:connectorId/re-label-from-server
```

For IMAP connectors only. Performs a bounded on-demand reconciliation pass: fetches the current UID list per folder via IMAP `SEARCH ALL`, compares against locally-stored folder memberships, detects cross-folder moves via RFC 5322 `Message-ID`, and updates folder labels accordingly (stale labels removed, destination labels confirmed). Useful when messages were moved or relabelled server-side while Stork was offline.

**Response**: `200 OK` — result object from the scheduler describing changes applied.

- `400 Bad Request` — the connector is not of type `imap`
- `404 Not Found` — no connector with that ID
- `500 Internal Server Error` — scheduler rejected the request or the IMAP session errored; the response body includes `error`

#### List folders for inbound connector

```
GET /api/connectors/inbound/:connectorId/folders
```

Returns all synced folders for this connector.

**Response**: `200 OK` — array of folder objects

#### List messages for folder

```
GET /api/connectors/inbound/:connectorId/folders/:folderId/messages
```

Returns paginated messages in the folder. Supports `limit` and `offset` query parameters.

### Outbound Connectors

#### List outbound connectors

```
GET /api/connectors/outbound
```

Returns all configured outbound connectors. Sensitive fields (passwords, secrets) are omitted.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Work SMTP",
    "type": "smtp",
    "smtp_host": "smtp.example.com",
    "smtp_port": 587,
    "smtp_tls": 1,
    "smtp_user": "user@example.com",
    "ses_region": null,
    "ses_access_key_id": null,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z"
  }
]
```

Supported types: `smtp`, `ses`.

#### Get outbound connector

```
GET /api/connectors/outbound/:connectorId
```

**Response**: `200 OK` | `404 Not Found`

#### Create outbound connector

```
POST /api/connectors/outbound
Content-Type: application/json
```

**Required fields**: `name`, `type`

**SMTP fields**: `smtp_host`, `smtp_port` (default: 587), `smtp_tls` (default: 1), `smtp_user`, `smtp_pass`

**SES fields**: `ses_region`, `ses_access_key_id`, `ses_secret_access_key`

**Response**: `201 Created`
```json
{ "id": 1 }
```

#### Update outbound connector

```
PUT /api/connectors/outbound/:connectorId
Content-Type: application/json
```

Partial update — only include fields to change. Credential fields only update when provided.

**Response**: `200 OK` | `400 Bad Request` | `404 Not Found`

#### Delete outbound connector

```
DELETE /api/connectors/outbound/:connectorId
```

**Response**: `200 OK` | `404 Not Found` | `409 Conflict` (connector has linked identities)

#### Test outbound connector

```
POST /api/connectors/outbound/:connectorId/test
```

Attempts to connect to the SMTP server or verify SES credentials.

**Response**: `200 OK`
```json
{ "ok": true }
```

```json
{ "ok": false, "error": "Connection refused" }
```
