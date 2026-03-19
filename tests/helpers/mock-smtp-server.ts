import { type Server, type Socket, createServer } from "node:net";

/**
 * Minimal mock SMTP server for testing email sending.
 *
 * Implements enough of RFC 5321 to accept messages via Nodemailer:
 * - EHLO/HELO
 * - AUTH PLAIN / AUTH LOGIN
 * - MAIL FROM
 * - RCPT TO
 * - DATA
 * - QUIT
 */

export interface CapturedMessage {
	from: string;
	to: string[];
	data: string;
	auth?: { user: string; pass: string };
}

export interface MockSmtpServerOptions {
	user?: string;
	pass?: string;
	/** If true, require AUTH before accepting mail */
	requireAuth?: boolean;
}

export class MockSmtpServer {
	private server: Server;
	private options: MockSmtpServerOptions;
	private port = 0;
	private connections: Socket[] = [];
	public messages: CapturedMessage[] = [];

	constructor(options: MockSmtpServerOptions = {}) {
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

	/** Clear captured messages */
	reset(): void {
		this.messages = [];
	}

	private handleConnection(socket: Socket) {
		this.connections.push(socket);

		let authenticated = false;
		let authUser = "";
		let authPass = "";
		let mailFrom = "";
		let rcptTo: string[] = [];
		let inData = false;
		let dataBuffer = "";
		let inAuthLogin = false;
		let authLoginStep = 0;
		let buffer = "";

		socket.on("close", () => {
			this.connections = this.connections.filter((s) => s !== socket);
		});

		socket.on("error", () => {});

		// Send greeting
		socket.write("220 mock-smtp.test ESMTP Mock\r\n");

		socket.on("data", (chunk) => {
			buffer += chunk.toString();

			if (inData) {
				const endIdx = buffer.indexOf("\r\n.\r\n");
				if (endIdx >= 0) {
					dataBuffer += buffer.substring(0, endIdx);
					buffer = buffer.substring(endIdx + 5);
					inData = false;

					this.messages.push({
						from: mailFrom,
						to: [...rcptTo],
						data: dataBuffer,
						auth: authenticated ? { user: authUser, pass: authPass } : undefined,
					});

					mailFrom = "";
					rcptTo = [];
					dataBuffer = "";
					socket.write("250 OK message accepted\r\n");
				} else {
					dataBuffer += buffer;
					buffer = "";
				}
				return;
			}

			const lines = buffer.split("\r\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) continue;

				if (inAuthLogin) {
					this.handleAuthLoginStep(socket, line, authLoginStep, {
						get authenticated() {
							return authenticated;
						},
						set authenticated(v) {
							authenticated = v;
						},
						get authUser() {
							return authUser;
						},
						set authUser(v) {
							authUser = v;
						},
						get authPass() {
							return authPass;
						},
						set authPass(v) {
							authPass = v;
						},
					});
					authLoginStep++;
					if (authLoginStep >= 2) {
						inAuthLogin = false;
						authLoginStep = 0;
					}
					continue;
				}

				const cmd = line.substring(0, 4).toUpperCase();

				if (cmd === "EHLO" || cmd === "HELO") {
					socket.write("250-mock-smtp.test\r\n");
					if (this.options.requireAuth) {
						socket.write("250-AUTH PLAIN LOGIN\r\n");
					}
					socket.write("250-8BITMIME\r\n");
					socket.write("250 OK\r\n");
				} else if (line.toUpperCase().startsWith("AUTH PLAIN")) {
					const encoded = line.substring(11).trim();
					if (encoded) {
						const decoded = Buffer.from(encoded, "base64").toString();
						const parts = decoded.split("\0");
						authUser = parts[1] || parts[0];
						authPass = parts[2] || parts[1];
						if (
							this.options.user &&
							(authUser !== this.options.user || authPass !== this.options.pass)
						) {
							socket.write("535 Authentication failed\r\n");
						} else {
							authenticated = true;
							socket.write("235 Authentication successful\r\n");
						}
					} else {
						socket.write("334\r\n");
					}
				} else if (line.toUpperCase().startsWith("AUTH LOGIN")) {
					inAuthLogin = true;
					authLoginStep = 0;
					socket.write("334 VXNlcm5hbWU6\r\n"); // "Username:" base64
				} else if (line.toUpperCase().startsWith("MAIL FROM:")) {
					if (this.options.requireAuth && !authenticated) {
						socket.write("530 Authentication required\r\n");
						continue;
					}
					mailFrom = this.extractAddress(line.substring(10));
					socket.write("250 OK\r\n");
				} else if (line.toUpperCase().startsWith("RCPT TO:")) {
					rcptTo.push(this.extractAddress(line.substring(8)));
					socket.write("250 OK\r\n");
				} else if (cmd === "DATA") {
					socket.write("354 Start mail input\r\n");
					inData = true;
					dataBuffer = "";
				} else if (cmd === "QUIT") {
					socket.write("221 Bye\r\n");
					socket.end();
				} else if (cmd === "RSET") {
					mailFrom = "";
					rcptTo = [];
					socket.write("250 OK\r\n");
				} else if (cmd === "NOOP") {
					socket.write("250 OK\r\n");
				} else {
					socket.write("500 Unrecognized command\r\n");
				}
			}
		});
	}

	private handleAuthLoginStep(
		socket: Socket,
		line: string,
		step: number,
		state: { authenticated: boolean; authUser: string; authPass: string },
	) {
		const decoded = Buffer.from(line, "base64").toString();
		if (step === 0) {
			state.authUser = decoded;
			socket.write("334 UGFzc3dvcmQ6\r\n"); // "Password:" base64
		} else {
			state.authPass = decoded;
			if (
				this.options.user &&
				(state.authUser !== this.options.user || state.authPass !== this.options.pass)
			) {
				socket.write("535 Authentication failed\r\n");
			} else {
				state.authenticated = true;
				socket.write("235 Authentication successful\r\n");
			}
		}
	}

	private extractAddress(s: string): string {
		const match = s.match(/<([^>]+)>/);
		return match ? match[1] : s.trim();
	}
}
