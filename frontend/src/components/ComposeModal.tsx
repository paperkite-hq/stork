import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, Message } from "../api";
import { useFocusTrap } from "../hooks";
import { parseAddressField } from "../utils";
import { XIcon } from "./Icons";

export type ComposeMode =
	| { type: "new" }
	| { type: "reply"; original: Message }
	| { type: "reply-all"; original: Message }
	| { type: "forward"; original: Message };

const DRAFT_PREFIX = "stork-compose-draft";

type ComposeFormat = "plain" | "html";

interface Draft {
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	body: string;
	htmlBody?: string;
	format?: ComposeFormat;
}

/** Build a localStorage key that is unique per compose mode + original message */
function draftKey(mode: ComposeMode): string {
	if (mode.type === "new") return DRAFT_PREFIX;
	return `${DRAFT_PREFIX}:${mode.type}:${mode.original.id}`;
}

function saveDraft(key: string, draft: Draft) {
	try {
		localStorage.setItem(key, JSON.stringify(draft));
	} catch {
		// localStorage unavailable — ignore
	}
}

function loadDraft(key: string): Draft | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as Draft;
	} catch {
		return null;
	}
}

function clearDraft(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

interface ComposeModalProps {
	mode: ComposeMode;
	accounts?: Account[];
	selectedAccountId?: number | null;
	onClose: () => void;
	onSend: (data: {
		accountId?: number;
		to: string;
		cc: string;
		bcc: string;
		subject: string;
		body: string;
		htmlBody?: string;
	}) => void | Promise<void>;
}

/** Validate a comma-separated list of email addresses.
 *  Accepts "user@domain.tld" or "Name <user@domain.tld>" formats. */
function validateEmails(raw: string): string | null {
	if (!raw.trim()) return "At least one recipient is required";
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	for (const part of parts) {
		// Extract email from "Name <email>" or bare "email"
		const match = part.match(/<([^>]+)>/) || [null, part];
		const email = (match[1] ?? "").trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return `Invalid email address: ${email || part}`;
		}
	}
	return null;
}

function buildReplySubject(subject: string | null): string {
	if (!subject) return "Re: (no subject)";
	if (/^re:/i.test(subject)) return subject;
	return `Re: ${subject}`;
}

function buildForwardSubject(subject: string | null): string {
	if (!subject) return "Fwd: (no subject)";
	if (/^fwd:/i.test(subject)) return subject;
	return `Fwd: ${subject}`;
}

function buildReplyBody(msg: Message): string {
	const d = msg.date ? new Date(msg.date) : null;
	const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "unknown date";
	const header = `\n\nOn ${date}, ${msg.from_name || msg.from_address} wrote:\n`;
	const body = msg.text_body || "";
	const quoted = body
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return header + quoted;
}

function buildReplyHtmlBody(msg: Message): string {
	const d = msg.date ? new Date(msg.date) : null;
	const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "unknown date";
	const sender = msg.from_name || msg.from_address;
	const quotedContent = msg.html_body || escapeHtml(msg.text_body || "").replace(/\n/g, "<br>");
	return `<br><br><div>On ${escapeHtml(date)}, ${escapeHtml(sender)} wrote:</div><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedContent}</blockquote>`;
}

