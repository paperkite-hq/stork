/**
 * SQLite schema for Stork mail storage.
 *
 * Uses FTS5 for full-text search across message subjects and bodies.
 */

export const SCHEMA_VERSION = 26;

export const MIGRATIONS = [
	// Version 1: Initial schema
	`
	CREATE TABLE IF NOT EXISTS accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		email TEXT NOT NULL,
		imap_host TEXT NOT NULL,
		imap_port INTEGER NOT NULL DEFAULT 993,
		imap_tls INTEGER NOT NULL DEFAULT 1,
		imap_user TEXT NOT NULL,
		imap_pass TEXT NOT NULL,
		smtp_host TEXT,
		smtp_port INTEGER DEFAULT 587,
		smtp_tls INTEGER DEFAULT 1,
		smtp_user TEXT,
		smtp_pass TEXT,
		sync_delete_from_server INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS folders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		path TEXT NOT NULL,
		name TEXT NOT NULL,
		delimiter TEXT,
		flags TEXT,
		uid_validity INTEGER,
		uid_next INTEGER,
		message_count INTEGER DEFAULT 0,
		unread_count INTEGER DEFAULT 0,
		last_synced_at TEXT,
		UNIQUE(account_id, path)
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
		uid INTEGER NOT NULL,
		message_id TEXT,
		in_reply_to TEXT,
		"references" TEXT,
		subject TEXT,
		from_address TEXT,
		from_name TEXT,
		to_addresses TEXT,
		cc_addresses TEXT,
		bcc_addresses TEXT,
		date TEXT,
		text_body TEXT,
		html_body TEXT,
		flags TEXT,
		size INTEGER,
		has_attachments INTEGER DEFAULT 0,
		raw_headers TEXT,
		deleted_from_server INTEGER DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(folder_id, uid)
	);

	CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
	CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder_id);
	CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
	CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
	CREATE INDEX IF NOT EXISTS idx_messages_in_reply_to ON messages(in_reply_to);

	CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		filename TEXT,
		content_type TEXT,
		size INTEGER,
		content_id TEXT,
		data BLOB
	);

	CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

	CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
		subject,
		from_address,
		from_name,
		to_addresses,
		text_body,
		content=messages,
		content_rowid=id,
		tokenize='porter unicode61'
	);

	CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
		VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
	END;

	CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
		VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
	END;

	CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
		VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
		INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
		VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
	END;

	CREATE TABLE IF NOT EXISTS sync_state (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
		last_uid INTEGER DEFAULT 0,
		last_synced_at TEXT,
		UNIQUE(account_id, folder_id)
	);

	CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER NOT NULL
	);

	INSERT INTO schema_version (version) VALUES (1);
	`,
	// Version 2: Add special_use column for folder type detection
	`
	ALTER TABLE folders ADD COLUMN special_use TEXT;
	`,
	// Version 3: Add labels system — Gmail-style labels replace folders as the
	// primary organizational model. IMAP folders are still synced for tracking
	// sync state, but user-facing organization is label-based. When an email
	// syncs from an IMAP folder, the folder name becomes a suggested initial label.
	`
	CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		color TEXT,
		source TEXT NOT NULL DEFAULT 'user',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(account_id, name)
	);

	CREATE INDEX IF NOT EXISTS idx_labels_account ON labels(account_id);

	CREATE TABLE IF NOT EXISTS message_labels (
		message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (message_id, label_id)
	);

	CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels(label_id);
	`,
	// Version 4: Add sync_errors table for persistent error tracking.
	// Each row records a single error that occurred during sync — per-message
	// parse failures, folder-level IMAP errors, etc. Errors are classified
	// so the UI can distinguish retriable (transient) from permanent failures,
	// and include enough context (folder, UID) for automatic retry.
	`
	CREATE TABLE IF NOT EXISTS sync_errors (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		folder_path TEXT,
		uid INTEGER,
		error_type TEXT NOT NULL,
		message TEXT NOT NULL,
		retriable INTEGER NOT NULL DEFAULT 1,
		resolved INTEGER NOT NULL DEFAULT 0,
		retry_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		resolved_at TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_sync_errors_account ON sync_errors(account_id);
	CREATE INDEX IF NOT EXISTS idx_sync_errors_unresolved ON sync_errors(account_id, resolved);
	`,
	// Version 5: Add drafts table for server-side draft persistence.
	// Drafts store compose state (to, cc, bcc, subject, body) so they survive
	// across browser sessions and devices. Each draft belongs to an account and
	// optionally references an original message (for reply/forward).
	`
	CREATE TABLE IF NOT EXISTS drafts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		to_addresses TEXT,
		cc_addresses TEXT,
		bcc_addresses TEXT,
		subject TEXT,
		text_body TEXT,
		html_body TEXT,
		in_reply_to TEXT,
		"references" TEXT,
		original_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
		compose_mode TEXT NOT NULL DEFAULT 'new',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id);
	`,
	// Version 6: Add image_trusted_senders table — persistent per-sender whitelist
	// for remote image loading. When a sender is trusted, their remote images are
	// loaded automatically without showing the "images blocked" banner.
	// Tracking pixels are still stripped regardless of trust status.
	`
	CREATE TABLE IF NOT EXISTS image_trusted_senders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		sender_address TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(account_id, sender_address)
	);

	CREATE INDEX IF NOT EXISTS idx_image_trusted_senders_account ON image_trusted_senders(account_id);
	CREATE INDEX IF NOT EXISTS idx_image_trusted_senders_lookup ON image_trusted_senders(account_id, sender_address);
	`,
	// Version 7: Add connector type columns for pluggable connector architecture.
	// Accounts can now use alternative ingest/send connectors (Cloudflare Email Workers,
	// AWS SES) instead of the default IMAP/SMTP. Connector-specific config is stored
	// in dedicated columns. Existing accounts default to imap/smtp.
	`
	ALTER TABLE accounts ADD COLUMN ingest_connector_type TEXT NOT NULL DEFAULT 'imap';
	ALTER TABLE accounts ADD COLUMN send_connector_type TEXT NOT NULL DEFAULT 'smtp';
	ALTER TABLE accounts ADD COLUMN cf_email_webhook_secret TEXT;
	ALTER TABLE accounts ADD COLUMN ses_region TEXT;
	ALTER TABLE accounts ADD COLUMN ses_access_key_id TEXT;
	ALTER TABLE accounts ADD COLUMN ses_secret_access_key TEXT;
	`,
	// Version 8: Add composite index for account+date queries.
	// The separate indexes on account_id and date required a full account scan
	// followed by a sort on large databases. The composite index lets SQLite
	// satisfy ORDER BY date DESC for a given account in a single index scan.
	`
CREATE INDEX IF NOT EXISTS idx_messages_account_date ON messages(account_id, date DESC);
`,
	// Version 9: Add default_view column for per-account configurable landing view.
	// Stores the view to auto-select on load: 'inbox', 'unread', 'all', or 'label:<id>'.
	// Defaults to 'inbox' so existing accounts keep current behavior.
	`
ALTER TABLE accounts ADD COLUMN default_view TEXT NOT NULL DEFAULT 'inbox';
`,
	// Version 10: Add cached message_count and unread_count to labels table.
	// The labels API endpoint previously computed these via an expensive JOIN across
	// message_labels and messages on every request — on a 15 GB database this took
	// 18+ seconds and blocked the synchronous event loop, starving concurrent requests.
	// These columns are maintained by refreshLabelCounts() at the end of each sync
	// cycle. The backfill here covers existing databases; future updates happen in sync.
	`
ALTER TABLE labels ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE labels ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
UPDATE labels SET message_count = (
	SELECT COUNT(*) FROM message_labels WHERE label_id = labels.id
);
UPDATE labels SET unread_count = (
	SELECT COUNT(*) FROM message_labels ml
	JOIN messages m ON m.id = ml.message_id
	WHERE ml.label_id = labels.id
	AND (m.flags IS NULL OR m.flags NOT LIKE '%\\Seen%')
);
`,
	// Version 11: Add cached_message_count and cached_unread_count to accounts table.
	// The GET /accounts/:id/all-messages/count and GET /accounts/:id/unread-messages/count
	// endpoints previously did a full messages table scan with a LIKE flags filter on every
	// request. On a 15 GB database this blocked the event loop for 10-30 seconds.
	// These columns are maintained by refreshIdentityCounts() at the end of each sync cycle.
	// NULL means "not yet computed" — the endpoint falls back to a live query once, then
	// stores the result. Subsequent requests return the cached value instantly.
	`
ALTER TABLE accounts ADD COLUMN cached_message_count INTEGER DEFAULT NULL;
ALTER TABLE accounts ADD COLUMN cached_unread_count INTEGER DEFAULT NULL;
`,
	// Version 12: Add pending_archive flag for crash-safe archive mode deletion.
	// When archive mode is on, messages are marked pending_archive=1 immediately
	// after being inserted. Phase 3 of syncFolder queries this column instead of
	// relying on an in-memory list — so if the process is killed after Phase 1
	// (fetch) but before Phase 3 (delete), the next sync cycle picks up and
	// finishes the deletion. Cleared to 0 once deleted_from_server is set.
	`
ALTER TABLE messages ADD COLUMN pending_archive INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_messages_pending_archive ON messages(folder_id, pending_archive);
`,
	// Version 13: Decouple inbound and outbound connectors from accounts.
	//
	// Previously, each account row embedded all connector config (IMAP/CF for
	// ingest, SMTP/SES for send). This 1:1 coupling prevents sharing a single
	// SES connector across multiple identities, or mixing Fastmail IMAP with
	// AWS SES for outbound deliverability.
	//
	// The new model:
	//   - inbound_connectors: one row per ingest config (IMAP creds, CF webhook secret)
	//   - outbound_connectors: one row per send config (SMTP creds, SES creds)
	//   - accounts: identity table — holds name + email + references to connectors
	//
	// Migration: existing account rows are migrated 1:1 (one connector per account),
	// preserving all existing behaviour. Connector rows take their name from the
	// account name. The old inline columns remain on accounts for now (kept for
	// backward-compat reads) but new code reads from the connector tables.
	//
	// _account_id is a temporary migration-aid column — it is set during the INSERT
	// so we can link accounts back to their new connector rows, then cleared to NULL.
	// SQLite pre-3.35 cannot DROP COLUMN, so we leave it as a permanently-NULL column.
	`
CREATE TABLE IF NOT EXISTS inbound_connectors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	type TEXT NOT NULL DEFAULT 'imap',
	imap_host TEXT,
	imap_port INTEGER DEFAULT 993,
	imap_tls INTEGER DEFAULT 1,
	imap_user TEXT,
	imap_pass TEXT,
	cf_email_webhook_secret TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	_account_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_inbound_connectors_type ON inbound_connectors(type);

CREATE TABLE IF NOT EXISTS outbound_connectors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	type TEXT NOT NULL DEFAULT 'smtp',
	smtp_host TEXT,
	smtp_port INTEGER DEFAULT 587,
	smtp_tls INTEGER DEFAULT 1,
	smtp_user TEXT,
	smtp_pass TEXT,
	ses_region TEXT,
	ses_access_key_id TEXT,
	ses_secret_access_key TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	_account_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_outbound_connectors_type ON outbound_connectors(type);

ALTER TABLE accounts ADD COLUMN inbound_connector_id INTEGER REFERENCES inbound_connectors(id);
ALTER TABLE accounts ADD COLUMN outbound_connector_id INTEGER REFERENCES outbound_connectors(id);

INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass, cf_email_webhook_secret, _account_id)
SELECT name || ' (Inbound)', ingest_connector_type, imap_host, imap_port, imap_tls, imap_user, imap_pass, cf_email_webhook_secret, id
FROM accounts;

INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass, ses_region, ses_access_key_id, ses_secret_access_key, _account_id)
SELECT name || ' (Outbound)', send_connector_type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass, ses_region, ses_access_key_id, ses_secret_access_key, id
FROM accounts;

UPDATE accounts SET
	inbound_connector_id = (SELECT id FROM inbound_connectors WHERE _account_id = accounts.id),
	outbound_connector_id = (SELECT id FROM outbound_connectors WHERE _account_id = accounts.id);

UPDATE inbound_connectors SET _account_id = NULL;
UPDATE outbound_connectors SET _account_id = NULL;
`,
	// Version 14: Remove NOT NULL constraints from legacy IMAP columns on accounts.
	//
	// The original v1 schema declared imap_host/imap_user/imap_pass as NOT NULL because
	// every account required IMAP. After v13 (n×m connectors), accounts no longer store
	// connector config directly — they reference inbound_connectors instead. New accounts
	// are created without inline IMAP fields, so those NOT NULL constraints must go.
	//
	// SQLite cannot DROP NOT NULL via ALTER COLUMN, so we recreate the accounts table.
	// All FKs in child tables reference accounts by name and will reattach automatically
	// once the table is renamed back. We disable FK enforcement during the operation to
	// avoid intermediate-state violations.
	`
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE accounts_v14 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	email TEXT NOT NULL,
	imap_host TEXT,
	imap_port INTEGER NOT NULL DEFAULT 993,
	imap_tls INTEGER NOT NULL DEFAULT 1,
	imap_user TEXT,
	imap_pass TEXT,
	smtp_host TEXT,
	smtp_port INTEGER DEFAULT 587,
	smtp_tls INTEGER DEFAULT 1,
	smtp_user TEXT,
	smtp_pass TEXT,
	sync_delete_from_server INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	ingest_connector_type TEXT NOT NULL DEFAULT 'imap',
	send_connector_type TEXT NOT NULL DEFAULT 'smtp',
	cf_email_webhook_secret TEXT,
	ses_region TEXT,
	ses_access_key_id TEXT,
	ses_secret_access_key TEXT,
	default_view TEXT NOT NULL DEFAULT 'inbox',
	cached_message_count INTEGER DEFAULT NULL,
	cached_unread_count INTEGER DEFAULT NULL,
	inbound_connector_id INTEGER REFERENCES inbound_connectors(id),
	outbound_connector_id INTEGER REFERENCES outbound_connectors(id)
);

INSERT INTO accounts_v14 SELECT * FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_v14 RENAME TO accounts;

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 15: Unify labels — remove per-account scoping.
	//
	// Previously, labels had an account_id FK and were scoped to a single account.
	// This produced the confusing UX where label choices varied depending on which
	// account was selected in the compose or sidebar.
	//
	// The unified model: labels are instance-level (no account FK). All accounts share
	// the same label namespace. When multiple accounts had labels with the same name
	// (e.g. both had "INBOX"), the rows are merged: the lowest-id row becomes canonical
	// and all message_labels pointing at the duplicate rows are redirected.
	//
	// Implications:
	//   - refreshLabelCounts() now counts across all accounts (no account filter)
	//   - ensureLabelsForFolders() uses ON CONFLICT(name) instead of (account_id, name)
	//   - applyFolderLabelsToMessages() joins labels by name only (no account scope)
	`
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TEMP TABLE label_canonicals AS
SELECT name, MIN(id) AS canonical_id
FROM labels
GROUP BY name;

UPDATE message_labels
SET label_id = (
    SELECT lc.canonical_id
    FROM labels l
    JOIN label_canonicals lc ON lc.name = l.name
    WHERE l.id = message_labels.label_id
)
WHERE label_id NOT IN (SELECT canonical_id FROM label_canonicals);

DELETE FROM labels WHERE id NOT IN (SELECT canonical_id FROM label_canonicals);

CREATE TABLE labels_v15 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    message_count INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name)
);

