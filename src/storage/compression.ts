/**
 * Application-level compression for large text fields in the messages table.
 *
 * Compresses html_body, raw_headers (not in FTS5 index) and attachment blob
 * data using Node.js zlib (deflate). text_body is left uncompressed because
 * the FTS5 content=messages triggers read it directly from the messages table.
 *
 * The decompress helpers are type-aware: SQLite returns TEXT columns as strings
 * and BLOB columns as Buffers via better-sqlite3. Legacy uncompressed data
 * (string) passes through unchanged; compressed data (Buffer) is inflated.
 */

import { deflateSync, inflateSync } from "node:zlib";

/** Compress a string into a deflated Buffer. Returns null for null/undefined input. */
export function compressText(text: string | null | undefined): Buffer | null {
	if (text == null) return null;
	return deflateSync(Buffer.from(text, "utf-8"), { level: 6 });
}

/** Compress a Buffer (e.g. attachment data). Returns null for null/undefined input. */
export function compressBuffer(data: Buffer | null | undefined): Buffer | null {
	if (data == null) return null;
	return deflateSync(data, { level: 6 });
}

/**
 * Decompress a field that may be either a string (legacy uncompressed) or
 * a Buffer (compressed). Returns null for null/undefined input.
 */
export function decompressText(value: Buffer | string | null | undefined): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value; // legacy uncompressed
	return inflateSync(value).toString("utf-8");
}

/**
 * Decompress a Buffer field that may be either uncompressed or compressed.
 * For attachment blobs: compressed data starts with zlib header (0x78).
 * Legacy uncompressed data is returned as-is.
 */
export function decompressBuffer(data: Buffer | null | undefined): Buffer | null {
	if (data == null) return null;
	// zlib deflate streams start with 0x78 (CMF byte: CM=8 deflate, CINFO varies)
	// Raw data that happens to start with 0x78 would fail inflate, so we try/catch
	if (data.length >= 2 && data[0] === 0x78) {
		try {
			return inflateSync(data);
		} catch {
			return data; // not actually compressed
		}
	}
	return data;
}

/**
 * Decompress html_body and raw_headers on a message row object.
 * Mutates and returns the same object for convenience.
 */
export function decompressMessageRow<T extends Record<string, unknown>>(row: T): T {
	if ("html_body" in row) {
		(row as Record<string, unknown>).html_body = decompressText(
			row.html_body as Buffer | string | null,
		);
	}
	if ("raw_headers" in row) {
		(row as Record<string, unknown>).raw_headers = decompressText(
			row.raw_headers as Buffer | string | null,
		);
	}
	return row;
}
