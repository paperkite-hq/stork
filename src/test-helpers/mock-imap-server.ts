import { type Server, type Socket, createServer } from "node:net";

/**
 * Minimal mock IMAP server for testing ImapSync.
 *
 * Supports the subset of IMAP4rev1 commands that ImapFlow uses:
 * - LOGIN
 * - LIST
 * - SELECT
 * - UID FETCH
 * - FETCH
 * - LOGOUT
 * - CAPABILITY
 * - NAMESPACE
 * - NOOP
 */

export interface MockMailbox {
	path: string;
	name: string;
	delimiter: string;
	flags: string[];
	specialUse?: string;
	uidValidity: number;
	uidNext: number;
	messages: MockMessage[];
}

export interface MockMessage {
	uid: number;
	flags: string[];
	internalDate: string;
	/** Raw RFC 5322 message source */
	source: string;
}

export interface MockImapServerOptions {
	user: string;
	pass: string;
	mailboxes: MockMailbox[];
}

export class MockImapServer {
	private server: Server;
	private options: MockImapServerOptions;
	private port = 0;
	private connections: Socket[] = [];

	constructor(options: MockImapServerOptions) {
		this.options = options;
		this.server = createServer((socket) => this.handleConnection(socket));
	}

	async start(): Promise<number> {
		return new Promise((resolve, reject) => {
			this.server.listen(0, "127.0.0.1", () => {
				const addr = this.server.address();
				if (addr && typeof addr === "object") {
					this.port = addr.port;
					resolve(this.port);
				} else {
					reject(new Error("Failed to bind"));
				}
			});
			this.server.on("error", reject);
		});
	}

	async stop(): Promise<void> {
		for (const conn of this.connections) {
			conn.destroy();
		}
		this.connections = [];
		return new Promise((resolve) => {
			this.server.close(() => resolve());
		});
	}

	getPort(): number {
		return this.port;
	}

	/** Update mailbox data at runtime (e.g., add messages between syncs) */
	updateMailbox(path: string, updater: (mb: MockMailbox) => void): void {
		const mb = this.options.mailboxes.find((m) => m.path === path);
		if (mb) updater(mb);
	}

	private handleConnection(socket: Socket) {
		this.connections.push(socket);
		let selectedMailbox: MockMailbox | null = null;
		let authenticated = false;
		let buffer = "";
		let authTag = ""; // Tag for in-progress AUTHENTICATE command
		let awaitingAuthData = false;

		socket.on("close", () => {
			this.connections = this.connections.filter((s) => s !== socket);
		});

		// Suppress ECONNRESET from clients disconnecting abruptly
		socket.on("error", () => {});

		// Send greeting
		socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] Mock IMAP server ready\r\n");