INSERT INTO labels_v15 (id, name, color, source, message_count, unread_count, created_at)
SELECT id, name, color, source, message_count, unread_count, created_at
FROM labels;

DROP TABLE labels;
ALTER TABLE labels_v15 RENAME TO labels;

DROP INDEX IF EXISTS idx_labels_account;
CREATE INDEX IF NOT EXISTS idx_message_labels_label_v15 ON message_labels(label_id);

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 16: Move sync_delete_from_server to inbound connectors + auto-account labels.
	//
	// sync_delete_from_server (Mirror vs Connector mode) is fundamentally a property
	// of the inbound connector — it controls whether messages are deleted from the
	// IMAP server after sync. For non-IMAP connectors (e.g. Cloudflare Email Workers),
	// the concept doesn't apply. Moving it to inbound_connectors aligns the setting
	// with the entity it actually affects.
	//
	// Auto-account labels: instead of a dedicated "Accounts" sidebar section, every
	// incoming message is auto-labeled with its receiving account's name (source='account').
	// These labels appear in the sidebar alongside other labels, enabling multi-label
	// drill-down: click "Work" to see all Work messages, then filter further by "Inbox".
	`
ALTER TABLE inbound_connectors ADD COLUMN sync_delete_from_server INTEGER NOT NULL DEFAULT 0;

UPDATE inbound_connectors SET sync_delete_from_server = (
	SELECT a.sync_delete_from_server FROM accounts a
	WHERE a.inbound_connector_id = inbound_connectors.id
	LIMIT 1
)
WHERE EXISTS (
	SELECT 1 FROM accounts a WHERE a.inbound_connector_id = inbound_connectors.id
);
`,
	// Version 17: Add Cloudflare R2 inbound connector support.
	//
	// Replaces the direct webhook push model with a durable queue/poll pattern:
	//   1. A Cloudflare Email Worker writes each email as a JSON object to an R2 bucket.
	//   2. Stork polls the bucket on a configurable interval, processes pending objects,
	//      and deletes them after a successful DB write.
	//
	// This decouples email reception from server availability — emails queue in R2 while
	// stork is down or locked and are processed on the next poll after unlock/restart.
	//
	// R2's S3-compatible API is used for listing, downloading, and deleting objects.
	// Credentials are the R2 Access Key ID / Secret Access Key (not the CF API token).
	`
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_account_id TEXT;
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_bucket_name TEXT;
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_access_key_id TEXT;
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_secret_access_key TEXT;
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_prefix TEXT NOT NULL DEFAULT 'pending/';
ALTER TABLE inbound_connectors ADD COLUMN cf_r2_poll_interval_ms INTEGER;
`,
	// Version 18: Eliminate "accounts" concept — replace with "identities".
	//
	// Accounts were originally IMAP-centric (one account = one mailbox with inline
	// credentials). After v13 decoupled connectors into separate tables, the accounts
	// table became a thin identity layer holding only name, email, and connector
	// references — but still carried ~20 legacy columns (imap_*, smtp_*, ses_*, etc.)
	// that are now redundant with the connector tables.
	//
	// This migration:
	//   1. Creates a clean `identities` table with only: id, name, email,
	//      inbound_connector_id, outbound_connector_id, default_view, timestamps.
	//   2. Renames account_id → identity_id in all child tables: messages, folders,
	//      sync_state, sync_errors, drafts.
	//   3. Makes image_trusted_senders global (removes account_id, uses
	//      UNIQUE(sender_address)) — trust decisions apply across all identities.
	//   4. Recreates all affected indexes with the new column names.
	//   5. Drops the accounts table.
	//
	// The messages FTS triggers (messages_ai, messages_ad, messages_au) are dropped
	// and recreated because they reference the messages table which is recreated.
	`
PRAGMA foreign_keys = OFF;
BEGIN;

-- Step 1: Create identities table from accounts (only keeping relevant columns)
CREATE TABLE identities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	email TEXT NOT NULL,
	inbound_connector_id INTEGER REFERENCES inbound_connectors(id),
	outbound_connector_id INTEGER REFERENCES outbound_connectors(id),
	default_view TEXT NOT NULL DEFAULT 'inbox',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO identities (id, name, email, inbound_connector_id, outbound_connector_id, default_view, created_at, updated_at)
SELECT id, name, email, inbound_connector_id, outbound_connector_id, default_view, created_at, updated_at
FROM accounts;

-- Step 2: Recreate folders with identity_id instead of account_id
CREATE TABLE folders_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	delimiter TEXT,
	flags TEXT,
	uid_validity INTEGER,
	uid_next INTEGER,
	message_count INTEGER DEFAULT 0,
	unread_count INTEGER DEFAULT 0,
	last_synced_at TEXT,
	special_use TEXT,
	UNIQUE(identity_id, path)
);

INSERT INTO folders_v18 (id, identity_id, path, name, delimiter, flags, uid_validity, uid_next, message_count, unread_count, last_synced_at, special_use)
SELECT id, account_id, path, name, delimiter, flags, uid_validity, uid_next, message_count, unread_count, last_synced_at, special_use
FROM folders;

DROP TABLE folders;
ALTER TABLE folders_v18 RENAME TO folders;

-- Step 3: Drop FTS triggers before recreating messages table
DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TRIGGER IF EXISTS messages_au;

-- Step 4: Recreate messages with identity_id instead of account_id
CREATE TABLE messages_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	uid INTEGER NOT NULL,
	message_id TEXT,
	in_reply_to TEXT,
	"references" TEXT,
	subject TEXT,
	from_address TEXT,
	from_name TEXT,
	to_addresses TEXT,
	cc_addresses TEXT,
	bcc_addresses TEXT,
	date TEXT,
	text_body TEXT,
	html_body TEXT,
	flags TEXT,
	size INTEGER,
	has_attachments INTEGER DEFAULT 0,
	raw_headers TEXT,
	deleted_from_server INTEGER DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	pending_archive INTEGER NOT NULL DEFAULT 0,
	UNIQUE(folder_id, uid)
);

INSERT INTO messages_v18 (id, identity_id, folder_id, uid, message_id, in_reply_to, "references", subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, date, text_body, html_body, flags, size, has_attachments, raw_headers, deleted_from_server, created_at, pending_archive)
SELECT id, account_id, folder_id, uid, message_id, in_reply_to, "references", subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, date, text_body, html_body, flags, size, has_attachments, raw_headers, deleted_from_server, created_at, pending_archive
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_v18 RENAME TO messages;

-- Recreate messages indexes
CREATE INDEX idx_messages_identity ON messages(identity_id);
CREATE INDEX idx_messages_folder ON messages(folder_id);
CREATE INDEX idx_messages_date ON messages(date DESC);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_in_reply_to ON messages(in_reply_to);
CREATE INDEX idx_messages_identity_date ON messages(identity_id, date DESC);
CREATE INDEX idx_messages_pending_archive ON messages(folder_id, pending_archive);

-- Recreate FTS triggers
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
	INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
END;

-- Step 5: Recreate sync_state with identity_id instead of account_id
CREATE TABLE sync_state_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	last_uid INTEGER DEFAULT 0,
	last_synced_at TEXT,
	UNIQUE(identity_id, folder_id)
);

INSERT INTO sync_state_v18 (id, identity_id, folder_id, last_uid, last_synced_at)
SELECT id, account_id, folder_id, last_uid, last_synced_at
FROM sync_state;

DROP TABLE sync_state;
ALTER TABLE sync_state_v18 RENAME TO sync_state;

-- Step 6: Recreate sync_errors with identity_id instead of account_id
CREATE TABLE sync_errors_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
	folder_path TEXT,
	uid INTEGER,
	error_type TEXT NOT NULL,
	message TEXT NOT NULL,
	retriable INTEGER NOT NULL DEFAULT 1,
	resolved INTEGER NOT NULL DEFAULT 0,
	retry_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	resolved_at TEXT
);

INSERT INTO sync_errors_v18 (id, identity_id, folder_path, uid, error_type, message, retriable, resolved, retry_count, created_at, resolved_at)
SELECT id, account_id, folder_path, uid, error_type, message, retriable, resolved, retry_count, created_at, resolved_at
FROM sync_errors;

DROP TABLE sync_errors;
ALTER TABLE sync_errors_v18 RENAME TO sync_errors;

CREATE INDEX idx_sync_errors_identity ON sync_errors(identity_id);
CREATE INDEX idx_sync_errors_unresolved ON sync_errors(identity_id, resolved);

-- Step 7: Recreate drafts with identity_id instead of account_id
CREATE TABLE drafts_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
	to_addresses TEXT,
	cc_addresses TEXT,
	bcc_addresses TEXT,
	subject TEXT,
	text_body TEXT,
	html_body TEXT,
	in_reply_to TEXT,
	"references" TEXT,
	original_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
	compose_mode TEXT NOT NULL DEFAULT 'new',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO drafts_v18 (id, identity_id, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body, in_reply_to, "references", original_message_id, compose_mode, created_at, updated_at)
SELECT id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body, in_reply_to, "references", original_message_id, compose_mode, created_at, updated_at
FROM drafts;

DROP TABLE drafts;
ALTER TABLE drafts_v18 RENAME TO drafts;

CREATE INDEX idx_drafts_identity ON drafts(identity_id);

-- Step 8: Recreate image_trusted_senders as global (no account_id)
CREATE TABLE image_trusted_senders_v18 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	sender_address TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(sender_address)
);

INSERT OR IGNORE INTO image_trusted_senders_v18 (sender_address, created_at)
SELECT sender_address, MIN(created_at)
FROM image_trusted_senders
GROUP BY sender_address;

DROP TABLE image_trusted_senders;
ALTER TABLE image_trusted_senders_v18 RENAME TO image_trusted_senders;

CREATE INDEX idx_image_trusted_senders_lookup ON image_trusted_senders(sender_address);

-- Step 9: Drop the accounts table
DROP TABLE accounts;

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 19: Identities are SEND-ONLY — remove inbound_connector_id from identities.
	//
	// Core principle: identities hold name + email + outbound connector (for sending).
	// Inbound connectors are standalone: messages, folders, sync_state, and sync_errors
	// now reference inbound_connectors directly, not through identities.
	//
	// Changes:
	//   1. identities: remove inbound_connector_id column (temp table approach)
	//   2. folders: add inbound_connector_id, set identity_id = NULL on migrated rows,
	//      replace UNIQUE(identity_id, path) with two partial unique indexes
	//   3. messages: add inbound_connector_id, set identity_id = NULL on migrated rows
	//   4. sync_state: replace identity_id with inbound_connector_id
	//   5. sync_errors: replace identity_id with inbound_connector_id
	//
	// The drafts table is unchanged: drafts are outgoing and remain identity-based.
	`
