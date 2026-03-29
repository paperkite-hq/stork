import { type CloudflareEmailConfig, CloudflareEmailIngestConnector } from "./cloudflare-email.js";
import { type ImapConnectorConfig, ImapIngestConnector } from "./imap.js";
import { type SesConfig, SesSendConnector } from "./ses.js";
import { type SmtpConfig, SmtpSendConnector } from "./smtp.js";
import type { IngestConnector, SendConnector } from "./types.js";

export type IngestConnectorType = "imap" | "cloudflare-email" | "cloudflare-r2";
export type SendConnectorType = "smtp" | "ses";

export interface IngestConnectorConfig {
	type: IngestConnectorType;
	imap?: ImapConnectorConfig;
	cloudflareEmail?: CloudflareEmailConfig;
}

export interface SendConnectorConfig {
	type: SendConnectorType;
	smtp?: SmtpConfig;
	ses?: SesConfig;
}

/**
 * Creates an IngestConnector from a typed configuration.
 *
 * Supports IMAP (pull-based) and Cloudflare Email Workers (push-based webhook).
 */
export function createIngestConnector(config: IngestConnectorConfig): IngestConnector {
	switch (config.type) {
		case "imap": {
			if (!config.imap) {
				throw new Error("IMAP configuration required for imap connector");
			}
			return new ImapIngestConnector(config.imap);
		}
		case "cloudflare-email": {
			if (!config.cloudflareEmail) {
				throw new Error("Cloudflare Email configuration required for cloudflare-email connector");
			}
			return new CloudflareEmailIngestConnector(config.cloudflareEmail);
		}
		case "cloudflare-r2":
			// cloudflare-r2 is poll-based and managed by R2Poller in the sync layer,
			// not via the IngestConnector interface. This path should not be reached.
			throw new Error("cloudflare-r2 connectors are managed by R2Poller, not IngestConnector");
		default:
			throw new Error(`Unknown ingest connector type: ${config.type}`);
	}
}

/**
 * Creates a SendConnector from a typed configuration.
 *
 * Supports SMTP (via Nodemailer) and AWS SES (via @aws-sdk/client-sesv2).
 */
export function createSendConnector(config: SendConnectorConfig): SendConnector {
	switch (config.type) {
		case "smtp": {
			if (!config.smtp) {
				throw new Error("SMTP configuration required for smtp connector");
			}
			return new SmtpSendConnector(config.smtp);
		}
		case "ses": {
			if (!config.ses) {
				throw new Error("SES configuration required for ses connector");
			}
			return new SesSendConnector(config.ses);
		}
		default:
			throw new Error(`Unknown send connector type: ${config.type}`);
	}
}
