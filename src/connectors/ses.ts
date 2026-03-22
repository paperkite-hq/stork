import type { OutgoingMessage, SendConnector, SendResult } from "./types.js";

export interface SesConfig {
	/** AWS region (e.g., "us-east-1") */
	region: string;
	/** AWS credentials. If omitted, uses the default credential chain (env vars, instance profile, etc.) */
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
	};
}

/**
 * Lazy-loaded AWS SES v2 client types.
 * We dynamically import @aws-sdk/client-sesv2 to keep it an optional dependency —
 * users who don't need SES don't need to install the AWS SDK.
 */
interface SesClient {
	send(command: unknown): Promise<unknown>;
	destroy(): void;
}

/**
 * SendConnector implementation backed by AWS SES v2.
 *
 * Uses the raw email sending API (SendEmail with Raw content) so we get full
 * control over MIME structure, threading headers, and attachments. The raw
 * message is built with Nodemailer's createTransport({ streamTransport: true })
 * which generates the RFC 5322 message without actually sending it.
 *
 * Requires @aws-sdk/client-sesv2 as a peer dependency. If not installed,
 * construction succeeds but send()/verify() will throw a clear error.
 */
export class SesSendConnector implements SendConnector {
	readonly name = "ses";
	private config: SesConfig;
	private client: SesClient | null = null;

	constructor(config: SesConfig) {
		this.config = config;
	}

	private async getClient(): Promise<SesClient> {
		if (this.client) return this.client;

		try {
			const sdk = await import("@aws-sdk/client-sesv2");
			const clientConfig: Record<string, unknown> = {
				region: this.config.region,
			};
			if (this.config.credentials) {
				clientConfig.credentials = this.config.credentials;
			}
			this.client = new sdk.SESv2Client(clientConfig) as unknown as SesClient;
			return this.client;
		} catch {
			throw new Error(
				"@aws-sdk/client-sesv2 is required for the SES connector. " +
					"Install it with: npm install @aws-sdk/client-sesv2",
			);
		}
	}

	async send(message: OutgoingMessage): Promise<SendResult> {
		const client = await this.getClient();
		const rawMessage = await buildRawMessage(message);

		const sdk = await import("@aws-sdk/client-sesv2");
		const command = new sdk.SendEmailCommand({
			Content: {
				Raw: {
					Data: rawMessage,
				},
			},
		});

		const response = (await client.send(command)) as { MessageId?: string };
		const allRecipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];

		return {
			messageId: response.MessageId ?? "",
			accepted: allRecipients,
			rejected: [],
		};
	}

	async verify(): Promise<boolean> {
		try {
			const client = await this.getClient();
			const sdk = await import("@aws-sdk/client-sesv2");
			const command = new sdk.GetAccountCommand({});
			await client.send(command);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Destroys the underlying SES client, freeing resources.
	 */
	destroy(): void {
		if (this.client) {
			this.client.destroy();
			this.client = null;
		}
	}
}

/**
 * Builds a raw RFC 5322 message using Nodemailer's stream transport.
 * This generates the full MIME message (headers, body, attachments)
 * without actually sending it over SMTP.
 */
async function buildRawMessage(message: OutgoingMessage): Promise<Uint8Array> {
	const { createTransport } = await import("nodemailer");
	const transport = createTransport({ streamTransport: true, buffer: true });

	const result = await transport.sendMail({
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

	return result.message as Uint8Array;
}
