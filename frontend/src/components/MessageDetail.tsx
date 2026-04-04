import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Folder, type Message, type TrustedSender } from "../api";
import { isUnread } from "../utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { MailOpenIcon } from "./Icons";
import { MessageHeaderActions } from "./MessageHeaderActions";
import { highlightText } from "./SearchPanel";
import { ThreadMessage } from "./ThreadMessage";
import { toast } from "./Toast";

interface MessageDetailProps {
	message: Message | null;
	thread: Message[];
	loading: boolean;
	error?: string | null;
	dark?: boolean;
	onReply: (msg: Message) => void;
	onReplyAll: (msg: Message) => void;
	onForward: (msg: Message) => void;
	onBack: () => void;
	onMessageChanged?: () => void;
	onMessageDeleted?: () => void;
	folders?: Folder[];
	identityId?: number | null;
	onLabelsChanged?: () => void;
	openedFromSearch?: boolean;
	searchPosition?: { current: number; total: number };
	onSearchPrev?: () => void;
	onSearchNext?: () => void;
	searchQuery?: string;
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
	identityId,
	onLabelsChanged,
	error,
	dark,
	openedFromSearch,
	searchPosition,
	onSearchPrev,
	onSearchNext,
	searchQuery,
}: MessageDetailProps) {
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
	const [showHtml, setShowHtml] = useState(true);

	// When the selected message changes, expand it in the thread view.
	// This ensures clicking a search result that isn't the last thread message still shows it.
	// Also reset HTML/plain text toggle to default (HTML) for each new message.
	const messageId = message?.id;
	useEffect(() => {
		if (messageId != null) {
			setExpandedIds(new Set([messageId]));
			setShowHtml(true);
		}
	}, [messageId]);
	const [confirmDelete, setConfirmDelete] = useState<Message | null>(null);
	// Per-message remote image allow-list — tracks message IDs where user clicked "Show images"
	const [imagesAllowed, setImagesAllowed] = useState<Set<number>>(new Set());
	// Sender whitelist for persistent image trust
	const [trustedSenders, setTrustedSenders] = useState<TrustedSender[]>([]);
	const trustedAddresses = useMemo(
		() => new Set(trustedSenders.map((s) => s.sender_address)),
		[trustedSenders],
	);

	// Fetch trusted senders (global, no identity scoping)
	useEffect(() => {
		api.trustedSenders
			.list()
			.then(setTrustedSenders)
			.catch(() => {});
	}, []);

	// Auto-mark message as read when opened — debounced to avoid marking every message
	// as read during rapid j/k keyboard navigation (1s delay, like Gmail)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on messageId change, not on flag/callback changes
	useEffect(() => {
		if (messageId == null) return;
		const currentFlags = message?.flags;
		if (!isUnread(currentFlags ?? null)) return;

		const timer = setTimeout(() => {
			api.messages
				.updateFlags(messageId, { add: ["\\Seen"] })
				.then(() => {
					onMessageChanged?.();
				})
				.catch(() => {
					/* silent — non-critical, will retry on next open */
				});
		}, 1000);
		return () => clearTimeout(timer);
	}, [messageId]);

	const toggleExpanded = useCallback((id: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

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

	const handleAllowImages = useCallback((id: number) => {
		setImagesAllowed((prev) => new Set([...prev, id]));
	}, []);

	const handleTrustSender = useCallback((senderAddress: string) => {
		const normalized = senderAddress.toLowerCase().trim();
		// Optimistic update
		setTrustedSenders((prev) => [
			...prev,
			{ id: 0, sender_address: normalized, created_at: new Date().toISOString() },
		]);
		api.trustedSenders.add(normalized).catch(() => {
			// Rollback on failure
			setTrustedSenders((prev) => prev.filter((s) => s.sender_address !== normalized));
			toast("Failed to trust sender", "error");
		});
	}, []);

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
						{openedFromSearch ? "← Back to search results" : "← Back to list"}
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
	const allExpanded = isThread && displayThread.slice(0, -1).every((m) => expandedIds.has(m.id));

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			{/* Header bar */}
			<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
				<button
					type="button"
					onClick={onBack}
					className={`text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0 ${openedFromSearch ? "" : "md:hidden"}`}
				>
					{openedFromSearch ? "← Search results" : "← Back"}
				</button>
				{openedFromSearch && searchPosition && (
					<div className="flex items-center gap-1 flex-shrink-0">
						<button
							type="button"
							onClick={onSearchPrev}
							disabled={!onSearchPrev}
							className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-default transition-colors"
							title="Previous search result"
						>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<title>Previous</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</button>
						<span className="text-xs text-gray-400 tabular-nums">
							{searchPosition.current}/{searchPosition.total}
						</span>
						<button
							type="button"
							onClick={onSearchNext}
							disabled={!onSearchNext}
							className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-default transition-colors"
							title="Next search result"
						>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<title>Next</title>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
					</div>
				)}
				<h2 className="flex-1 font-semibold text-lg truncate">
					{searchQuery
						? highlightText(message.subject || "(no subject)", searchQuery)
						: message.subject || "(no subject)"}
				</h2>
				{isThread && (
					<>
						<button
							type="button"
							onClick={() => {
								if (allExpanded) {
									setExpandedIds(new Set());
								} else {
									setExpandedIds(new Set(displayThread.slice(0, -1).map((m) => m.id)));
								}
							}}
							className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
							title={allExpanded ? "Collapse all" : "Expand all"}
						>
							{allExpanded ? "Collapse all" : "Expand all"}
						</button>
						<span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
							{displayThread.length} messages
						</span>
					</>
				)}
				{/* Message actions */}
				<MessageHeaderActions
					message={message}
					folders={folders}
					identityId={identityId}
					onMessageChanged={onMessageChanged}
					onMessageDeleted={onMessageDeleted}
					onLabelsChanged={onLabelsChanged}
					onRequestDelete={(msg) => setConfirmDelete(msg)}
				/>
			</div>

			{/* Thread messages */}
			<div className="flex-1 overflow-y-auto">
				{displayThread.map((msg, idx) => {
					const isLast = idx === displayThread.length - 1;
					const expanded = isLast || expandedIds.has(msg.id);

					return (
						<ThreadMessage
							key={msg.id}
							msg={msg}
							isThread={isThread}
							isLast={isLast}
							expanded={expanded}
							showHtml={showHtml}
							imagesAllowed={imagesAllowed.has(msg.id)}
							senderTrusted={trustedAddresses.has((msg.from_address ?? "").toLowerCase().trim())}
							dark={dark}
							searchQuery={searchQuery}
							onToggleExpanded={toggleExpanded}
							onToggleShowHtml={() => setShowHtml((h) => !h)}
							onAllowImages={handleAllowImages}
							onTrustSender={handleTrustSender}
							onReply={onReply}
							onReplyAll={onReplyAll}
							onForward={onForward}
						/>
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
