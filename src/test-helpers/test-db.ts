import Database from "better-sqlite3-multiple-ciphers";
import type { ContainerContext } from "../crypto/lifecycle.js";
import { MIGRATIONS } from "../storage/schema.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";

/** Creates a fresh in-memory database with all migrations applied */
export function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA busy_timeout = 5000");
	for (const migration of MIGRATIONS) {
		db.exec(migration);
	}
	return db;
}

/** Inserts a test account (with inbound + outbound connectors) and returns the account ID */
export function createTestAccount(
	db: Database.Database,
	overrides: Partial<{
		name: string;
		email: string;
		imapHost: string;
		imapPort: number;
		imapUser: string;
		imapPass: string;
		smtpHost: string;
		smtpPort: number;
		smtpUser: string;
		smtpPass: string;
	}> = {},
): number {
	const name = overrides.name ?? "Test Account";

	// Create inbound connector
	db.prepare(`
		INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
		VALUES (?, 'imap', ?, ?, 1, ?, ?)
	`).run(
		`${name} (Inbound)`,
		overrides.imapHost ?? "127.0.0.1",
		overrides.imapPort ?? 993,
		overrides.imapUser ?? "testuser",
		overrides.imapPass ?? "testpass",
	);
	const inboundId = Number(
		(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
	);

	// Create outbound connector
	db.prepare(`
		INSERT INTO outbound_connectors (name, type, smtp_host, smtp_port, smtp_tls, smtp_user, smtp_pass)
		VALUES (?, 'smtp', ?, ?, 0, ?, ?)
	`).run(
		`${name} (Outbound)`,
		overrides.smtpHost ?? null,
		overrides.smtpPort ?? null,
		overrides.smtpUser ?? null,
		overrides.smtpPass ?? null,
	);
	const outboundId = Number(
		(db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id,
	);

	// Create account referencing both connectors
	db.prepare(`
		INSERT INTO accounts (name, email, inbound_connector_id, outbound_connector_id,
			ingest_connector_type, send_connector_type)
		VALUES (?, ?, ?, ?, 'imap', 'smtp')
	`).run(name, overrides.email ?? "test@example.com", inboundId, outboundId);

	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Inserts a test folder and returns its ID */
export function createTestFolder(
	db: Database.Database,
	accountId: number,
	path: string,
	overrides: Partial<{
		name: string;
		specialUse: string;
		uidValidity: number;
	}> = {},
): number {
	db.prepare(`
		INSERT INTO folders (account_id, path, name, delimiter, flags, special_use, uid_validity)
		VALUES (?, ?, ?, '/', '[]', ?, ?)
	`).run(
		accountId,
		path,
		overrides.name ?? path.split("/").pop(),
		overrides.specialUse ?? null,
		overrides.uidValidity ?? 1,
	);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Inserts a test label and returns its ID.
 * accountId is accepted for backward-compat but ignored — labels are now global. */
export function createTestLabel(
	db: Database.Database,
	_accountId: number,
	name: string,
	overrides: Partial<{
		color: string;
		source: string;
	}> = {},
): number {
	db.prepare(`
		INSERT OR IGNORE INTO labels (name, color, source)
		VALUES (?, ?, ?)
	`).run(name, overrides.color ?? null, overrides.source ?? "user");
	const row = db.prepare("SELECT id FROM labels WHERE name = ?").get(name) as { id: number };
	return row.id;
}

/** Links a message to a label */
export function addMessageLabel(db: Database.Database, messageId: number, labelId: number): void {
	db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)").run(
		messageId,
		labelId,
	);
}

/** Inserts a test message and returns its ID */
export function createTestMessage(
	db: Database.Database,
	accountId: number,
	folderId: number,
	uid: number,
	overrides: Partial<{
		messageId: string;
		subject: string;
		fromAddress: string;
		fromName: string;
		toAddresses: string;
		date: string;
		textBody: string;
		htmlBody: string;
		flags: string;
		inReplyTo: string;
		references: string;
		hasAttachments: number;
	}> = {},
): number {
	db.prepare(`
		INSERT INTO messages (
			account_id, folder_id, uid, message_id, subject,
			from_address, from_name, to_addresses, date,
			text_body, html_body, flags, size, has_attachments,
			in_reply_to, "references"
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?)
	`).run(
		accountId,
		folderId,
		uid,
		overrides.messageId ?? `<msg-${uid}@test.local>`,
		overrides.subject ?? `Test message ${uid}`,
		overrides.fromAddress ?? "sender@test.local",
		overrides.fromName ?? "Test Sender",
		overrides.toAddresses ?? '["recipient@test.local"]',
		overrides.date ?? new Date().toISOString(),
		overrides.textBody ?? `Body of message ${uid}`,
		overrides.htmlBody ?? null,
		overrides.flags ?? "",
		overrides.hasAttachments ?? 0,
		overrides.inReplyTo ?? null,
		overrides.references ?? null,
	);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Creates a pre-unlocked ContainerContext for use in API tests */
export function createTestContext(db: Database.Database): ContainerContext {
	const scheduler = new SyncScheduler(db, {
		onSyncComplete: () => {},
		onSyncError: () => {},
	});
	return {
		state: "unlocked",
		dataDir: ":memory:",
		db,
		scheduler,
		r2Poller: null,
		_vaultKeyInMemory: null,
	};
}
