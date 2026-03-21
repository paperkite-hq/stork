import { useCallback, useEffect, useRef, useState } from "react";
import { type Attachment, type Folder, type Message, api } from "../api";
import {
	formatFileSize,
	formatFullDate,
	hasRemoteImages,
	sanitizeEmailHtml,
} from "../email-sanitizer";
import { useAsync } from "../hooks";
import { formatAddressList, isFlagged, isUnread } from "../utils";
import { ConfirmDialog } from "./ConfirmDialog";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FolderIcon,
	ForwardIcon,
	ImageIcon,
	MailOpenIcon,
	PaperclipIcon,
	ReplyAllIcon,
	ReplyIcon,
	StarIcon,
	TrashIcon,
} from "./Icons";
import { MessageLabelPicker } from "./LabelManager";
import { toast } from "./Toast";

interface MessageDetailProps {
	message: Message | null;
	thread: Message[];
	loading: boolean;
	error?: string | null;
	onReply: (msg: Message) => void;
	onReplyAll: (msg: Message) => void;
	onForward: (msg: Message) => void;
	onBack: () => void;
	onMessageChanged?: () => void;
	onMessageDeleted?: () => void;
	folders?: Folder[];
	accountId?: number | null;
	onLabelsChanged?: () => void;
}

export function MessageDetail({
	message,
	thread,
	loading,
	onReply,
	onReplyAll,
	onForward,
	onBack,
	onMessageChanged,
	onMessageDeleted,
	folders,
	accountId,
	onLabelsChanged,
	error,
}: MessageDetailProps) {
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
	const [showHtml, setShowHtml] = useState(true);
	const [confirmDelete, setConfirmDelete] = useState<Message | null>(null);
	const [showMoveMenu, setShowMoveMenu] = useState(false);
	const moveMenuRef = useRef<HTMLDivElement>(null);
	// Per-message remote image allow-list — tracks message IDs where user clicked "Show images"
	const [imagesAllowed, setImagesAllowed] = useState<Set<number>>(new Set());

	// Close move menu on outside click
	useEffect(() => {
		if (!showMoveMenu) return;
		const handler = (e: MouseEvent) => {
			if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
				setShowMoveMenu(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [showMoveMenu]);

	// Auto-mark message as read when opened — only fires on new message selection
	const messageId = message?.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on messageId change, not on flag/callback changes
	useEffect(() => {
		if (messageId == null) return;
		const currentFlags = message?.flags;
		if (isUnread(currentFlags ?? null)) {
			api.messages
				.updateFlags(messageId, { add: ["\\Seen"] })
				.then(() => {
					onMessageChanged?.();
				})
				.catch(() => {
					/* silent — non-critical, will retry on next open */
				});
		}
	}, [messageId]);

	const toggleExpanded = useCallback((id: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleToggleRead = useCallback(
		async (msg: Message) => {
			try {
				const unread = isUnread(msg.flags);
				await api.messages.updateFlags(
					msg.id,
					unread ? { add: ["\\Seen"] } : { remove: ["\\Seen"] },
				);
				toast(unread ? "Marked as read" : "Marked as unread", "info");
				onMessageChanged?.();
			} catch {
				toast("Failed to update read status", "error");
			}
		},
		[onMessageChanged],
	);

	const handleToggleStar = useCallback(
		async (msg: Message) => {
			try {
				const flagged = isFlagged(msg.flags);
				await api.messages.updateFlags(
					msg.id,
					flagged ? { remove: ["\\Flagged"] } : { add: ["\\Flagged"] },
				);
				toast(flagged ? "Star removed" : "Message starred");
				onMessageChanged?.();
			} catch {
				toast("Failed to update star", "error");
			}
		},
		[onMessageChanged],
	);

	const handleDeleteConfirmed = useCallback(
		async (msg: Message) => {
			try {
				await api.messages.delete(msg.id);
				setConfirmDelete(null);
				toast("Message deleted", "info");
				onMessageDeleted?.();
			} catch {
				setConfirmDelete(null);
				toast("Failed to delete message", "error");
			}
		},
		[onMessageDeleted],
	);

	const handleMove = useCallback(
		async (msg: Message, folderId: number) => {
			try {
				const folder = folders?.find((f) => f.id === folderId);
				await api.messages.move(msg.id, folderId);
				setShowMoveMenu(false);
				toast(`Moved to ${folder?.name ?? "folder"}`);
				onMessageDeleted?.(); // Message left current folder
			} catch {
				setShowMoveMenu(false);
				toast("Failed to move message", "error");
			}
		},
		[folders, onMessageDeleted],
	);

	if (loading) {
		return (
			<div className="flex-1 flex flex-col overflow-hidden">
				<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
					<div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-64 animate-pulse" />
				</div>
				<div className="px-6 py-4 animate-pulse space-y-4">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
						<div className="space-y-1.5 flex-1">
							<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-40" />
							<div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-56" />
						</div>
						<div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-24" />
					</div>
					<div className="space-y-2 pt-2">
						<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
						<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
						<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
						<div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
						<div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
					</div>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center text-gray-400">
				<div className="text-center space-y-2">
					<p className="text-sm text-red-400">Failed to load message</p>
					<p className="text-xs">{error}</p>
					<button
						type="button"
						onClick={onBack}
						className="text-sm text-stork-600 dark:text-stork-400 hover:underline"
					>
						← Back to list
					</button>
				</div>
			</div>
		);
	}

	if (!message) {
		return (
			<div className="flex-1 flex items-center justify-center text-gray-400">
				<div className="text-center">
					<MailOpenIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
					<p>Select a message to read</p>
					<p className="text-xs mt-1">
						Use <kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">j</kbd>/
						<kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">k</kbd> to navigate
					</p>
				</div>
			</div>
		);
	}

	const displayThread = thread.length > 1 ? thread : [message];
	const isThread = displayThread.length > 1;

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			{/* Header bar */}
			<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
				<button
					type="button"
					onClick={onBack}
					className="md:hidden text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
				>
					← Back
				</button>
				<h2 className="flex-1 font-semibold text-lg truncate">
					{message.subject || "(no subject)"}
				</h2>
				{isThread && (
					<span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
						{displayThread.length} messages
					</span>
				)}
				{/* Message actions */}
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => handleToggleStar(message)}
						className={`p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors ${
							isFlagged(message.flags) ? "text-amber-500" : "text-gray-400 hover:text-amber-500"
						}`}
						title={isFlagged(message.flags) ? "Remove star" : "Star message"}
					>
						<StarIcon className="w-4 h-4" filled={isFlagged(message.flags)} />
					</button>
					<button
						type="button"
						onClick={() => handleToggleRead(message)}
						className="p-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-500 dark:text-gray-400"
						title={isUnread(message.flags) ? "Mark as read" : "Mark as unread"}
					>
						{isUnread(message.flags) ? "Mark read" : "Mark unread"}
					</button>
					{/* Move to folder */}
					{folders && folders.length > 0 && (
						<div className="relative" ref={moveMenuRef}>
							<button
								type="button"
								onClick={() => setShowMoveMenu((v) => !v)}
								className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
								title="Move to folder"
								aria-label="Move to folder"
								aria-haspopup="true"
								aria-expanded={showMoveMenu}
							>
								<FolderIcon className="w-4 h-4" />
							</button>
							{showMoveMenu && (
								<div
									role="menu"
									className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-10 max-h-64 overflow-y-auto"
								>
									{folders.map((f) => (
										<button
											key={f.id}
											type="button"
											role="menuitem"
											onClick={() => handleMove(message, f.id)}
											className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
										>
											{f.name}
										</button>
									))}
								</div>
							)}
						</div>
					)}
					{/* Label picker */}
					{accountId && (
						<MessageLabelPicker
							messageId={message.id}
							accountId={accountId}
							onLabelsChanged={() => {
								onLabelsChanged?.();
								onMessageChanged?.();
							}}
						/>
					)}
					<button
						type="button"
						onClick={() => setConfirmDelete(message)}
						className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors text-gray-400 hover:text-red-600 dark:hover:text-red-400"
						title="Delete message"
					>
						<TrashIcon className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Thread messages */}
			<div className="flex-1 overflow-y-auto">
				{displayThread.map((msg, idx) => {
					const isLast = idx === displayThread.length - 1;
					const expanded = isLast || expandedIds.has(msg.id);

					return (
						<div key={msg.id} className="border-b border-gray-100 dark:border-gray-800">
							{/* Message header — clickable to expand/collapse in threads */}
							<button
								type="button"
								onClick={() => (!isLast ? toggleExpanded(msg.id) : undefined)}
								aria-expanded={isThread && !isLast ? expanded : undefined}
								aria-label={
									isThread && !isLast
										? `${expanded ? "Collapse" : "Expand"} message from ${msg.from_name || msg.from_address}`
										: undefined
								}
								className={`w-full text-left px-6 py-3 ${
									isThread && !isLast
										? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900"
										: ""
								}`}
							>
								<div className="flex items-center gap-3">
									{/* Thread expand/collapse chevron */}
									{isThread && !isLast && (
										<div className="flex-shrink-0 text-gray-400">
											{expanded ? (
												<ChevronDownIcon className="w-3.5 h-3.5" />
											) : (
												<ChevronRightIcon className="w-3.5 h-3.5" />
											)}
										</div>
									)}
									{/* Avatar */}
									<div className="w-8 h-8 rounded-full bg-stork-100 dark:bg-stork-900 flex items-center justify-center text-sm font-medium text-stork-700 dark:text-stork-300 flex-shrink-0">
										{(msg.from_name || msg.from_address || "?")[0]?.toUpperCase()}
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-baseline gap-2">
											<span className="font-medium text-sm">
												{msg.from_name || msg.from_address}
											</span>
											<span className="text-xs text-gray-400 truncate">
												&lt;{msg.from_address}&gt;
											</span>
										</div>
										{expanded && (
											<div className="text-xs text-gray-500 mt-0.5">
												To: {formatAddressList(msg.to_addresses)}
												{msg.cc_addresses && (
													<span> · CC: {formatAddressList(msg.cc_addresses)}</span>
												)}
											</div>
										)}
									</div>
									<div className="text-xs text-gray-400 flex-shrink-0">
										{expanded ? formatFullDate(msg.date) : new Date(msg.date).toLocaleDateString()}
									</div>
								</div>
							</button>

							{/* Message body */}
							{expanded && (
								<div className="px-6 pb-4">
									{/* Toggle HTML/Plain text */}
									{msg.html_body && msg.text_body && (
										<div className="mb-2">
											<button
												type="button"
												onClick={() => setShowHtml((h) => !h)}
												className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
											>
												{showHtml ? "Show plain text" : "Show formatted"}
											</button>
										</div>
									)}

									{/* Remote images banner */}
									{showHtml &&
										msg.html_body &&
										!imagesAllowed.has(msg.id) &&
										hasRemoteImages(msg.html_body) && (
											<div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-sm text-amber-700 dark:text-amber-400">
												<ImageIcon className="w-4 h-4 flex-shrink-0" />
												<span>Images are hidden to protect your privacy.</span>
												<button
													type="button"
													onClick={() => setImagesAllowed((prev) => new Set([...prev, msg.id]))}
													className="ml-auto text-xs font-medium text-amber-600 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 whitespace-nowrap"
												>
													Show images
												</button>
											</div>
										)}

									{showHtml && msg.html_body ? (
										<div
											className="email-content prose prose-sm dark:prose-invert max-w-none"
											dangerouslySetInnerHTML={{
												__html: sanitizeEmailHtml(msg.html_body, {
													blockRemoteImages: !imagesAllowed.has(msg.id),
												}),
											}}
										/>
									) : (
										<pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans">
											{msg.text_body || "(empty message)"}
										</pre>
									)}

									{/* Attachments */}
									{msg.has_attachments > 0 && <AttachmentList messageId={msg.id} />}

									{/* Actions */}
									{isLast && (
										<div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
											<button
												type="button"
												onClick={() => onReply(msg)}
												className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
											>
												<ReplyIcon className="w-3.5 h-3.5" /> Reply
											</button>
											<button
												type="button"
												onClick={() => onReplyAll(msg)}
												className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
											>
												<ReplyAllIcon className="w-3.5 h-3.5" /> Reply All
											</button>
											<button
												type="button"
												onClick={() => onForward(msg)}
												className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
											>
												<ForwardIcon className="w-3.5 h-3.5" /> Forward
											</button>
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Delete confirmation dialog */}
			{confirmDelete && (
				<ConfirmDialog
					title="Delete message"
					message="This will permanently delete this message. This action cannot be undone."
					confirmLabel="Delete"
					variant="danger"
					onConfirm={() => handleDeleteConfirmed(confirmDelete)}
					onCancel={() => setConfirmDelete(null)}
				/>
			)}
		</div>
	);
}

function AttachmentList({ messageId }: { messageId: number }) {
	const { data: attachments, loading } = useAsync(
		() => api.messages.attachments(messageId),
		[messageId],
	);

	if (loading || !attachments || attachments.length === 0) return null;

	return (
		<div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
			<p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
				<PaperclipIcon className="w-3.5 h-3.5" />
				{attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
			</p>
			<div className="flex flex-wrap gap-2">
				{attachments.map((att: Attachment) => (
					<a
						key={att.id}
						href={`/api/attachments/${att.id}`}
						download={att.filename ?? "attachment"}
						className="flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-md transition-colors"
					>
						<span className="truncate max-w-[200px]">{att.filename ?? "attachment"}</span>
						{att.size != null && att.size > 0 && (
							<span className="text-gray-400 flex-shrink-0">{formatFileSize(att.size)}</span>
						)}
					</a>
				))}
			</div>
		</div>
	);
}
