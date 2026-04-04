export {
	type CloudflareEmailConfig,
	CloudflareEmailIngestConnector,
	type CloudflareEmailPayload,
} from "./cloudflare-email.js";

export { type ImapConnectorConfig, ImapIngestConnector } from "./imap.js";
export {
	createIngestConnector,
	createSendConnector,
	type IngestConnectorConfig,
	type IngestConnectorType,
	type SendConnectorConfig,
	type SendConnectorType,
} from "./registry.js";
export { type SesConfig, SesSendConnector } from "./ses.js";
export { type SmtpConfig, SmtpSendConnector } from "./smtp.js";
export type {
	FolderInfo,
	IngestConnector,
	OutgoingAttachment,
	OutgoingMessage,
	RawAttachment,
	RawMessage,
	SendConnector,
	SendResult,
} from "./types.js";
