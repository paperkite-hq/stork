/**
 * Cloudflare R2 queue poller for stork.
 *
 * Implements the queue/poll half of the durable email ingest model:
 *   1. A Cloudflare Email Worker writes each inbound email as a JSON object to
 *      an R2 bucket under a configurable prefix (default: "pending/").
 *   2. This poller lists the bucket on a configurable interval, downloads each
 *      pending object, parses and stores the email, then deletes the object.
 *   3. Objects are only deleted after a successful DB write — if stork is
 *      locked or the write fails, the object stays in R2 and is retried on
 *      the next poll cycle.
 *   4. Message-ID deduplication in storeInboundEmail prevents duplicates on
 *      the rare path where a crash occurs between write and delete.
 *
 * Authentication uses AWS SigV4 with Cloudflare R2's S3-compatible API.
 * The region string for R2 is "auto".
 */

import type Database from "better-sqlite3-multiple-ciphers";
import { storeInboundEmail } from "../storage/email-storage.js";
import { signR2Request } from "./r2-sigv4.js";

const DEFAULT_POLL_INTERVAL_MS = 60_000; // 60 seconds
const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes
const MAX_KEYS_PER_POLL = 100;

interface R2ConnectorRow {
	id: number;
	cf_r2_account_id: string;
	cf_r2_bucket_name: string;
	cf_r2_access_key_id: string;
	cf_r2_secret_access_key: string;
	cf_r2_prefix: string;
	cf_r2_poll_interval_ms: number | null;
}

interface PollerState {
	connectorId: number;
	cfAccountId: string;
	bucketName: string;
	accessKeyId: string;
	secretAccessKey: string;
	prefix: string;
	pollIntervalMs: number;
	timer: ReturnType<typeof setInterval> | null;
	running: boolean;
	pollPromise: Promise<void> | null;
	lastPoll: number | null;
	lastError: string | null;
	consecutiveErrors: number;
}

export interface R2PollerOptions {
	/** Default poll interval in ms when a connector has no per-connector override (default: 60s) */
	defaultPollIntervalMs?: number;
	/** Called after each successful poll cycle */
	onPollComplete?: (connectorId: number, stored: number) => void;
	/** Called when a poll cycle fails */
	onPollError?: (connectorId: number, error: Error) => void;
}

/**
 * Manages periodic polling of Cloudflare R2 buckets for queued inbound emails.
 *
 * Usage:
 *   const poller = new R2Poller(db, { onPollComplete, onPollError });
 *   poller.loadConnectorsFromDb();
 *   poller.start();
 *   // later:
 *   await poller.stop();
 */
export class R2Poller {
	private db: Database.Database;
	private defaultPollIntervalMs: number;
	private onPollComplete?: (connectorId: number, stored: number) => void;
	private onPollError?: (connectorId: number, error: Error) => void;
	private connectors: Map<number, PollerState> = new Map();
	private started = false;

	constructor(db: Database.Database, options: R2PollerOptions = {}) {
		this.db = db;
		this.defaultPollIntervalMs = options.defaultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.onPollComplete = options.onPollComplete;
		this.onPollError = options.onPollError;
	}

	/**
	 * Load all fully-configured cloudflare-r2 connectors from the database.
	 * Skips connectors with missing required fields (logs a warning).
	 */
	loadConnectorsFromDb(): void {
		const rows = this.db
			.prepare(
				`SELECT id, cf_r2_account_id, cf_r2_bucket_name,
					cf_r2_access_key_id, cf_r2_secret_access_key,
					cf_r2_prefix, cf_r2_poll_interval_ms
				FROM inbound_connectors
				WHERE type = 'cloudflare-r2'
					AND cf_r2_account_id IS NOT NULL
					AND cf_r2_bucket_name IS NOT NULL
					AND cf_r2_access_key_id IS NOT NULL
					AND cf_r2_secret_access_key IS NOT NULL`,
			)
			.all() as R2ConnectorRow[];

		for (const row of rows) {
			if (this.connectors.has(row.id)) continue;
			this.addConnectorFromRow(row);
		}
	}

	/** Add a single R2 connector at runtime (e.g. after creation via API). */
	addConnector(row: R2ConnectorRow): void {
		if (this.connectors.has(row.id)) {
			this.removeConnector(row.id);
		}
		this.addConnectorFromRow(row);
	}

