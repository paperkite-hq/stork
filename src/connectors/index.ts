export type {
	IngestConnector,
	SendConnector,
	FolderInfo,
	RawMessage,
	OutgoingMessage,
	OutgoingAttachment,
	SendResult,
} from "./types.js";

export { ImapIngestConnector, type ImapConnectorConfig } from "./imap.js";
export { SmtpSendConnector, type SmtpConfig } from "./smtp.js";
export {
	CloudflareEmailIngestConnector,
	type CloudflareEmailConfig,
	type CloudflareEmailPayload,
} from "./cloudflare-email.js";
export { SesSendConnector, type SesConfig } from "./ses.js";
export {
	createIngestConnector,
	createSendConnector,
	type IngestConnectorConfig,
	type SendConnectorConfig,
	type IngestConnectorType,
	type SendConnectorType,
} from "./registry.js";