PRAGMA foreign_keys = OFF;
BEGIN;

-- Step 1: Recreate identities without inbound_connector_id
-- Keep old table as identities_v19_temp for data migration
ALTER TABLE identities RENAME TO identities_v19_temp;

CREATE TABLE identities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	email TEXT NOT NULL,
	outbound_connector_id INTEGER REFERENCES outbound_connectors(id),
	default_view TEXT NOT NULL DEFAULT 'inbox',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO identities (id, name, email, outbound_connector_id, default_view, created_at, updated_at)
SELECT id, name, email, outbound_connector_id, default_view, created_at, updated_at
FROM identities_v19_temp;

-- Step 2: Recreate folders with inbound_connector_id
-- Drop FTS triggers first (they reference messages which will be recreated)
DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TRIGGER IF EXISTS messages_au;

CREATE TABLE folders_v19 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER REFERENCES identities(id) ON DELETE CASCADE,
	inbound_connector_id INTEGER REFERENCES inbound_connectors(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	name TEXT NOT NULL,
	delimiter TEXT,
	flags TEXT,
	uid_validity INTEGER,
	uid_next INTEGER,
	message_count INTEGER DEFAULT 0,
	unread_count INTEGER DEFAULT 0,
	last_synced_at TEXT,
	special_use TEXT
);