function buildForwardHtmlBody(msg: Message): string {
	const from = msg.from_name
		? `${escapeHtml(msg.from_name)} &lt;${escapeHtml(msg.from_address || "unknown")}&gt;`
		: escapeHtml(msg.from_address || "unknown");
	const date = new Date(msg.date).toLocaleString();
	const forwardedContent = msg.html_body || escapeHtml(msg.text_body || "").replace(/\n/g, "<br>");
	return `<br><br><div>---------- Forwarded message ----------</div><div>From: ${from}</div><div>Date: ${escapeHtml(date)}</div><div>Subject: ${escapeHtml(msg.subject || "(no subject)")}</div><div>To: ${escapeHtml(msg.to_addresses || "")}</div><br>${forwardedContent}`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Convert HTML to plain text (strips tags, decodes entities) */
function htmlToPlainText(html: string): string {
	const div = document.createElement("div");
	div.innerHTML = html;
	// Convert <br> and block elements to newlines
	for (const br of div.querySelectorAll("br")) {
		br.replaceWith("\n");
	}
	for (const el of div.querySelectorAll("p, div, blockquote")) {
		el.prepend(document.createTextNode("\n"));
		el.append(document.createTextNode("\n"));
	}
	return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Convert plain text to simple HTML */
function plainTextToHtml(text: string): string {
	return escapeHtml(text).replace(/\n/g, "<br>");
}

/** Determine initial format: HTML if replying to/forwarding an HTML message */
function getInitialFormat(mode: ComposeMode, saved: Draft | null): ComposeFormat {
	if (saved?.format) return saved.format;
	if (mode.type !== "new" && mode.original.html_body) return "html";
	return "plain";
}

function buildReplyAllCc(msg: Message, userEmail?: string): string {
	// Include all To and CC addresses except the sender (who goes in To)
	// and the current user (who is sending the reply)
	const exclude = new Set<string>();
	if (msg.from_address) exclude.add(msg.from_address.toLowerCase());
	if (userEmail) exclude.add(userEmail.toLowerCase());

	const addresses: string[] = [];
	for (const addr of parseAddressField(msg.to_addresses)) {
		// Extract bare email for comparison (handles "Name <email>" format)
		const email = (addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase();
		if (!exclude.has(email)) {
			addresses.push(addr);
		}
	}
	for (const addr of parseAddressField(msg.cc_addresses)) {
		const email = (addr.match(/<([^>]+)>/)?.[1] ?? addr).toLowerCase();
		if (!exclude.has(email)) {
			addresses.push(addr);
		}
	}
	return addresses.join(", ");
}

/** Expand/collapse icon for the compose window */
function ExpandIcon({ expanded }: { expanded: boolean }) {
	if (expanded) {
		// Collapse icon (shrink)
		return (
			<svg
				className="w-4 h-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<title>Collapse</title>
				<polyline points="4 14 10 14 10 20" />
				<polyline points="20 10 14 10 14 4" />
				<line x1="14" y1="10" x2="21" y2="3" />
				<line x1="3" y1="21" x2="10" y2="14" />
			</svg>
		);
	}
	// Expand icon (grow)
	return (
		<svg
			className="w-4 h-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<title>Expand</title>
			<polyline points="15 3 21 3 21 9" />
			<polyline points="9 21 3 21 3 15" />
			<line x1="21" y1="3" x2="14" y2="10" />
			<line x1="3" y1="21" x2="10" y2="14" />
		</svg>
	);
}

export function ComposeModal({
	mode,
	accounts,
	selectedAccountId,
	onClose,
	onSend,
}: ComposeModalProps) {
	const currentDraftKey = draftKey(mode);
	const userEmail = accounts?.find((a) => a.id === (selectedAccountId ?? accounts[0]?.id))?.email;

	const [fromAccountId, setFromAccountId] = useState<number | undefined>(
		selectedAccountId ?? undefined,
	);
	const [to, setTo] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return saved.to;
		if (mode.type === "reply" || mode.type === "reply-all") return mode.original.from_address;
		return "";
	});
	const [cc, setCc] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return saved.cc;
		if (mode.type === "reply-all") return buildReplyAllCc(mode.original, userEmail);
		return "";
	});
	const [bcc, setBcc] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return saved.bcc;
		return "";
	});
	const [subject, setSubject] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return saved.subject;
		if (mode.type === "reply" || mode.type === "reply-all")
			return buildReplySubject(mode.original.subject);
		if (mode.type === "forward") return buildForwardSubject(mode.original.subject);
		return "";
	});
	const [body, setBody] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return saved.body;
		if (mode.type === "reply" || mode.type === "reply-all") return buildReplyBody(mode.original);
		if (mode.type === "forward") {
			const msg = mode.original;
			const from = msg.from_name
				? `${msg.from_name} <${msg.from_address || "unknown"}>`
				: msg.from_address || "unknown";
			return `\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${new Date(msg.date).toLocaleString()}\nSubject: ${msg.subject || "(no subject)"}\nTo: ${msg.to_addresses || ""}\n\n${msg.text_body || ""}`;
		}
		return "";
	});
	const [htmlBody, setHtmlBody] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved?.htmlBody) return saved.htmlBody;
		if (mode.type === "reply" || mode.type === "reply-all")
			return buildReplyHtmlBody(mode.original);
		if (mode.type === "forward") return buildForwardHtmlBody(mode.original);
		return "";
	});
	const [format, setFormat] = useState<ComposeFormat>(() => {
		const saved = loadDraft(currentDraftKey);
		return getInitialFormat(mode, saved);
	});
	const [showCc, setShowCc] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		if (saved) return !!saved.cc;
		if (mode.type === "reply-all") return buildReplyAllCc(mode.original, userEmail).length > 0;
		return false;
	});
	const [showBcc, setShowBcc] = useState(() => {
		const saved = loadDraft(currentDraftKey);
		return !!saved?.bcc;
	});
	const [expanded, setExpanded] = useState(false);
	const [sending, setSending] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [showFormatWarning, setShowFormatWarning] = useState(false);
	const pendingFormatRef = useRef<ComposeFormat | null>(null);
	const toInputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	// Auto-focus the To field on mount
	useEffect(() => {
		const timer = setTimeout(() => {
			// Don't steal focus if the user has already clicked into another field
			const modal = toInputRef.current?.closest('[role="dialog"]');
			if (
				modal?.contains(document.activeElement) &&
				document.activeElement !== toInputRef.current
			) {
				return;
			}
			toInputRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, []);

	// Set initial HTML content in the editor
	useEffect(() => {
		if (format === "html" && editorRef.current && !editorRef.current.innerHTML) {
			editorRef.current.innerHTML = htmlBody;
		}
	}, [format, htmlBody]);

	// Auto-save draft for all compose modes
	useEffect(() => {
		saveDraft(currentDraftKey, { to, cc, bcc, subject, body, htmlBody, format });
	}, [currentDraftKey, to, cc, bcc, subject, body, htmlBody, format]);

	const getEditorHtml = useCallback((): string => {
		return editorRef.current?.innerHTML || "";
	}, []);

	const handleSend = useCallback(async () => {
		const toErr = validateEmails(to);
		if (toErr) {
			setValidationError(toErr);
			return;
		}
		if (cc.trim()) {
			const ccErr = validateEmails(cc);
			if (ccErr) {
				setValidationError(ccErr);
				return;
			}
		}
		if (bcc.trim()) {
			const bccErr = validateEmails(bcc);
			if (bccErr) {
				setValidationError(bccErr);
				return;
			}
		}
		setValidationError(null);
		setSending(true);
		try {
			const currentHtml = format === "html" ? getEditorHtml() : undefined;
			const textBody = format === "html" ? htmlToPlainText(currentHtml || "") : body;
			await onSend({
				accountId: fromAccountId,
				to: to.trim(),
				cc: cc.trim(),
				bcc: bcc.trim(),
				subject,
				body: textBody,
				htmlBody: currentHtml,
			});
			clearDraft(currentDraftKey);
		} catch (err) {
			// Send failed — keep the draft and let the user retry
			setSending(false);
			setValidationError(err instanceof Error ? err.message : "Failed to send message");
		}
	}, [to, cc, bcc, subject, body, format, fromAccountId, onSend, currentDraftKey, getEditorHtml]);

	const handleDiscard = useCallback(() => {
		clearDraft(currentDraftKey);
		onClose();
	}, [currentDraftKey, onClose]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const requestFormatSwitch = useCallback(
		(newFormat: ComposeFormat) => {
			if (newFormat === format) return;
			// Warn about formatting loss when switching from HTML to plain text
			const hasContent =
				format === "html"
					? (getEditorHtml() || "")
							.replace(/<br\s*\/?>/gi, "")
							.replace(/<[^>]*>/g, "")
							.trim().length > 0
					: body.trim().length > 0;
			if (hasContent && format === "html" && newFormat === "plain") {
				pendingFormatRef.current = newFormat;
				setShowFormatWarning(true);
			} else {
				switchFormat(newFormat);
			}
		},
		[format, body, getEditorHtml],
	);

	const switchFormat = useCallback(
		(newFormat: ComposeFormat) => {
			if (newFormat === "html" && format === "plain") {
				// Convert plain text body to HTML
				const html = plainTextToHtml(body);
				setHtmlBody(html);
				setFormat("html");
				// Set content in editor after it renders
				requestAnimationFrame(() => {
					if (editorRef.current) {
						editorRef.current.innerHTML = html;
					}
				});
			} else if (newFormat === "plain" && format === "html") {
				// Convert HTML to plain text
				const currentHtml = getEditorHtml();
				setBody(htmlToPlainText(currentHtml));
				setFormat("plain");
			}
			setShowFormatWarning(false);
			pendingFormatRef.current = null;
		},
		[format, body, getEditorHtml],
	);

	const handleEditorInput = useCallback(() => {
		if (editorRef.current) {
			setHtmlBody(editorRef.current.innerHTML);
		}
	}, []);

	// Auto-escalate: when user uses a formatting control while in plain text mode,
	// automatically switch to HTML
	const handleToolbarAction = useCallback(
		(command: string, arg?: string) => {
			if (format === "plain") {
				// Switch to HTML first, then apply the command
				const html = plainTextToHtml(body);
				setHtmlBody(html);
				setFormat("html");
				requestAnimationFrame(() => {
					if (editorRef.current) {
						editorRef.current.innerHTML = html;
						editorRef.current.focus();
						document.execCommand(command, false, arg);
					}
				});
			} else {
				document.execCommand(command, false, arg);
			}
		},
		[format, body],
	);

	const modeLabel =
		mode.type === "reply"
			? "Reply"
			: mode.type === "reply-all"
				? "Reply All"
				: mode.type === "forward"
					? "Forward"
					: "New Message";

	const containerClass = expanded
		? "w-full h-full bg-white dark:bg-gray-900 sm:rounded-xl shadow-2xl flex flex-col"
		: "w-full max-w-2xl bg-white dark:bg-gray-900 rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col max-h-[80vh]";

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30"
			role="dialog"
			aria-modal="true"
			aria-label={modeLabel}
			onClick={(e) => {
				if (e.target === e.currentTarget) handleDiscard();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") handleDiscard();
			}}
		>
			<div
				className={containerClass}
				onKeyDown={handleKeyDown}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
					<h3 className="font-semibold">{modeLabel}</h3>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
						>
							<ExpandIcon expanded={expanded} />
						</button>
						<button
							type="button"
							onClick={handleDiscard}
							className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
						>
							<XIcon className="w-4 h-4" />
						</button>
					</div>
				</div>

				{/* Fields */}
				<div className="px-4 py-2 space-y-2 border-b border-gray-100 dark:border-gray-800">
					{accounts && accounts.length > 1 && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-from" className="text-sm text-gray-500 w-14 flex-shrink-0">
								From
							</label>
							<select
								id="compose-from"
								value={fromAccountId ?? ""}
								onChange={(e) => setFromAccountId(Number(e.target.value) || undefined)}
								className="flex-1 bg-transparent text-sm outline-none border-none dark:text-gray-100"
							>
								{accounts.map((a) => (
									<option key={a.id} value={a.id} className="bg-white dark:bg-gray-900">
										{a.name} &lt;{a.email}&gt;
									</option>
								))}
							</select>
						</div>
					)}
					<div className="flex items-center gap-2">
						<label htmlFor="compose-to" className="text-sm text-gray-500 w-14">
							To
						</label>
						<input
							ref={toInputRef}
							id="compose-to"
							type="text"
							value={to}
							onChange={(e) => {
								setTo(e.target.value);
								if (validationError) setValidationError(null);
							}}
							className="flex-1 bg-transparent text-sm outline-none"
							placeholder="recipient@example.com"
						/>
						<div className="flex items-center gap-1">
							{!showCc && (
								<button
									type="button"
									onClick={() => setShowCc(true)}
									className="text-xs text-gray-400 hover:text-gray-600"
								>
									Cc
								</button>
							)}
							{!showBcc && (
								<button
									type="button"
									onClick={() => setShowBcc(true)}
									className="text-xs text-gray-400 hover:text-gray-600"
								>
									Bcc
								</button>
							)}
						</div>
					</div>
					{showCc && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-cc" className="text-sm text-gray-500 w-14">
								Cc
							</label>
							<input
								id="compose-cc"
								type="text"
								value={cc}
								onChange={(e) => {
									setCc(e.target.value);
									if (validationError) setValidationError(null);
								}}
								className="flex-1 bg-transparent text-sm outline-none"
								placeholder="cc@example.com"
							/>
						</div>
					)}
					{showBcc && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-bcc" className="text-sm text-gray-500 w-14">
								Bcc
							</label>
							<input
								id="compose-bcc"
								type="text"
								value={bcc}
								onChange={(e) => {
									setBcc(e.target.value);
									if (validationError) setValidationError(null);
								}}
								className="flex-1 bg-transparent text-sm outline-none"
								placeholder="bcc@example.com"
							/>
						</div>
					)}
					<div className="flex items-center gap-2">
						<label htmlFor="compose-subject" className="text-sm text-gray-500 w-14">
							Subject
						</label>
						<input
							id="compose-subject"
							type="text"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							className="flex-1 bg-transparent text-sm outline-none"
						/>
					</div>
				</div>

				{/* Formatting toolbar (visible in HTML mode, clickable in plain to auto-escalate) */}
				<div className="flex items-center gap-0.5 px-4 py-1 border-b border-gray-100 dark:border-gray-800">
					<ToolbarActionButton
						label="Bold"
						display="B"
						bold
						command="bold"
						onAction={handleToolbarAction}
					/>
					<ToolbarActionButton
						label="Italic"
						display="I"
						italic
						command="italic"
						onAction={handleToolbarAction}
					/>
					<ToolbarActionButton
						label="Underline"
						display="U"
						underline
						command="underline"
						onAction={handleToolbarAction}
					/>
					<div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
					<ToolbarActionButton
						label="Bulleted list"
						display="&bull;"
						command="insertUnorderedList"
						onAction={handleToolbarAction}
					/>
					<ToolbarActionButton
						label="Numbered list"
						display="1."
						command="insertOrderedList"
						onAction={handleToolbarAction}
					/>
					<div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
					<LinkButton onAction={handleToolbarAction} />
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => requestFormatSwitch(format === "html" ? "plain" : "html")}
						className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
						title={format === "html" ? "Switch to plain text" : "Switch to rich text"}
					>
						{format === "html" ? "Plain text" : "Rich text"}
					</button>
				</div>

				{/* Body */}
				{format === "plain" ? (
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						className={`flex-1 p-4 bg-transparent text-sm resize-none outline-none ${expanded ? "min-h-[400px]" : "min-h-[200px]"}`}
						placeholder="Write your message…"
					/>
				) : (
					<div
						ref={editorRef}
						contentEditable
						tabIndex={0}
						onInput={handleEditorInput}
						className={`flex-1 p-4 bg-transparent text-sm outline-none overflow-y-auto ${expanded ? "min-h-[400px]" : "min-h-[200px]"}`}
						data-placeholder="Write your message…"
						role="textbox"
						aria-label="Message body"
						style={{
							minHeight: expanded ? "400px" : "200px",
						}}
					/>
				)}

				{/* Format switch warning */}
				{showFormatWarning && (
					<div className="px-4 py-2 text-xs bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800 flex items-center justify-between">
						<span className="text-amber-700 dark:text-amber-400">
							Switching to plain text will remove formatting. Continue?
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => {
									setShowFormatWarning(false);
									pendingFormatRef.current = null;
								}}
								className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									if (pendingFormatRef.current) {
										switchFormat(pendingFormatRef.current);
									}
								}}
								className="px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded font-medium"
							>
								Switch
							</button>
						</div>
					</div>
				)}

				{/* Validation error */}
				{validationError && (
					<div className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-800">
						{validationError}
					</div>
				)}

				{/* Footer */}
				<div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
					<div className="text-xs text-gray-400">
						<kbd className="bg-gray-100 dark:bg-gray-800 px-1 rounded">⌘+Enter</kbd> to send
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleDiscard}
							className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
						>
							Discard
						</button>
						<button
							type="button"
							onClick={handleSend}
							disabled={!to.trim() || sending}
							className="px-4 py-1.5 text-sm bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
						>
							{sending ? "Sending…" : "Send"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

/** Toolbar button that auto-escalates to HTML mode */
function ToolbarActionButton({
	label,
	display,
	command,
	bold,
	italic,
	underline,
	onAction,
}: {
	label: string;
	display: string;
	command: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	onAction: (command: string, arg?: string) => void;
}) {
	let className =
		"px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400";
	if (bold) className += " font-bold";
	if (italic) className += " italic";
	if (underline) className += " underline";

	return (
		<button
			type="button"
			title={label}
			onMouseDown={(e) => {
				e.preventDefault();
				onAction(command);
			}}
			className={className}
			dangerouslySetInnerHTML={{ __html: display }}
		/>
	);
}

/** Link insertion button */
function LinkButton({ onAction }: { onAction: (command: string, arg?: string) => void }) {
	return (
		<button
			type="button"
			title="Insert link"
			onMouseDown={(e) => {
				e.preventDefault();
				const url = prompt("Enter URL:");
				if (url) {
					onAction("createLink", url);
				}
			}}
			className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
		>
			Link
		</button>
	);
}
