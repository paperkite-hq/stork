/**
 * Content-addressable attachment storage.
 *
 * Each unique file is stored exactly once in attachment_blobs, keyed by its
 * SHA-256 hash. Attachment rows carry a content_hash FK instead of inline data,
 * so duplicate files (same bytes across many messages) are stored only once.
 */

import { createHash } from "node:crypto";
import type Database from "better-sqlite3-multiple-ciphers";

/**
 * Inserts attachment content into attachment_blobs if not already present,
 * and returns the SHA-256 hex hash for use as the content_hash FK.
 */
export function upsertAttachmentBlob(db: Database.Database, data: Buffer): string {
	const hash = createHash("sha256").update(data).digest("hex");
	db.prepare("INSERT OR IGNORE INTO attachment_blobs (content_hash, data) VALUES (?, ?)").run(
		hash,
		data,
	);
	return hash;
}