-- Migrate folders: set inbound_connector_id from old identity's inbound_connector_id,
-- set identity_id = NULL (folders are for received mail, not identity-owned)
INSERT INTO folders_v19 (id, identity_id, inbound_connector_id, path, name, delimiter, flags, uid_validity, uid_next, message_count, unread_count, last_synced_at, special_use)
SELECT f.id, NULL, t.inbound_connector_id, f.path, f.name, f.delimiter, f.flags, f.uid_validity, f.uid_next, f.message_count, f.unread_count, f.last_synced_at, f.special_use
FROM folders f
JOIN identities_v19_temp t ON t.id = f.identity_id;

DROP TABLE folders;
ALTER TABLE folders_v19 RENAME TO folders;

-- Partial unique indexes replace the old UNIQUE(identity_id, path)
CREATE UNIQUE INDEX idx_folders_unique_inbound ON folders(inbound_connector_id, path) WHERE inbound_connector_id IS NOT NULL;
CREATE UNIQUE INDEX idx_folders_unique_identity ON folders(identity_id, path) WHERE identity_id IS NOT NULL;

-- Step 3: Recreate messages with inbound_connector_id
CREATE TABLE messages_v19 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER REFERENCES identities(id) ON DELETE CASCADE,
	inbound_connector_id INTEGER REFERENCES inbound_connectors(id) ON DELETE CASCADE,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	uid INTEGER NOT NULL,
	message_id TEXT,
	in_reply_to TEXT,
	"references" TEXT,
	subject TEXT,
	from_address TEXT,
	from_name TEXT,
	to_addresses TEXT,
	cc_addresses TEXT,
	bcc_addresses TEXT,
	date TEXT,
	text_body TEXT,
	html_body TEXT,
	flags TEXT,
	size INTEGER,
	has_attachments INTEGER DEFAULT 0,
	raw_headers TEXT,
	deleted_from_server INTEGER DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	pending_archive INTEGER NOT NULL DEFAULT 0,
	UNIQUE(folder_id, uid)
);

