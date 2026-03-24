/**
 * SQLite schema for Stork mail storage.
 *
 * Uses FTS5 for full-text search across message subjects and bodies.
 */

export const SCHEMA_VERSION = 12;

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
	// These columns are maintained by refreshAccountCounts() at the end of each sync cycle.
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
];