	/** Remove a connector and stop polling it. */
	removeConnector(connectorId: number): void {
		const state = this.connectors.get(connectorId);
		if (!state) return;
		if (state.timer) clearInterval(state.timer);
		this.connectors.delete(connectorId);
	}

	/** Start the poller — begins periodic polling for all registered connectors. */
	start(): void {
		if (this.started) return;
		this.started = true;
		for (const state of this.connectors.values()) {
			this.startConnectorPoll(state);
		}
	}

	/**
	 * Stop all polling — cancels timers and waits for any in-flight polls to finish
	 * (up to 5 seconds).
	 */
	async stop(): Promise<void> {
		this.started = false;

		const pending: Promise<void>[] = [];
		for (const state of this.connectors.values()) {
			if (state.timer) {
				clearInterval(state.timer);
				state.timer = null;
			}
			if (state.pollPromise) {
				pending.push(state.pollPromise);
			}
		}

		if (pending.length > 0) {
			const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
			await Promise.race([Promise.allSettled(pending), timeout]);
		}
	}

	/** Trigger an immediate poll for a specific connector. */
	async pollNow(connectorId: number): Promise<number> {
		const state = this.connectors.get(connectorId);
		if (!state) throw new Error(`R2 connector ${connectorId} is not registered`);
		return this.runPoll(state);
	}

	/** Return status of all registered connectors. */
	getStatus(): Map<
		number,
		{ running: boolean; lastPoll: number | null; lastError: string | null }
	> {
		const out = new Map<
			number,
			{ running: boolean; lastPoll: number | null; lastError: string | null }
		>();
		for (const [id, s] of this.connectors) {
			out.set(id, { running: s.running, lastPoll: s.lastPoll, lastError: s.lastError });
		}
		return out;
	}

	private addConnectorFromRow(row: R2ConnectorRow): void {
		const state: PollerState = {
			connectorId: row.id,
			cfAccountId: row.cf_r2_account_id,
			bucketName: row.cf_r2_bucket_name,
			accessKeyId: row.cf_r2_access_key_id,
			secretAccessKey: row.cf_r2_secret_access_key,
			prefix: row.cf_r2_prefix ?? "pending/",
			pollIntervalMs: row.cf_r2_poll_interval_ms ?? this.defaultPollIntervalMs,
			timer: null,
			running: false,
			pollPromise: null,
			lastPoll: null,
			lastError: null,
			consecutiveErrors: 0,
		};
		this.connectors.set(row.id, state);
		if (this.started) {
			this.startConnectorPoll(state);
		}
	}

	private startConnectorPoll(state: PollerState): void {
		this.runPoll(state).catch(() => {});
		state.timer = setInterval(() => {
			this.runPoll(state).catch(() => {});
		}, state.pollIntervalMs);
	}

	private async runPoll(state: PollerState): Promise<number> {
		if (state.running) return 0;

		state.running = true;
		const connectorId = state.connectorId;

		const doRun = async (): Promise<number> => {
			try {
				const stored = await this.pollConnector(state);
				state.lastPoll = Date.now();
				state.lastError = null;
				state.consecutiveErrors = 0;
				this.onPollComplete?.(connectorId, stored);
				return stored;
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				state.lastError = error.message;
				state.consecutiveErrors++;
				this.onPollError?.(connectorId, error);

				// Apply exponential backoff
				if (state.consecutiveErrors > 1 && state.timer) {
					clearInterval(state.timer);
					const backoffMs = Math.min(
						state.pollIntervalMs * 2 ** (state.consecutiveErrors - 1),
						MAX_BACKOFF_MS,
					);
					state.timer = setInterval(() => {
						this.runPoll(state).catch(() => {});
					}, backoffMs);
				}

				throw error;
			} finally {
				state.running = false;
				state.pollPromise = null;
			}
		};

		const promise = doRun();
		state.pollPromise = promise.then(() => {}).catch(() => {});
		return promise;
	}

	/**
	 * Execute one poll cycle for a connector:
	 * list pending objects → download each → parse + store → delete on success.
	 */
	private async pollConnector(state: PollerState): Promise<number> {
		const baseUrl = `https://${state.cfAccountId}.r2.cloudflarestorage.com`;
		const keys = await this.listObjects(state, baseUrl);

		let stored = 0;
		for (const key of keys) {
			stored += await this.processObject(state, baseUrl, key);
		}
		return stored;
	}