-- Migrate messages: set inbound_connector_id from old identity's connector, set identity_id = NULL
INSERT INTO messages_v19 (id, identity_id, inbound_connector_id, folder_id, uid, message_id, in_reply_to, "references", subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, date, text_body, html_body, flags, size, has_attachments, raw_headers, deleted_from_server, created_at, pending_archive)
SELECT m.id, NULL, t.inbound_connector_id, m.folder_id, m.uid, m.message_id, m.in_reply_to, m."references", m.subject, m.from_address, m.from_name, m.to_addresses, m.cc_addresses, m.bcc_addresses, m.date, m.text_body, m.html_body, m.flags, m.size, m.has_attachments, m.raw_headers, m.deleted_from_server, m.created_at, m.pending_archive
FROM messages m
JOIN identities_v19_temp t ON t.id = m.identity_id;

DROP TABLE messages;
ALTER TABLE messages_v19 RENAME TO messages;

-- Recreate messages indexes
CREATE INDEX idx_messages_inbound_connector ON messages(inbound_connector_id);
CREATE INDEX idx_messages_identity ON messages(identity_id);
CREATE INDEX idx_messages_folder ON messages(folder_id);
CREATE INDEX idx_messages_date ON messages(date DESC);
CREATE INDEX idx_messages_message_id ON messages(message_id);
CREATE INDEX idx_messages_in_reply_to ON messages(in_reply_to);
CREATE INDEX idx_messages_inbound_connector_date ON messages(inbound_connector_id, date DESC);
CREATE INDEX idx_messages_pending_archive ON messages(folder_id, pending_archive);

