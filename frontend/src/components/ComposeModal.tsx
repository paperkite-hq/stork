import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, Message } from "../api";
import { XIcon } from "./Icons";

export type ComposeMode =
	| { type: "new" }
	| { type: "reply"; original: Message }
	| { type: "reply-all"; original: Message }
	| { type: "forward"; original: Message };

const DRAFT_KEY = "stork-compose-draft";

interface Draft {
	to: string;
	cc: string;
	subject: string;
	body: string;
}

function saveDraft(draft: Draft) {
	try {
		localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
	} catch {
		// localStorage unavailable — ignore
	}
}

function loadDraft(): Draft | null {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as Draft;
	} catch {
		return null;
	}
}

function clearDraft() {
	try {
		localStorage.removeItem(DRAFT_KEY);
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
		subject: string;
		body: string;
	}) => void;
}

/** Validate a comma-separated list of email addresses.
 *  Accepts "user@domain.tld" or "Name <user@domain.tld>" formats. */
function validateEmails(raw: string): string | null {
	if (!raw.trim()) return "At least one recipient is required";
	const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
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
	if (!subject) return "Re: ";
	if (/^re:/i.test(subject)) return subject;
	return `Re: ${subject}`;
}

function buildForwardSubject(subject: string | null): string {
	if (!subject) return "Fwd: ";
	if (/^fwd:/i.test(subject)) return subject;
	return `Fwd: ${subject}`;
}

function buildReplyBody(msg: Message): string {
	const date = new Date(msg.date).toLocaleString();
	const header = `\n\nOn ${date}, ${msg.from_name || msg.from_address} wrote:\n`;
	const body = msg.text_body || "";
	const quoted = body
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return header + quoted;
}

function buildReplyAllCc(msg: Message): string {
	// Include all To and CC addresses except the sender (who goes in To)
	const addresses: string[] = [];
	if (msg.to_addresses) {
		for (const addr of msg.to_addresses.split(",")) {
			const trimmed = addr.trim();
			if (trimmed && trimmed !== msg.from_address) {
				addresses.push(trimmed);
			}
		}
	}
	if (msg.cc_addresses) {
		for (const addr of msg.cc_addresses.split(",")) {
			const trimmed = addr.trim();
			if (trimmed && trimmed !== msg.from_address) {
				addresses.push(trimmed);
			}
		}
	}
	return addresses.join(", ");
}

export function ComposeModal({
	mode,
	accounts,
	selectedAccountId,
	onClose,
	onSend,
}: ComposeModalProps) {
	const isNew = mode.type === "new";

	const [fromAccountId, setFromAccountId] = useState<number | undefined>(
		selectedAccountId ?? undefined,
	);
	const [to, setTo] = useState(() => {
		if (mode.type === "reply" || mode.type === "reply-all") return mode.original.from_address;
		// Restore draft for new messages only
		if (isNew) return loadDraft()?.to ?? "";
		return "";
	});
	const [cc, setCc] = useState(() => {
		if (mode.type === "reply-all") return buildReplyAllCc(mode.original);
		if (isNew) return loadDraft()?.cc ?? "";
		return "";
	});
	const [subject, setSubject] = useState(() => {
		if (mode.type === "reply" || mode.type === "reply-all")
			return buildReplySubject(mode.original.subject);
		if (mode.type === "forward") return buildForwardSubject(mode.original.subject);
		if (isNew) return loadDraft()?.subject ?? "";
		return "";
	});
	const [body, setBody] = useState(() => {
		if (mode.type === "reply" || mode.type === "reply-all") return buildReplyBody(mode.original);
		if (mode.type === "forward") {
			const msg = mode.original;
			return `\n\n---------- Forwarded message ----------\nFrom: ${msg.from_name || ""} <${msg.from_address}>\nDate: ${new Date(msg.date).toLocaleString()}\nSubject: ${msg.subject || ""}\nTo: ${msg.to_addresses || ""}\n\n${msg.text_body || ""}`;
		}
		if (isNew) return loadDraft()?.body ?? "";
		return "";
	});
	const [showCc, setShowCc] = useState(() => {
		if (mode.type === "reply-all") return buildReplyAllCc(mode.original).length > 0;
		if (isNew) {
			const d = loadDraft();
			return !!d?.cc;
		}
		return false;
	});
	const [sending, setSending] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const toInputRef = useRef<HTMLInputElement>(null);

	// Auto-focus the To field on mount
	useEffect(() => {
		// Timeout allows the modal animation to complete before focusing
		const timer = setTimeout(() => toInputRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	// Auto-save draft (new messages only)
	useEffect(() => {
		if (!isNew) return;
		saveDraft({ to, cc, subject, body });
	}, [isNew, to, cc, subject, body]);

	const handleSend = useCallback(() => {
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
		setValidationError(null);
		setSending(true);
		clearDraft();
		onSend({ accountId: fromAccountId, to: to.trim(), cc: cc.trim(), subject, body });
	}, [to, cc, subject, body, fromAccountId, onSend]);

	const handleDiscard = useCallback(() => {
		clearDraft();
		onClose();
	}, [onClose]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const modeLabel =
		mode.type === "reply"
			? "Reply"
			: mode.type === "reply-all"
				? "Reply All"
				: mode.type === "forward"
					? "Forward"
					: "New Message";

	return (
		<div
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
				className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col max-h-[80vh]"
				onKeyDown={handleKeyDown}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
					<h3 className="font-semibold">{modeLabel}</h3>
					<button
						type="button"
						onClick={handleDiscard}
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
					>
						<XIcon className="w-4 h-4" />
					</button>
				</div>

				{/* Fields */}
				<div className="px-4 py-2 space-y-2 border-b border-gray-100 dark:border-gray-800">
					{accounts && accounts.length > 1 && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-from" className="text-sm text-gray-500 w-10 flex-shrink-0">
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
						<label htmlFor="compose-to" className="text-sm text-gray-500 w-10">
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
						{!showCc && (
							<button
								type="button"
								onClick={() => setShowCc(true)}
								className="text-xs text-gray-400 hover:text-gray-600"
							>
								Cc
							</button>
						)}
					</div>
					{showCc && (
						<div className="flex items-center gap-2">
							<label htmlFor="compose-cc" className="text-sm text-gray-500 w-10">
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
					<div className="flex items-center gap-2">
						<label htmlFor="compose-subject" className="text-sm text-gray-500 w-10">
							Subj
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

				{/* Body */}
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					className="flex-1 p-4 bg-transparent text-sm resize-none outline-none min-h-[200px]"
					placeholder="Write your message…"
				/>

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
