import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { FolderInfo, IngestConnector, RawMessage } from "./types.js";

export interface ImapConnectorConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: {
		user: string;
		pass: string;
	};
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * IngestConnector implementation backed by IMAP via ImapFlow.
 *
 * This is a thin transport adapter — it handles connecting to the IMAP server,
 * listing folders, and streaming messages. Storage, label management, and sync
 * state tracking remain in the sync engine (ImapSync), which orchestrates this
 * connector alongside the database layer.
 */
export class ImapIngestConnector implements IngestConnector {
	readonly name = "imap";
	private client: ImapFlow;
	private config: ImapConnectorConfig;

	constructor(config: ImapConnectorConfig) {
		this.config = config;
		this.client = new ImapFlow({
			...config,
			logger: false,
		});
		// Attach error handler immediately to prevent unhandled 'error' events
		// between construction and first connect() call.
		this.client.on("error", () => {});
	}

	async connect(): Promise<void> {
		await withRetry(async () => {
			// ImapFlow instances cannot be reconnected once closed — create fresh
			suppressImapFlowErrors(this.client);
			try {
				this.client.close();
			} catch {
				// May not be connected yet
			}
			this.client = new ImapFlow({
				...this.config,
				logger: false,
			});
			this.client.on("error", () => {});
			return this.client.connect();
		}, "IMAP connect");
	}

	async disconnect(): Promise<void> {
		try {
			await this.client.logout();
		} catch {
			// Connection may already be closed
		}
	}

	async listFolders(): Promise<FolderInfo[]> {
		const mailboxes = await withRetry(() => this.client.list(), "list mailboxes");
		const folders: FolderInfo[] = [];
		const seen = new Set<string>();

		for (const mailbox of mailboxes) {
			if (seen.has(mailbox.path)) continue;
			const flags = mailbox.flags ? Array.from(mailbox.flags) : [];
			if (flags.some((f) => f.toLowerCase() === "\\noselect")) continue;

			seen.add(mailbox.path);
			folders.push({
				path: mailbox.path,
				name: mailbox.name,
				delimiter: mailbox.delimiter || "/",
				flags,
			});
		}

		return folders;
	}

	async *fetchMessages(folder: string, sinceUid: number): AsyncIterable<RawMessage> {
		const lock = await withRetry(() => this.client.getMailboxLock(folder), `lock ${folder}`);

		try {
			const range = sinceUid > 0 ? `${sinceUid + 1}:*` : "1:*";

			for await (const message of this.client.fetch(range, {
				uid: true,
				envelope: true,
				flags: true,
				size: true,
				source: true,
			})) {
				const source = message.source;
				if (!source) continue;

				const parsed = await simpleParser(source);
				const envelope = message.envelope;
				if (!envelope) continue;

				const fromAddr = envelope.from?.[0];
				const toAddrs = envelope.to
					?.map((a) => ({
						address: a.address ?? "",
						name: a.name,
					}))
					.filter((a) => a.address);
				const ccAddrs = envelope.cc
					?.map((a) => ({
						address: a.address ?? "",
						name: a.name,
					}))
					.filter((a) => a.address);

				yield {
					uid: message.uid,
					messageId: envelope.messageId ?? undefined,
					inReplyTo: envelope.inReplyTo ?? undefined,
					subject: envelope.subject ?? undefined,
					from: fromAddr
						? {
								address: fromAddr.address ?? "",
								name: fromAddr.name ?? undefined,
							}
						: undefined,
					to: toAddrs,
					cc: ccAddrs,
					date: envelope.date ?? undefined,
					textBody: parsed.text ?? undefined,
					htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
					flags: Array.from(message.flags ?? new Set()),
					size: message.size ?? undefined,
					attachments: parsed.attachments
						.filter((att) => att.content != null)
						.map((att) => ({
							filename: att.filename ?? undefined,
							contentType:
								typeof att.contentType === "string" ? att.contentType : "application/octet-stream",
							size: typeof att.size === "number" ? att.size : att.content.length,
							contentId: att.contentId ?? undefined,
							content: att.content,
						})),
				};
			}
		} finally {
			try {
				lock.release();
			} catch {
				// Lock release may fail if connection was force-closed
			}
		}
	}

	async deleteMessages(folder: string, uids: number[]): Promise<void> {
		if (uids.length === 0) return;

		const lock = await this.client.getMailboxLock(folder);
		try {
			await this.client.messageDelete(uids, { uid: true });
		} finally {
			lock.release();
		}
	}

	/**
	 * Returns the underlying ImapFlow client for advanced operations.
	 * Used by the sync engine for operations not covered by IngestConnector
	 * (e.g., flag sync, UIDVALIDITY checks).
	 */
	getClient(): ImapFlow {
		return this.client;
	}

	/**
	 * Force-closes the IMAP connection by destroying the underlying socket.
	 */
	forceClose(): void {
		suppressImapFlowErrors(this.client);
		try {
			this.client.close();
		} catch {
			// Already closed
		}
	}
}

function suppressImapFlowErrors(client: ImapFlow): void {
	const noop = () => {};
	if (!client.listenerCount("error")) {
		client.on("error", noop);
	}
	const socket = (
		client as unknown as {
			socket?: { on?: (event: string, fn: () => void) => void };
		}
	).socket;
	if (socket && typeof socket.on === "function") {
		socket.on("error", noop);
	}
}

async function withRetry<T>(
	fn: () => Promise<T>,
	label: string,
	retries = MAX_RETRIES,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt < retries) {
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
			}
		}
	}
	throw new Error(`${label} failed after ${retries} attempts: ${lastError}`);
}