-- Recreate FTS triggers
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
	INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
	INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body);
	INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body)
	VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body);
END;

-- Step 4: Recreate sync_state with inbound_connector_id instead of identity_id
CREATE TABLE sync_state_v19 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	inbound_connector_id INTEGER NOT NULL REFERENCES inbound_connectors(id) ON DELETE CASCADE,
	folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
	last_uid INTEGER DEFAULT 0,
	last_synced_at TEXT,
	UNIQUE(inbound_connector_id, folder_id)
);

INSERT INTO sync_state_v19 (id, inbound_connector_id, folder_id, last_uid, last_synced_at)
SELECT ss.id, t.inbound_connector_id, ss.folder_id, ss.last_uid, ss.last_synced_at
FROM sync_state ss
JOIN identities_v19_temp t ON t.id = ss.identity_id;

DROP TABLE sync_state;
ALTER TABLE sync_state_v19 RENAME TO sync_state;

-- Step 5: Recreate sync_errors with inbound_connector_id instead of identity_id
CREATE TABLE sync_errors_v19 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	inbound_connector_id INTEGER NOT NULL REFERENCES inbound_connectors(id) ON DELETE CASCADE,
	folder_path TEXT,
	uid INTEGER,
	error_type TEXT NOT NULL,
	message TEXT NOT NULL,
	retriable INTEGER NOT NULL DEFAULT 1,
	resolved INTEGER NOT NULL DEFAULT 0,
	retry_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	resolved_at TEXT
);

