import Database from "better-sqlite3-multiple-ciphers";
import type { ContainerContext } from "../crypto/lifecycle.js";
import { ensureSchema } from "../storage/db.js";
import { SyncScheduler } from "../sync/sync-scheduler.js";

/** Creates a fresh in-memory database with all migrations applied (including pre-migration hooks) */
export function createTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA busy_timeout = 5000");
	// Attach in-memory blobs DB (mirrors openDatabase behavior)
	db.exec("ATTACH DATABASE ':memory:' AS blobs");
	db.exec(
		"CREATE TABLE IF NOT EXISTS blobs.attachment_blobs (content_hash TEXT PRIMARY KEY, data BLOB NOT NULL)",
	);
	ensureSchema(db);
	return db;
}

/** Creates a test inbound connector and returns its ID */
export function createTestInboundConnector(
	db: Database.Database,
	overrides: Partial<{
		name: string;
		imapHost: string;
		imapPort: number;
		imapUser: string;
		imapPass: string;
	}> = {},
): number {
	db.prepare(`
		INSERT INTO inbound_connectors (name, type, imap_host, imap_port, imap_tls, imap_user, imap_pass)
		VALUES (?, 'imap', ?, ?, 1, ?, ?)
	`).run(
		overrides.name ?? "Test Inbound",
		overrides.imapHost ?? "127.0.0.1",
		overrides.imapPort ?? 993,
		overrides.imapUser ?? "testuser",
		overrides.imapPass ?? "testpass",
	);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Inserts a test identity (send-only: name + email + optional outbound connector) and returns the identity ID */
export function createTestIdentity(
	db: Database.Database,
	overrides: Partial<{
		name: string;
		email: string;
		smtpHost: string;
		smtpPort: number;
		smtpUser: string;
		smtpPass: string;
	}> = {},
): number {
	const name = overrides.name ?? "Test Identity";

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

	// Create identity (send-only: no inbound_connector_id)
	db.prepare(`
		INSERT INTO identities (name, email, outbound_connector_id)
		VALUES (?, ?, ?)
	`).run(name, overrides.email ?? "test@example.com", outboundId);

	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Inserts a test folder (linked to inbound connector) and returns its ID */
export function createTestFolder(
	db: Database.Database,
	inboundConnectorId: number,
	path: string,
	overrides: Partial<{
		name: string;
		specialUse: string;
		uidValidity: number;
	}> = {},
): number {
	db.prepare(`
		INSERT INTO folders (inbound_connector_id, path, name, delimiter, flags, special_use, uid_validity)
		VALUES (?, ?, ?, '/', '[]', ?, ?)
	`).run(
		inboundConnectorId,
		path,
		overrides.name ?? path.split("/").pop(),
		overrides.specialUse ?? null,
		overrides.uidValidity ?? 1,
	);
	return Number((db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id);
}

/** Inserts a test label and returns its ID. */
export function createTestLabel(
	db: Database.Database,
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

/** Inserts a test message (linked to inbound connector) and returns its ID */
export function createTestMessage(
	db: Database.Database,
	inboundConnectorId: number,
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
			inbound_connector_id, folder_id, uid, message_id, subject,
			from_address, from_name, to_addresses, date,
			text_body, html_body, flags, size, has_attachments,
			in_reply_to, "references"
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?)
	`).run(
		inboundConnectorId,
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
