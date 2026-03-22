import { type ImapConnectorConfig, ImapIngestConnector } from "./imap.js";
import { type SmtpConfig, SmtpSendConnector } from "./smtp.js";
import type { IngestConnector, SendConnector } from "./types.js";

export type IngestConnectorType = "imap";
export type SendConnectorType = "smtp";

export interface IngestConnectorConfig {
	type: IngestConnectorType;
	imap?: ImapConnectorConfig;
}

export interface SendConnectorConfig {
	type: SendConnectorType;
	smtp?: SmtpConfig;
}

/**
 * Creates an IngestConnector from a typed configuration.
 *
 * Currently supports IMAP; future connectors (Cloudflare Email Workers, etc.)
 * will be added here as new cases.
 */
export function createIngestConnector(config: IngestConnectorConfig): IngestConnector {
	switch (config.type) {
		case "imap": {
			if (!config.imap) {
				throw new Error("IMAP configuration required for imap connector");
			}
			return new ImapIngestConnector(config.imap);
		}
		default:
			throw new Error(`Unknown ingest connector type: ${config.type}`);
	}
}

/**
 * Creates a SendConnector from a typed configuration.
 *
 * Currently supports SMTP; future connectors (AWS SES, etc.)
 * will be added here as new cases.
 */
export function createSendConnector(config: SendConnectorConfig): SendConnector {
	switch (config.type) {
		case "smtp": {
			if (!config.smtp) {
				throw new Error("SMTP configuration required for smtp connector");
			}
			return new SmtpSendConnector(config.smtp);
		}
		default:
			throw new Error(`Unknown send connector type: ${config.type}`);
	}
}