INSERT INTO sync_errors_v19 (id, inbound_connector_id, folder_path, uid, error_type, message, retriable, resolved, retry_count, created_at, resolved_at)
SELECT se.id, t.inbound_connector_id, se.folder_path, se.uid, se.error_type, se.message, se.retriable, se.resolved, se.retry_count, se.created_at, se.resolved_at
FROM sync_errors se
JOIN identities_v19_temp t ON t.id = se.identity_id;

DROP TABLE sync_errors;
ALTER TABLE sync_errors_v19 RENAME TO sync_errors;

CREATE INDEX idx_sync_errors_inbound_connector ON sync_errors(inbound_connector_id);
CREATE INDEX idx_sync_errors_unresolved ON sync_errors(inbound_connector_id, resolved);

-- Step 6: Recreate drafts to fix FK reference (RENAME above updated it to identities_v19_temp)
CREATE TABLE drafts_v19 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	identity_id INTEGER REFERENCES identities(id) ON DELETE CASCADE,
	to_addresses TEXT,
	cc_addresses TEXT,
	bcc_addresses TEXT,
	subject TEXT,
	text_body TEXT,
	html_body TEXT,
	in_reply_to TEXT,
	"references" TEXT,
	original_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
	compose_mode TEXT NOT NULL DEFAULT 'new',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO drafts_v19 (id, identity_id, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body, in_reply_to, "references", original_message_id, compose_mode, created_at, updated_at)
SELECT id, identity_id, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body, in_reply_to, "references", original_message_id, compose_mode, created_at, updated_at
FROM drafts;

DROP TABLE drafts;
ALTER TABLE drafts_v19 RENAME TO drafts;

CREATE INDEX idx_drafts_identity ON drafts(identity_id);

-- Drop the temp table
DROP TABLE identities_v19_temp;

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 20: Hash-based attachment de-duplication.
	//
	// The same file is frequently attached to multiple messages (e.g. a logo attached
	// to every newsletter, or a PDF sent in a thread). Previously each attachment was
	// stored as an independent BLOB row — N copies of the same bytes for N messages.
	//
	// This migration introduces content-addressable attachment storage:
	//   - attachment_blobs: stores each unique file exactly once, keyed by SHA-256 hash.
	//   - attachments.content_hash: FK into attachment_blobs. When set, the actual bytes
	//     are read from attachment_blobs instead of attachments.data.
	//
	// Backward-compatibility: existing rows keep their data in attachments.data (not NULL).
	// The read path falls back to attachments.data when content_hash IS NULL. Going forward,
	// new attachment writes set content_hash and leave data NULL, saving one copy per dupe.
	`
CREATE TABLE IF NOT EXISTS attachment_blobs (
	content_hash TEXT PRIMARY KEY,
	data BLOB NOT NULL
);

ALTER TABLE attachments ADD COLUMN content_hash TEXT REFERENCES attachment_blobs(content_hash);

CREATE INDEX IF NOT EXISTS idx_attachments_content_hash ON attachments(content_hash);
`,
	// Version 21: Clean up attachment de-duplication — drop legacy inline data column.
	//
	// Pre-release cleanup (no real users yet): removes the dual-storage fallback from v20.
	// All attachment data now lives exclusively in attachment_blobs. The attachments table
	// no longer has a data column; content_hash is NOT NULL.
	//
	// Migration steps:
	//   1. Move any existing inline data (attachments.data) into attachment_blobs.
	//   2. Rebuild the attachments table without the data column, content_hash NOT NULL.
	//   3. Delete orphaned attachment rows that had no data and no content_hash.
	`
PRAGMA foreign_keys = OFF;
BEGIN;

-- Step 1: Migrate any legacy inline data into attachment_blobs.
-- Compute SHA-256 would require app code, so we handle this in the JS migration hook.
-- For pure-SQL, we delete rows that have no data at all (no inline data AND no content_hash).
DELETE FROM attachments WHERE data IS NULL AND content_hash IS NULL;

-- Step 2: Rebuild attachments without the data column, content_hash NOT NULL.
CREATE TABLE attachments_v21 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	filename TEXT,
	content_type TEXT,
	size INTEGER,
	content_id TEXT,
	content_hash TEXT NOT NULL REFERENCES attachment_blobs(content_hash)
);

INSERT INTO attachments_v21 (id, message_id, filename, content_type, size, content_id, content_hash)
SELECT id, message_id, filename, content_type, size, content_id, content_hash
FROM attachments
WHERE content_hash IS NOT NULL;

DROP TABLE attachments;
ALTER TABLE attachments_v21 RENAME TO attachments;

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_content_hash ON attachments(content_hash);

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 22: Enforce connector-identity schema invariant.
	//
	// Every identity must be created alongside an outbound connector — there is
	// no "identity without a connector" state. This migration tightens the schema:
	//
	//   - outbound_connector_id becomes NOT NULL (was nullable).
	//   - ON DELETE CASCADE added so deleting a connector removes its identities.
	//
	// Pre-release cleanup: no real users, so any identities with a NULL
	// outbound_connector_id are deleted rather than migrated (they are orphans).
	`