		socket.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\r\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) continue;

				// Handle AUTHENTICATE PLAIN continuation data
				if (awaitingAuthData) {
					awaitingAuthData = false;
					const decoded = Buffer.from(line, "base64").toString();
					// PLAIN format: \0user\0pass
					const parts = decoded.split("\0");
					const user = parts[1] || "";
					const pass = parts[2] || "";
					if (user === this.options.user && pass === this.options.pass) {
						authenticated = true;
						socket.write(`${authTag} OK AUTHENTICATE completed\r\n`);
					} else {
						socket.write(`${authTag} NO AUTHENTICATE failed\r\n`);
					}
					authTag = "";
					continue;
				}

				this.processCommand(socket, line, {
					get authenticated() {
						return authenticated;
					},
					set authenticated(v: boolean) {
						authenticated = v;
					},
					get selectedMailbox() {
						return selectedMailbox;
					},
					set selectedMailbox(v: MockMailbox | null) {
						selectedMailbox = v;
					},
					startAuthPlain(tag: string) {
						authTag = tag;
						awaitingAuthData = true;
					},
				});
			}
		});

		socket.on("error", () => {
			// Ignore connection errors in tests
		});
	}

	private processCommand(
		socket: Socket,
		line: string,
		state: {
			authenticated: boolean;
			selectedMailbox: MockMailbox | null;
			startAuthPlain: (tag: string) => void;
		},
	) {
		// Parse IMAP command: TAG COMMAND [args...]
		const match = line.match(/^(\S+)\s+(.+)$/);
		if (!match) return;

		const tag = match[1];
		const rest = match[2];

		// Extract command name (first word of rest)
		const spaceIdx = rest.indexOf(" ");
		const command = (spaceIdx >= 0 ? rest.substring(0, spaceIdx) : rest).toUpperCase();
		const args = spaceIdx >= 0 ? rest.substring(spaceIdx + 1) : "";

		switch (command) {
			case "CAPABILITY":
				socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN NAMESPACE\r\n");
				socket.write(`${tag} OK CAPABILITY completed\r\n`);
				break;

			case "NOOP":
				socket.write(`${tag} OK NOOP completed\r\n`);
				break;

			case "NAMESPACE":
				socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n');
				socket.write(`${tag} OK NAMESPACE completed\r\n`);
				break;

			case "AUTHENTICATE":
				this.handleAuthenticate(socket, tag, args, state);
				break;

			case "LOGIN":
				this.handleLogin(socket, tag, args, state);
				break;

			case "LIST":
				this.handleList(socket, tag, args, state);
				break;

			case "LSUB":
				this.handleLsub(socket, tag, state);
				break;

			case "SELECT":
				this.handleSelect(socket, tag, args, state);
				break;

			case "UID":
				this.handleUid(socket, tag, args, state);
				break;

			case "FETCH":
				this.handleFetch(socket, tag, args, state, false);
				break;

			case "LOGOUT":
				socket.write("* BYE Mock IMAP server closing\r\n");
				socket.write(`${tag} OK LOGOUT completed\r\n`);
				socket.end();
				break;

			case "CLOSE":
				state.selectedMailbox = null;
				socket.write(`${tag} OK CLOSE completed\r\n`);
				break;

			case "EXPUNGE":
				this.handleExpunge(socket, tag, "", state, false);
				break;

			case "IDLE":
				// ImapFlow may use IDLE; just complete it immediately
				socket.write("+ idling\r\n");
				break;

			case "DONE":
				// End of IDLE — ignored as a bare command (no tag)
				break;

			default:
				socket.write(`${tag} BAD Unknown command ${command}\r\n`);
		}
	}

	private handleAuthenticate(
		socket: Socket,
		tag: string,
		args: string,
		state: {
			authenticated: boolean;
			startAuthPlain: (tag: string) => void;
		},
	) {
		const mechanism = args.trim().toUpperCase();
		if (mechanism === "PLAIN") {
			// Send continuation request — ImapFlow will send base64 credentials
			socket.write("+ \r\n");
			state.startAuthPlain(tag);
		} else {
			socket.write(`${tag} NO Unsupported mechanism ${mechanism}\r\n`);
		}
	}

	private handleLogin(
		socket: Socket,
		tag: string,
		args: string,
		state: { authenticated: boolean },
	) {
		// Parse: LOGIN user pass (may be quoted)
		const parts = this.parseArgs(args);
		if (parts.length >= 2 && parts[0] === this.options.user && parts[1] === this.options.pass) {
			state.authenticated = true;
			socket.write(`${tag} OK LOGIN completed\r\n`);
		} else {
			socket.write(`${tag} NO LOGIN failed\r\n`);
		}
	}

	private handleList(
		socket: Socket,
		tag: string,
		_args: string,
		state: { authenticated: boolean },
	) {
		if (!state.authenticated) {
			socket.write(`${tag} NO Not authenticated\r\n`);
			return;
		}

		for (const mb of this.options.mailboxes) {
			const flags = mb.flags.join(" ");
			const specialUse = mb.specialUse ? ` ${mb.specialUse}` : "";
			socket.write(`* LIST (${flags}${specialUse}) "${mb.delimiter}" "${mb.path}"\r\n`);
		}
		socket.write(`${tag} OK LIST completed\r\n`);
	}

	private handleLsub(socket: Socket, tag: string, state: { authenticated: boolean }) {
		if (!state.authenticated) {
			socket.write(`${tag} NO Not authenticated\r\n`);
			return;
		}

		for (const mb of this.options.mailboxes) {
			socket.write(`* LSUB () "${mb.delimiter}" "${mb.path}"\r\n`);
		}
		socket.write(`${tag} OK LSUB completed\r\n`);
	}

	private handleSelect(
		socket: Socket,
		tag: string,
		args: string,
		state: { authenticated: boolean; selectedMailbox: MockMailbox | null },
	) {
		if (!state.authenticated) {
			socket.write(`${tag} NO Not authenticated\r\n`);
			return;
		}

		const mailboxPath = this.unquote(args.trim());
		const mb = this.options.mailboxes.find((m) => m.path === mailboxPath);

		if (!mb) {
			socket.write(`${tag} NO Mailbox not found\r\n`);
			return;
		}

		state.selectedMailbox = mb;
		socket.write(`* ${mb.messages.length} EXISTS\r\n`);
		socket.write("* 0 RECENT\r\n");
		socket.write(`* OK [UIDVALIDITY ${mb.uidValidity}]\r\n`);
		socket.write(`* OK [UIDNEXT ${mb.uidNext}]\r\n`);
		socket.write("* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n");
		socket.write(`${tag} OK [READ-WRITE] SELECT completed\r\n`);
	}

	private handleUid(
		socket: Socket,
		tag: string,
		args: string,
		state: { authenticated: boolean; selectedMailbox: MockMailbox | null },
	) {
		const spaceIdx = args.indexOf(" ");
		const subCommand = (spaceIdx >= 0 ? args.substring(0, spaceIdx) : args).toUpperCase();
		const subArgs = spaceIdx >= 0 ? args.substring(spaceIdx + 1) : "";

		if (subCommand === "FETCH") {
			this.handleFetch(socket, tag, subArgs, state, true);
		} else if (subCommand === "STORE") {
			this.handleStore(socket, tag, subArgs, state, true);
		} else if (subCommand === "EXPUNGE") {
			this.handleExpunge(socket, tag, subArgs, state, true);
		} else {
			socket.write(`${tag} BAD Unknown UID subcommand\r\n`);
		}
	}

	private handleStore(
		socket: Socket,
		tag: string,
		args: string,
		state: { authenticated: boolean; selectedMailbox: MockMailbox | null },
		isUid: boolean,
	) {
		if (!state.authenticated || !state.selectedMailbox) {
			socket.write(`${tag} NO Not selected\r\n`);
			return;
		}

		// UID STORE <range> +FLAGS (\Deleted) or -FLAGS (\Deleted)
		const mb = state.selectedMailbox;
		const spaceIdx = args.indexOf(" ");
		const range = spaceIdx >= 0 ? args.substring(0, spaceIdx) : args;
		const flagArgs = spaceIdx >= 0 ? args.substring(spaceIdx + 1).toUpperCase() : "";

		const messages = this.resolveRange(mb.messages, range, isUid);
		const isAdd = flagArgs.includes("+FLAGS");
		const isRemove = flagArgs.includes("-FLAGS");

		for (const msg of messages) {
			const seqNum = mb.messages.indexOf(msg) + 1;
			if (isAdd && flagArgs.includes("\\DELETED")) {
				if (!msg.flags.includes("\\Deleted")) {
					msg.flags.push("\\Deleted");
				}
			} else if (isRemove && flagArgs.includes("\\DELETED")) {
				msg.flags = msg.flags.filter((f) => f !== "\\Deleted");
			}
			socket.write(`* ${seqNum} FETCH (UID ${msg.uid} FLAGS (${msg.flags.join(" ")}))\r\n`);
		}
		socket.write(`${tag} OK STORE completed\r\n`);
	}

	private handleExpunge(
		socket: Socket,
		tag: string,
		_uidRange: string,
		state: { authenticated: boolean; selectedMailbox: MockMailbox | null },
		_isUid: boolean,
	) {
		if (!state.authenticated || !state.selectedMailbox) {
			socket.write(`${tag} NO Not selected\r\n`);
			return;
		}

		const mb = state.selectedMailbox;
		const toDelete = mb.messages.filter((m) => m.flags.includes("\\Deleted"));
		for (const msg of toDelete) {
			const seqNum = mb.messages.indexOf(msg) + 1;
			mb.messages.splice(seqNum - 1, 1);
			socket.write(`* ${seqNum} EXPUNGE\r\n`);
		}
		socket.write(`${tag} OK EXPUNGE completed\r\n`);
	}

	private handleFetch(
		socket: Socket,
		tag: string,
		args: string,
		state: { authenticated: boolean; selectedMailbox: MockMailbox | null },
		isUid: boolean,
	) {
		if (!state.authenticated || !state.selectedMailbox) {
			socket.write(`${tag} NO Not selected\r\n`);
			return;
		}

		const mb = state.selectedMailbox;
		// Parse range (e.g., "1:*", "5:*", "1,2,3")
		const spaceIdx = args.indexOf(" ");
		const range = spaceIdx >= 0 ? args.substring(0, spaceIdx) : args;
		const fetchItems = spaceIdx >= 0 ? args.substring(spaceIdx + 1) : "";

		const messages = this.resolveRange(mb.messages, range, isUid);
		const wantSource = /BODY\[?\]?|RFC822/i.test(fetchItems);
		const wantFlags = /FLAGS/i.test(fetchItems);
		const wantEnvelope = /ENVELOPE/i.test(fetchItems);
		const wantBodyStructure = /BODYSTRUCTURE/i.test(fetchItems);
		const wantSize = /RFC822\.SIZE/i.test(fetchItems);

		for (const msg of messages) {
			const seqNum = mb.messages.indexOf(msg) + 1;
			const parts: string[] = [];

			if (isUid || /UID/i.test(fetchItems)) {
				parts.push(`UID ${msg.uid}`);
			}
			if (wantFlags) {
				parts.push(`FLAGS (${msg.flags.join(" ")})`);
			}
			if (wantEnvelope) {
				parts.push(`ENVELOPE ${this.buildEnvelope(msg)}`);
			}
			if (wantBodyStructure) {
				parts.push('BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 0 0)');
			}
			if (wantSize) {
				parts.push(`RFC822.SIZE ${msg.source.length}`);
			}
			if (wantSource) {
				const source = Buffer.from(msg.source);
				parts.push(`BODY[] {${source.length}}\r\n${source.toString()}`);
			}

			socket.write(`* ${seqNum} FETCH (${parts.join(" ")})\r\n`);
		}

		socket.write(`${tag} OK FETCH completed\r\n`);
	}

	private buildEnvelope(msg: MockMessage): string {
		// Parse basic headers from source for the envelope
		const headers = this.parseHeadersFromSource(msg.source);
		const date = headers.date || msg.internalDate;
		const subject = headers.subject || "";
		const from = headers.from || "unknown@test.local";
		const to = headers.to || "recipient@test.local";
		const messageId = headers["message-id"] || `<${msg.uid}@mock>`;
		const inReplyTo = headers["in-reply-to"] || "NIL";

		const formatAddr = (addr: string) => {
			const m = addr.match(/^(?:"?([^"]*)"?\s+)?<?([^@>]+)@([^>]+)>?$/);
			if (m) {
				const name = m[1] ? `"${m[1]}"` : "NIL";
				return `((${name} NIL "${m[2]}" "${m[3]}"))`;
			}
			const simple = addr.match(/([^@]+)@(.+)/);
			if (simple) return `((NIL NIL "${simple[1]}" "${simple[2]}"))`;
			return "NIL";
		};

		return `("${date}" "${subject}" ${formatAddr(from)} ${formatAddr(from)} ${formatAddr(from)} ${formatAddr(to)} NIL NIL ${inReplyTo === "NIL" ? "NIL" : `"${inReplyTo}"`} "${messageId}")`;
	}

	private parseHeadersFromSource(source: string): Record<string, string> {
		const headers: Record<string, string> = {};
		const headerEnd = source.indexOf("\r\n\r\n");
		const headerSection = headerEnd >= 0 ? source.substring(0, headerEnd) : source;
		const lines = headerSection.split("\r\n");

		let currentKey = "";
		let currentValue = "";

		for (const line of lines) {
			if (line.startsWith(" ") || line.startsWith("\t")) {
				// Continuation of previous header
				currentValue += ` ${line.trim()}`;
			} else {
				if (currentKey) {
					headers[currentKey.toLowerCase()] = currentValue;
				}
				const colonIdx = line.indexOf(":");
				if (colonIdx >= 0) {
					currentKey = line.substring(0, colonIdx).trim();
					currentValue = line.substring(colonIdx + 1).trim();
				}
			}
		}
		if (currentKey) {
			headers[currentKey.toLowerCase()] = currentValue;
		}

		return headers;
	}

	private resolveRange(messages: MockMessage[], range: string, isUid: boolean): MockMessage[] {
		if (messages.length === 0) return [];

		const results: MockMessage[] = [];
		const parts = range.split(",");

		for (const part of parts) {
			const colonIdx = part.indexOf(":");
			if (colonIdx >= 0) {
				const startStr = part.substring(0, colonIdx);
				const endStr = part.substring(colonIdx + 1);
				const start = Number.parseInt(startStr, 10);
				const end = endStr === "*" ? Number.MAX_SAFE_INTEGER : Number.parseInt(endStr, 10);

				for (const msg of messages) {
					const val = isUid ? msg.uid : messages.indexOf(msg) + 1;
					if (val >= start && val <= end && !results.includes(msg)) {
						results.push(msg);
					}
				}
			} else {
				const num = Number.parseInt(part, 10);
				for (const msg of messages) {
					const val = isUid ? msg.uid : messages.indexOf(msg) + 1;
					if (val === num && !results.includes(msg)) {
						results.push(msg);
					}
				}
			}
		}

		return results;
	}

	private parseArgs(input: string): string[] {
		const args: string[] = [];
		let current = "";
		let inQuote = false;

		for (const char of input) {
			if (char === '"') {
				inQuote = !inQuote;
			} else if (char === " " && !inQuote) {
				if (current) args.push(current);
				current = "";
			} else {
				current += char;
			}
		}
		if (current) args.push(current);
		return args;
	}

	private unquote(s: string): string {
		if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
		return s;
	}
}

