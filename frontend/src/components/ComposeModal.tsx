import { useCallback, useEffect, useRef, useState } from "react";
import type { Identity } from "../api";
import {
	type ComposeFormat,
	type ComposeMode,
	buildForwardHtmlBody,
	buildForwardSubject,
	buildReplyAllCc,
	buildReplyBody,
	buildReplyHtmlBody,
	buildReplySubject,
	clearDraft,
	draftKey,
	getInitialFormat,
	htmlToPlainText,
	loadDraft,
	plainTextToHtml,
	saveDraft,
	validateEmails,
} from "../compose-utils";
import { useFocusTrap } from "../hooks";
import { XIcon } from "./Icons";

export type { ComposeMode } from "../compose-utils";

interface ComposeModalProps {
	mode: ComposeMode;
	identities?: Identity[];
	selectedIdentityId?: number | null;
	onClose: () => void;
	onSend: (data: {
		identityId?: number;
		to: string;
		cc: string;
		bcc: string;
		subject: string;
		body: string;
		htmlBody?: string;
	}) => void | Promise<void>;
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
	identities,
	selectedIdentityId,
	onClose,
	onSend,
}: ComposeModalProps) {
	const currentDraftKey = draftKey(mode);
	const userEmail = identities?.find(
		(a) => a.id === (selectedIdentityId ?? identities[0]?.id),
	)?.email;

	const [fromIdentityId, setFromIdentityId] = useState<number | undefined>(
		selectedIdentityId ?? undefined,
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
				identityId: fromIdentityId,
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
	}, [to, cc, bcc, subject, body, format, fromIdentityId, onSend, currentDraftKey, getEditorHtml]);

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
		? "w-full h-full sm:w-[calc(100%-3rem)] sm:h-[calc(100%-3rem)] sm:max-w-6xl bg-white dark:bg-gray-900 sm:rounded-xl shadow-2xl flex flex-col"
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
					{identities && identities.length > 1 && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-from" className="text-sm text-gray-500 w-14 flex-shrink-0">
								From
							</label>
							<select
								id="compose-from"
								value={fromIdentityId ?? ""}
								onChange={(e) => setFromIdentityId(Number(e.target.value) || undefined)}
								className="flex-1 bg-transparent text-sm outline-none border-none dark:text-gray-100"
							>
								{identities.map((a) => (
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