	/**
	 * List object keys in the R2 bucket under the configured prefix.
	 * Uses the S3 ListObjectsV2 API (list-type=2).
	 */
	private async listObjects(state: PollerState, baseUrl: string): Promise<string[]> {
		const url = new URL(`${baseUrl}/${state.bucketName}`);
		url.searchParams.set("list-type", "2");
		url.searchParams.set("prefix", state.prefix);
		url.searchParams.set("max-keys", String(MAX_KEYS_PER_POLL));

		const headers = signR2Request({
			method: "GET",
			url,
			accessKeyId: state.accessKeyId,
			secretAccessKey: state.secretAccessKey,
		});

		const res = await fetch(url.toString(), { method: "GET", headers });
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`R2 list failed: ${res.status} ${res.statusText} — ${body}`);
		}

		const xml = await res.text();
		return parseListObjectsKeys(xml);
	}

	/**
	 * Download, parse, and store one R2 object as an inbound email.
	 * Deletes the object from R2 on success or on unrecoverable parse errors.
	 * Returns the number of identities the message was stored for.
	 */
	private async processObject(state: PollerState, baseUrl: string, key: string): Promise<number> {
		// Download the object
		const getUrl = new URL(`${baseUrl}/${state.bucketName}/${encodeObjectKey(key)}`);
		const getHeaders = signR2Request({
			method: "GET",
			url: getUrl,
			accessKeyId: state.accessKeyId,
			secretAccessKey: state.secretAccessKey,
		});

		const res = await fetch(getUrl.toString(), { method: "GET", headers: getHeaders });
		if (!res.ok) {
			throw new Error(`R2 get failed for ${key}: ${res.status} ${res.statusText}`);
		}

		const body = await res.text();

		// Parse the payload
		let payload: { from: string; to: string; raw: string; rawSize: number };
		try {
			payload = JSON.parse(body);
		} catch (err) {
			// Unrecoverable — bad JSON will never succeed on retry; delete and skip
			console.error(`[r2-poller] Deleting unparseable object ${key}: ${err}`);
			await this.deleteObject(state, baseUrl, key);
			return 0;
		}

		if (!payload.raw || typeof payload.raw !== "string") {
			console.error(`[r2-poller] Deleting malformed payload for ${key}: missing 'raw' field`);
			await this.deleteObject(state, baseUrl, key);
			return 0;
		}

		// Store in DB — if this throws (e.g. locked container), the object stays in R2
		let result: { stored: number };
		try {
			result = await storeInboundEmail(this.db, state.connectorId, payload);
		} catch (err) {
			// Transient DB error — leave in R2 for retry
			throw new Error(
				`DB write failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		// Delete from R2 after successful write (or if all deliveries were duplicates)
		await this.deleteObject(state, baseUrl, key);
		return result.stored;
	}

	/** Delete an object from R2. Errors are logged but not rethrown. */
	private async deleteObject(state: PollerState, baseUrl: string, key: string): Promise<void> {
		const url = new URL(`${baseUrl}/${state.bucketName}/${encodeObjectKey(key)}`);
		const headers = signR2Request({
			method: "DELETE",
			url,
			accessKeyId: state.accessKeyId,
			secretAccessKey: state.secretAccessKey,
		});

		const res = await fetch(url.toString(), { method: "DELETE", headers });
		// 204 = deleted, 404 = already gone — both are fine
		if (!res.ok && res.status !== 404) {
			console.error(
				`[r2-poller] Failed to delete R2 object ${key}: ${res.status} ${res.statusText}`,
			);
		}
	}
}

/**
 * Extract object keys from an S3 ListObjectsV2 XML response.
 * Keys appear as <Key>...</Key> inside <Contents> blocks.
 */
export function parseListObjectsKeys(xml: string): string[] {
	const keys: string[] = [];
	// Match all <Key>...</Key> elements (contents keys)
	const re = /<Key>([^<]+)<\/Key>/g;
	for (const match of xml.matchAll(re)) {
		keys.push(unescapeXml(match[1]));
	}
	return keys;
}

/** Unescape XML character references in an attribute value. */
function unescapeXml(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"');
}

/**
 * Encode an R2 object key for use in a URL path component.
 * Encodes all characters except '/' (which separates path segments in key names).
 */
function encodeObjectKey(key: string): string {
	return key
		.split("/")
		.map((seg) => encodeURIComponent(seg))
		.join("/");
}
