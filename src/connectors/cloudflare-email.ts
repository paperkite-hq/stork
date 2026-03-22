import { simpleParser } from "mailparser";
import type { FolderInfo, IngestConnector, RawMessage } from "./types.js";

/**
 * Payload shape expected from a Cloudflare Email Worker.
 *
 * The worker receives an EmailMessage, reads the raw RFC 5322 stream,
 * base64-encodes it, and POSTs this JSON to Stork's webhook endpoint.
 */
export interface CloudflareEmailPayload {
	/** Envelope sender */
	from: string;
	/** Envelope recipient */
	to: string;
	/** Raw RFC 5322 message, base64-encoded */
	raw: string;
	/** Size of the raw message in bytes */
	rawSize: number;
}

export interface CloudflareEmailConfig {
	/**
	 * Shared secret for authenticating incoming webhooks.
	 * The worker must send this in the `Authorization: Bearer <secret>` header.
	 */
	webhookSecret: string;
}

/**
 * IngestConnector backed by Cloudflare Email Workers.
 *
 * Unlike IMAP (pull-based), this connector is push-based: a Cloudflare Email
 * Worker receives mail at the edge and POSTs it to Stork's webhook endpoint.
 * Messages are buffered in memory and yielded via fetchMessages().
 *
 * Typical flow:
 * 1. Cloudflare receives email at a routing address
 * 2. Email Worker reads the raw stream, base64-encodes it, POSTs to Stork
 * 3. Stork's webhook route calls pushMessage() on this connector
 * 4. The sync engine calls fetchMessages() to drain the buffer
 */
export class CloudflareEmailIngestConnector implements IngestConnector {
	readonly name = "cloudflare-email";
	private buffer: RawMessage[] = [];
	private nextUid = 1;
	private webhookSecret: string;
	private connected = false;

	constructor(config: CloudflareEmailConfig) {
		this.webhookSecret = config.webhookSecret;
	}

	async connect(): Promise<void> {
		this.connected = true;
	}

	async disconnect(): Promise<void> {
		this.connected = false;
	}

	async listFolders(): Promise<FolderInfo[]> {
		// Webhook-received mail lands in a single virtual INBOX
		return [
			{
				path: "INBOX",
				name: "Inbox",
				delimiter: "/",
				flags: [],
			},
		];
	}

	async *fetchMessages(folder: string, sinceUid: number): AsyncIterable<RawMessage> {
		for (const msg of this.buffer) {
			if (msg.uid > sinceUid) {
				yield msg;
			}
		}
	}

	/**
	 * Validates the webhook secret from an incoming request.
	 * Returns true if the provided secret matches the configured one.
	 */
	validateSecret(secret: string): boolean {
		// Constant-time comparison to prevent timing attacks
		if (secret.length !== this.webhookSecret.length) return false;
		let result = 0;
		for (let i = 0; i < secret.length; i++) {
			result |= secret.charCodeAt(i) ^ this.webhookSecret.charCodeAt(i);
		}
		return result === 0;
	}

	/**
	 * Push a message received via webhook into the connector's buffer.
	 * Called by the webhook route handler after validating the request.
	 *
	 * @returns The UID assigned to the buffered message.
	 */
	async pushMessage(payload: CloudflareEmailPayload): Promise<number> {
		const rawBuffer = Buffer.from(payload.raw, "base64");
		const parsed = await simpleParser(rawBuffer);

		const uid = this.nextUid++;
		const fromAddr = parsed.from?.value?.[0];
		const toAddrs = parsed.to
			? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((addr) =>
					addr.value.map((v) => ({
						address: v.address ?? "",
						name: v.name ?? undefined,
					})),
				)
			: undefined;
		const ccAddrs = parsed.cc
			? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((addr) =>
					addr.value.map((v) => ({
						address: v.address ?? "",
						name: v.name ?? undefined,
					})),
				)
			: undefined;

		const message: RawMessage = {
			uid,
			messageId: parsed.messageId ?? undefined,
			inReplyTo: parsed.inReplyTo ?? undefined,
			subject: parsed.subject ?? undefined,
			from: fromAddr
				? { address: fromAddr.address ?? "", name: fromAddr.name ?? undefined }
				: undefined,
			to: toAddrs,
			cc: ccAddrs,
			date: parsed.date ?? undefined,
			textBody: parsed.text ?? undefined,
			htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
			flags: [],
			size: payload.rawSize,
			hasAttachments: (parsed.attachments?.length ?? 0) > 0,
		};

		this.buffer.push(message);
		return uid;
	}

	/**
	 * Clear all buffered messages up to and including the given UID.
	 * Called after the sync engine has persisted messages to storage.
	 */
	acknowledge(upToUid: number): void {
		this.buffer = this.buffer.filter((m) => m.uid > upToUid);
	}

	/** Returns the number of buffered messages not yet consumed. */
	get pendingCount(): number {
		return this.buffer.length;
	}

	/** Returns whether the connector is in a connected state. */
	get isConnected(): boolean {
		return this.connected;
	}
}
