/**
 * Connector interfaces for pluggable email ingest and send.
 *
 * Stork separates "how mail arrives" from "how it's stored and displayed."
 * Connectors handle the transport layer — IMAP, Cloudflare Email Workers,
 * SMTP, SES, etc. Each connector implements one of these interfaces.
 */

export interface IngestConnector {
	readonly name: string;

	/** Connect to the mail source */
	connect(): Promise<void>;

	/** Disconnect from the mail source */
	disconnect(): Promise<void>;

	/** List available mailbox folders */
	listFolders(): Promise<FolderInfo[]>;

	/** Fetch messages from a folder, starting after the given UID */
	fetchMessages(folder: string, sinceUid: number): AsyncIterable<RawMessage>;

	/** Delete messages from the source (for "delete from server" workflow) */
	deleteMessages?(folder: string, uids: number[]): Promise<void>;
}

export interface SendConnector {
	readonly name: string;

	/** Send an email */
	send(message: OutgoingMessage): Promise<SendResult>;

	/** Verify the connection / credentials are valid */
	verify(): Promise<boolean>;
}

export interface FolderInfo {
	path: string;
	name: string;
	delimiter: string;
	flags: string[];
}

export interface RawMessage {
	uid: number;
	messageId?: string;
	inReplyTo?: string;
	subject?: string;
	from?: { address: string; name?: string };
	to?: { address: string; name?: string }[];
	cc?: { address: string; name?: string }[];
	date?: Date;
	textBody?: string;
	htmlBody?: string;
	flags?: string[];
	size?: number;
	hasAttachments?: boolean;
}

export interface OutgoingMessage {
	from: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
	attachments?: OutgoingAttachment[];
}

export interface OutgoingAttachment {
	filename: string;
	contentType: string;
	content: Buffer;
}

export interface SendResult {
	messageId: string;
	accepted: string[];
	rejected: string[];
}