PRAGMA foreign_keys = OFF;
BEGIN;

DELETE FROM identities WHERE outbound_connector_id IS NULL;

CREATE TABLE identities_v22 (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	email TEXT NOT NULL,
	outbound_connector_id INTEGER NOT NULL REFERENCES outbound_connectors(id) ON DELETE CASCADE,
	default_view TEXT NOT NULL DEFAULT 'inbox',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO identities_v22 (id, name, email, outbound_connector_id, default_view, created_at, updated_at)
SELECT id, name, email, outbound_connector_id, default_view, created_at, updated_at
FROM identities;

DROP TABLE identities;
ALTER TABLE identities_v22 RENAME TO identities;

COMMIT;
PRAGMA foreign_keys = ON;
`,
	// Version 23: Compress html_body, raw_headers, and attachment blob data.
	//
	// Emails contain a lot of text that compresses very well. HTML bodies and raw
	// headers are often 5-10x larger than the information they carry. Compressing
	// these fields at the application level (zlib deflate) typically reduces the
	// messages table size by 50-70%.
	//
	// What is compressed:
	//   - messages.html_body: HTML email bodies (not in FTS5 index)
	//   - messages.raw_headers: full raw MIME headers (not searched)
	//   - attachment_blobs.data: binary attachment content
	//
	// What is NOT compressed:
	//   - messages.text_body: indexed by FTS5 via content=messages triggers.
	//     Compressing it would break full-text search.
	//
	// SQLite is dynamically typed, so TEXT columns can hold BLOBs. The application
	// layer detects the type on read: strings pass through (legacy uncompressed),
	// Buffers are inflated (compressed). No schema DDL changes needed — the
	// pre-migration JS hook batch-compresses existing data in place.
	//
	// This is a no-op SQL migration; all work happens in PRE_MIGRATION_HOOKS[23].
	"SELECT 1",

	// Version 24: Backfill text_body for HTML-only messages.
	//
	// Emails with only an HTML body (no plain-text MIME part) had text_body = NULL,
	// making them invisible to FTS5 search. This migration extracts searchable
	// plain text from html_body for those messages.
	//
	// Going forward, the write paths (imap-sync, email-storage, send) use
	// htmlToText() as a fallback when parsed.text is absent.
	//
	// No-op SQL — the pre-migration hook does the work.
	"SELECT 1",

	// Version 25: Add html_text_body column and include it in FTS5.
	//
	// Adds a dedicated column for text extracted from HTML bodies, separate from
	// text_body (the original plain-text MIME part). Both are indexed by FTS5 so
	// search finds content regardless of which MIME part it lives in. This solves
	// the case where plain-text is a stub ("click here to view online") but the
	// HTML body contains the real content.
	//
	// The pre-migration hook adds the column and backfills it from html_body.
	// The SQL migration recreates the FTS table and triggers to include the new
	// column, then rebuilds the index.
	`
	DROP TRIGGER IF EXISTS messages_ai;
	DROP TRIGGER IF EXISTS messages_ad;
	DROP TRIGGER IF EXISTS messages_au;
	DROP TABLE IF EXISTS messages_fts;

	CREATE VIRTUAL TABLE messages_fts USING fts5(
		subject,
		from_address,
		from_name,
		to_addresses,
		text_body,
		html_text_body,
		content=messages,
		content_rowid=id,
		tokenize='porter unicode61'
	);

	CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body, html_text_body)
		VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body, new.html_text_body);
	END;

	CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body, html_text_body)
		VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body, old.html_text_body);
	END;

	CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, from_name, to_addresses, text_body, html_text_body)
		VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.to_addresses, old.text_body, old.html_text_body);
		INSERT INTO messages_fts(rowid, subject, from_address, from_name, to_addresses, text_body, html_text_body)
		VALUES (new.id, new.subject, new.from_address, new.from_name, new.to_addresses, new.text_body, new.html_text_body);
	END;

	INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
	`,

	// Version 26: Labels use full IMAP folder path instead of leaf name.
	// The pre-migration hook renames existing labels and re-links message_labels.
	"SELECT 1",
];