/** Helper to create a well-formed RFC 5322 email source */
export function buildRawEmail(opts: {
	from: string;
	to: string;
	subject: string;
	body: string;
	date?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	html?: string;
}): string {
	const lines: string[] = [];
	lines.push(`From: ${opts.from}`);
	lines.push(`To: ${opts.to}`);
	lines.push(`Subject: ${opts.subject}`);
	if (opts.date) lines.push(`Date: ${opts.date}`);
	if (opts.messageId) lines.push(`Message-ID: ${opts.messageId}`);
	if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
	if (opts.references) lines.push(`References: ${opts.references}`);

	if (opts.html) {
		const boundary = "----=_Part_Test_Boundary";
		lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
		lines.push("");
		lines.push(`--${boundary}`);
		lines.push("Content-Type: text/plain; charset=utf-8");
		lines.push("");
		lines.push(opts.body);
		lines.push(`--${boundary}`);
		lines.push("Content-Type: text/html; charset=utf-8");
		lines.push("");
		lines.push(opts.html);
		lines.push(`--${boundary}--`);
	} else {
		lines.push("Content-Type: text/plain; charset=utf-8");
		lines.push("");
		lines.push(opts.body);
	}

	return lines.join("\r\n");
}

/** Helper to create an RFC 5322 email with a file attachment */
export function buildRawEmailWithAttachment(opts: {
	from: string;
	to: string;
	subject: string;
	body: string;
	date?: string;
	messageId?: string;
	attachment: {
		filename: string;
		contentType: string;
		data: Buffer;
		contentId?: string;
	};
}): string {
	const boundary = "=_TestMixed_Boundary";
	const lines: string[] = [];
	lines.push(`From: ${opts.from}`);
	lines.push(`To: ${opts.to}`);
	lines.push(`Subject: ${opts.subject}`);
	if (opts.date) lines.push(`Date: ${opts.date}`);
	if (opts.messageId) lines.push(`Message-ID: ${opts.messageId}`);
	lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
	lines.push("");
	lines.push(`--${boundary}`);
	lines.push("Content-Type: text/plain; charset=utf-8");
	lines.push("");
	lines.push(opts.body);
	lines.push(`--${boundary}`);
	lines.push(`Content-Type: ${opts.attachment.contentType}; name="${opts.attachment.filename}"`);
	lines.push(`Content-Disposition: attachment; filename="${opts.attachment.filename}"`);
	if (opts.attachment.contentId) {
		lines.push(`Content-ID: <${opts.attachment.contentId}>`);
	}
	lines.push("Content-Transfer-Encoding: base64");
	lines.push("");
	lines.push(opts.attachment.data.toString("base64"));
	lines.push(`--${boundary}--`);
	return lines.join("\r\n");
}
