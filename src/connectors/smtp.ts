import { createTransport, type Transporter } from "nodemailer";
import type { OutgoingMessage, SendConnector, SendResult } from "./types.js";

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: {
		user: string;
		pass: string;
	};
}

/**
 * SendConnector implementation backed by SMTP via Nodemailer.
 *
 * Creates a transport on construction; call verify() to test credentials
 * before sending. Each send() creates a fresh connection (Nodemailer handles
 * pooling internally when pool:true is set, but we keep it simple for now).
 */
export class SmtpSendConnector implements SendConnector {
	readonly name = "smtp";
	private transport: Transporter;

	constructor(config: SmtpConfig) {
		this.transport = createTransport({
			host: config.host,
			port: config.port,
			secure: config.secure,
			auth: config.auth,
			tls: { rejectUnauthorized: config.secure },
		});
	}

	async send(message: OutgoingMessage): Promise<SendResult> {
		const result = await this.transport.sendMail({
			from: message.from,
			to: message.to.join(", "),
			cc: message.cc?.join(", "),
			bcc: message.bcc?.join(", "),
			subject: message.subject,
			text: message.textBody,
			html: message.htmlBody,
			inReplyTo: message.inReplyTo,
			references: message.references?.join(" "),
			attachments: message.attachments?.map((a) => ({
				filename: a.filename,
				contentType: a.contentType,
				content: a.content,
			})),
		});

		return {
			messageId: result.messageId,
			accepted: Array.isArray(result.accepted) ? result.accepted.map(String) : [],
			rejected: Array.isArray(result.rejected) ? result.rejected.map(String) : [],
		};
	}

	async verify(): Promise<boolean> {
		try {
			await this.transport.verify();
			return true;
		} catch {
			return false;
		}
	}
}
