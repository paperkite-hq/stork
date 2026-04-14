import { memo, type RefObject, useEffect, useMemo, useRef } from "react";
import type { Folder, InboundConnector, LabelSummary, MessageSummary } from "../api";
import { isFlagged, isUnread } from "../utils";
import { BulkActionsBar } from "./BulkActionsBar";
import {
	AlertCircleIcon,
	ArchiveIcon,
	InboxEmptyIcon,
	PaperclipIcon,
	RefreshIcon,
	StarIcon,
} from "./Icons";

interface ThreadGroup {
	root: MessageSummary;
	children: MessageSummary[];
}

function groupMessagesIntoThreads(messages: MessageSummary[]): ThreadGroup[] {
	const byMessageId = new Map<string, MessageSummary>();
	for (const msg of messages) {
		if (msg.message_id) byMessageId.set(msg.message_id, msg);
	}

	const childIds = new Set<number>();
	const parentMap = new Map<number, number>();

	for (const msg of messages) {
		if (msg.in_reply_to) {
			const parent = byMessageId.get(msg.in_reply_to);
			if (parent) {
				childIds.add(msg.id);
				parentMap.set(msg.id, parent.id);
			}
		}
	}

	const rootFor = (id: number): number => {
		const p = parentMap.get(id);
		return p !== undefined ? rootFor(p) : id;
	};

	const groups = new Map<number, ThreadGroup>();
	const result: ThreadGroup[] = [];

	for (const msg of messages) {
		if (childIds.has(msg.id)) continue;

		const rootId = rootFor(msg.id);
		if (rootId !== msg.id) continue;

		const group: ThreadGroup = { root: msg, children: [] };
		groups.set(msg.id, group);
		result.push(group);
	}

	for (const msg of messages) {
		if (!childIds.has(msg.id)) continue;
		const rid = rootFor(msg.id);
		const group = groups.get(rid);
		if (group) {
			group.children.push(msg);
		}
	}

	return result;
}

function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return "";
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return dateStr;
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	// Very recent — show relative time
	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffDays === 0 && diffHours < 12) return `${diffHours}h ago`;

	if (diffDays === 0) {
		return d.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
	}
	if (diffDays < 7) {
		return d.toLocaleDateString(undefined, { weekday: "short" });
	}
	if (d.getFullYear() === now.getFullYear()) {
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function MessageSkeleton() {
	return (
		<div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 animate-pulse">
			<div className="flex items-start gap-3">
				<div className="pt-1.5 flex-shrink-0">
					<div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700" />
				</div>
				<div className="flex-1 min-w-0 space-y-2">
					<div className="flex items-baseline gap-2">
						<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-32" />
						<div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-12 ml-auto" />
					</div>
					<div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-48" />
				</div>
			</div>
		</div>
	);
}

interface MessageListItemProps {
	msg: MessageSummary;
	idx: number;
	active: boolean;
	focused: boolean;
	bulkSelected: boolean;
	hasBulk: boolean;
	onSelect: (id: number) => void;
	onToggleStar?: (id: number) => void;
	onToggleSelect?: (id: number) => void;
	/** Quick archive / remove-current-label action — shown on hover */
	onArchive?: (id: number) => void;
	/** Tooltip for the archive button (e.g. "Archive" or "Remove from Work") */
	archiveLabel?: string;
	selectedRef?: RefObject<HTMLButtonElement | null>;
	/** Identity email shown as a badge — passed when viewing unified inbox */
	identityLabel?: string;
	/** When true, renders compact (no subject, reduced padding) as part of a thread group */
	threadChild?: boolean;
	/** Whether this is the last child in a thread group */
	threadLast?: boolean;
	/** Number of replies in the thread (shown on root message) */
	threadCount?: number;
}

/** Memoized message row — skips re-render when props haven't changed,
 *  which matters for large inboxes (50+ messages). */
const MessageListItem = memo(function MessageListItem({
	msg,
	idx,
	active,
	focused,
	bulkSelected,
	hasBulk,
	onSelect,
	onToggleStar,
	onToggleSelect,
	onArchive,
	archiveLabel = "Archive",
	selectedRef,
	identityLabel,
	threadChild,
	threadLast,
	threadCount,
}: MessageListItemProps) {
	const unread = isUnread(msg.flags);
	const starred = isFlagged(msg.flags);

	return (
		// biome-ignore lint/a11y/useFocusableInteractive: keyboard navigation handled by app-level j/k shortcuts
		<div
			role="option"
			aria-selected={active}
			className={`group relative transition-colors ${
				threadChild
					? `ml-4 border-l-2 border-l-gray-200 dark:border-l-gray-700 ${threadLast ? "border-b border-b-gray-100 dark:border-b-gray-800" : ""}`
					: "border-b border-gray-100 dark:border-gray-800"
			} ${focused ? "border-l-2 border-l-stork-500 dark:border-l-stork-400" : ""} ${
				bulkSelected
					? "bg-stork-50 dark:bg-stork-950"
					: active
						? "bg-stork-50 dark:bg-stork-950"
						: "hover:bg-gray-50 dark:hover:bg-gray-900"
			}`}
		>
			{/* Archive button — shown on hover (quick remove-current-label action) */}
			{onArchive && (
				<button
					type="button"
					aria-label={archiveLabel}
					title={archiveLabel}
					onClick={(e) => {
						e.stopPropagation();
						onArchive(msg.id);
					}}
					className={`absolute z-10 transition-opacity duration-200 opacity-0 group-hover:opacity-100 ${
						onToggleStar ? "right-8" : "right-2"
					} top-1/2 -translate-y-1/2`}
				>
					<ArchiveIcon className="w-4 h-4 text-gray-300 dark:text-gray-600 hover:text-stork-500 dark:hover:text-stork-400" />
				</button>
			)}

			{/* Star toggle — shown on hover or when starred */}
			{onToggleStar && (
				<button
					type="button"
					aria-label={starred ? "Remove star" : "Star message"}
					onClick={(e) => {
						e.stopPropagation();
						onToggleStar(msg.id);
					}}
					className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 transition-opacity duration-200 ${
						starred ? "opacity-100" : "opacity-0 group-hover:opacity-100"
					}`}
				>
					<StarIcon
						className={`w-4 h-4 ${starred ? "text-amber-500" : "text-gray-300 dark:text-gray-600 hover:text-amber-400"}`}
						filled={starred}
					/>
				</button>
			)}

			{/* Checkbox — shown on hover or when any selected */}
			{onToggleSelect && (
				<button
					type="button"
					aria-label={bulkSelected ? "Deselect message" : "Select message"}
					onClick={(e) => {
						e.stopPropagation();
						onToggleSelect(msg.id);
					}}
					className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 transition-opacity duration-150 ${
						hasBulk || bulkSelected ? "opacity-100" : "opacity-30 group-hover:opacity-100"
					}`}
				>
					<div
						className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
							bulkSelected
								? "bg-stork-500 border-stork-500"
								: "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
						}`}
					>
						{bulkSelected && (
							<svg
								viewBox="0 0 12 12"
								className="w-2.5 h-2.5 text-white"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								aria-hidden="true"
							>
								<path d="M2 6l3 3 5-5" />
							</svg>
						)}
					</div>
				</button>
			)}

			<button
				ref={selectedRef}
				type="button"
				data-index={idx}
				onClick={() => onSelect(msg.id)}
				className={`w-full text-left ${threadChild ? "py-1.5" : "py-3"} border-b-0 transition-colors ${
					onToggleSelect ? "pl-8 pr-4" : "px-4"
				}`}
			>
				<div className="flex items-start gap-2 min-w-0">
					{/* Unread dot */}
					<div className={`${threadChild ? "pt-1" : "pt-1.5"} flex-shrink-0`}>
						{unread ? (
							<div className="w-2 h-2 rounded-full bg-stork-500" />
						) : (
							<div className="w-2 h-2" />
						)}
					</div>

					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<span
								className={`truncate text-sm ${
									unread
										? "font-semibold text-gray-900 dark:text-gray-100"
										: "text-gray-700 dark:text-gray-300"
								}`}
							>
								{msg.from_name || msg.from_address}
							</span>
							{threadCount != null && threadCount > 0 && (
								<span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-1.5 py-0">
									{threadCount + 1}
								</span>
							)}
							{threadChild && msg.has_attachments > 0 && (
								<PaperclipIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
							)}
							<span
								className="flex-shrink-0 text-xs text-gray-400 ml-auto"
								title={
									msg.date && !Number.isNaN(new Date(msg.date).getTime())
										? new Date(msg.date).toLocaleString(undefined, {
												weekday: "long",
												year: "numeric",
												month: "long",
												day: "numeric",
												hour: "numeric",
												minute: "2-digit",
											})
										: undefined
								}
							>
								{formatDate(msg.date)}
							</span>
						</div>
						{!threadChild && (
							<div className="flex items-center gap-1.5">
								<span
									className={`text-sm truncate ${
										unread
											? "font-medium text-gray-800 dark:text-gray-200"
											: "text-gray-600 dark:text-gray-400"
									}`}
								>
									{msg.subject || "(no subject)"}
								</span>
								{msg.has_attachments > 0 && (
									<PaperclipIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
								)}
							</div>
						)}
						{threadChild && msg.preview && (
							<div className="text-xs text-gray-400 dark:text-gray-500 truncate">
								{msg.preview.replace(/\s+/g, " ").trim()}
							</div>
						)}
						{!threadChild && identityLabel && (
							<div className="text-xs text-stork-500 dark:text-stork-400 truncate mt-0.5">
								{identityLabel}
							</div>
						)}
						{!threadChild && !identityLabel && msg.preview && (
							<div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
								{msg.preview.replace(/\s+/g, " ").trim()}
							</div>
						)}
						{!threadChild && identityLabel && msg.preview && (
							<div className="text-xs text-gray-400 dark:text-gray-500 truncate">
								{msg.preview.replace(/\s+/g, " ").trim()}
							</div>
						)}
					</div>
				</div>
			</button>
		</div>
	);
});

interface MessageListProps {
	messages: MessageSummary[];
	selectedId: number | null;
	focusedId?: number | null;
	onSelect: (id: number) => void;
	loading: boolean;
	error?: string | null;
	folderName: string;
	onRefresh?: () => void;
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	totalCount?: number;
	onToggleStar?: (id: number) => void;
	/** Pass inbound connectors to show per-connector labels in unified inbox view */
	inboundConnectors?: InboundConnector[];
	// Bulk selection
	selectedIds?: Set<number>;
	onToggleSelect?: (id: number) => void;
	onSelectAll?: () => void;
	onClearSelection?: () => void;
	onBulkDelete?: () => void;
	onBulkMarkRead?: () => void;
	onBulkMarkUnread?: () => void;
	onBulkMove?: (folderId: number) => void;
	onBulkArchive?: () => void;
	/** Per-message archive action shown on hover — removes the current label */
	onArchiveMessage?: (id: number) => void;
	/** Tooltip for the per-message archive button */
	archiveMessageLabel?: string;
	folders?: Folder[];
	/** Labels to suggest for intersection filtering — shown as clickable chips above the list */
	suggestedLabels?: LabelSummary[];
	onAddFilterLabel?: (id: number) => void;
	/** Active filter label IDs — shown as removable pills above the list */
	filterLabelIds?: number[];
	/** All labels — used to resolve filter pill names */
	allLabels?: LabelSummary[];
	onRemoveFilterLabel?: (id: number) => void;
	onClearFilter?: () => void;
}

export function MessageList({
	messages,
	selectedId,
	focusedId,
	onSelect,
	loading,
	error,
	folderName,
	onRefresh,
	hasMore,
	onLoadMore,
	loadingMore,
	onToggleStar,
	inboundConnectors,
	selectedIds,
	onToggleSelect,
	onSelectAll,
	onClearSelection,
	onBulkDelete,
	onBulkMarkRead,
	onBulkMarkUnread,
	onBulkMove,
	onBulkArchive,
	onArchiveMessage,
	archiveMessageLabel,
	folders = [],
	totalCount,
	suggestedLabels,
	onAddFilterLabel,
	filterLabelIds,
	allLabels,
	onRemoveFilterLabel,
	onClearFilter,
}: MessageListProps) {
	const selectedRef = useRef<HTMLButtonElement>(null);
	const bulkCount = selectedIds?.size ?? 0;
	const hasBulk = bulkCount > 0;
	const threadGroups = useMemo(() => groupMessagesIntoThreads(messages), [messages]);

	// Scroll selected message into view (for keyboard navigation)
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedId drives when to scroll, ref is stable
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [selectedId]);

	if (loading) {
		return (
			<div className="flex-1 flex flex-col min-w-0">
				<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
					<div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24 animate-pulse" />
				</div>
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
				<MessageSkeleton />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex-1 flex flex-col min-w-0">
				<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
					<h2 className="font-semibold text-lg">{folderName}</h2>
				</div>
				<div className="flex-1 flex items-center justify-center p-8">
					<div className="text-center space-y-2">
						<AlertCircleIcon className="w-8 h-8 mx-auto text-red-400" />
						<p className="text-sm text-gray-600 dark:text-gray-400">Failed to load messages</p>
						<p className="text-xs text-gray-400">{error}</p>
						{onRefresh && (
							<button
								type="button"
								onClick={onRefresh}
								className="mt-2 px-3 py-1.5 text-sm text-stork-600 dark:text-stork-400 hover:bg-stork-50 dark:hover:bg-stork-950 rounded-md transition-colors"
							>
								Retry
							</button>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col min-w-0 min-h-0">
			{/* Folder header */}
			<div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
				<h2 className="font-semibold text-lg">{folderName}</h2>
				<div className="flex items-center gap-2">
					{onRefresh && (
						<button
							type="button"
							onClick={onRefresh}
							className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
							title="Refresh"
						>
							<RefreshIcon className="w-4 h-4" />
						</button>
					)}
					<span className="text-xs text-gray-400">
						{totalCount != null && totalCount > messages.length
							? `${messages.length} of ${totalCount}`
							: `${messages.length}`}{" "}
						message{(totalCount ?? messages.length) !== 1 ? "s" : ""}
					</span>
				</div>
			</div>

			{/* Bulk actions bar */}
			{hasBulk &&
				onSelectAll &&
				onClearSelection &&
				onBulkDelete &&
				onBulkMarkRead &&
				onBulkMarkUnread &&
				onBulkMove && (
					<BulkActionsBar
						count={bulkCount}
						total={messages.length}
						allSelected={bulkCount >= messages.length}
						onSelectAll={onSelectAll}
						onClearSelection={onClearSelection}
						onDelete={onBulkDelete}
						onMarkRead={onBulkMarkRead}
						onMarkUnread={onBulkMarkUnread}
						onMove={onBulkMove}
						onArchive={onBulkArchive}
						folders={folders}
					/>
				)}

			{/* Active filter pills + suggested filter labels — unified chip bar above the message list */}
			{((filterLabelIds && filterLabelIds.length > 1 && onRemoveFilterLabel) ||
				(suggestedLabels && suggestedLabels.length > 0 && onAddFilterLabel)) && (
				<div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1.5 flex-wrap">
					{/* Active filter pills */}
					{filterLabelIds && filterLabelIds.length > 1 && onRemoveFilterLabel && (
						<>
							<span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Filtering:</span>
							{filterLabelIds.map((fid) => {
								const fl = allLabels?.find((l) => l.id === fid);
								if (!fl) return null;
								return (
									<span
										key={fid}
										className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-stork-100 dark:bg-stork-900 text-stork-700 dark:text-stork-300"
									>
										{fl.color && (
											<span
												className="w-2 h-2 rounded-full flex-shrink-0"
												style={{ backgroundColor: fl.color }}
											/>
										)}
										{fl.name}
										<button
											type="button"
											onClick={() => onRemoveFilterLabel(fid)}
											className="hover:text-red-500 transition-colors"
											title={`Remove ${fl.name} filter`}
										>
											×
										</button>
									</span>
								);
							})}
							{onClearFilter && (
								<button
									type="button"
									onClick={onClearFilter}
									className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ml-0.5"
									title="Clear all filters"
								>
									Clear
								</button>
							)}
							{suggestedLabels && suggestedLabels.length > 0 && (
								<span className="text-gray-300 dark:text-gray-600 mx-0.5">|</span>
							)}
						</>
					)}
					{/* Suggestion chips */}
					{suggestedLabels && suggestedLabels.length > 0 && onAddFilterLabel && (
						<>
							{!(filterLabelIds && filterLabelIds.length > 1) && (
								<span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
									Also view:
								</span>
							)}
							{suggestedLabels.map((l) => (
								<button
									key={l.id}
									type="button"
									onClick={() => onAddFilterLabel(l.id)}
									className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-stork-100 dark:hover:bg-stork-900 hover:text-stork-700 dark:hover:text-stork-300 transition-colors"
									title={`Filter by ${l.name}`}
								>
									{l.color && (
										<span
											className="w-2 h-2 rounded-full flex-shrink-0"
											style={{ backgroundColor: l.color }}
										/>
									)}
									{l.name}
								</button>
							))}
						</>
					)}
				</div>
			)}

			{/* Message list */}
			<div className="flex-1 overflow-y-auto" role="listbox" aria-label={`${folderName} messages`}>
				{messages.length === 0 && (
					<div className="p-8 text-center text-gray-400">
						<InboxEmptyIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
						<p>No messages in this folder</p>
					</div>
				)}
				{threadGroups.map((group) => {
					const connectorFor = (msg: MessageSummary) =>
						inboundConnectors && msg.inbound_connector_id
							? inboundConnectors.find((c) => c.id === msg.inbound_connector_id)
							: undefined;
					const rootConnector = connectorFor(group.root);
					const rootIdx = messages.indexOf(group.root);
					return (
						<div key={group.root.id}>
							<MessageListItem
								msg={group.root}
								idx={rootIdx}
								active={group.root.id === selectedId}
								focused={group.root.id === focusedId}
								bulkSelected={selectedIds?.has(group.root.id) ?? false}
								hasBulk={hasBulk}
								onSelect={onSelect}
								onToggleStar={onToggleStar}
								onToggleSelect={onToggleSelect}
								onArchive={onArchiveMessage}
								archiveLabel={archiveMessageLabel}
								selectedRef={group.root.id === selectedId ? selectedRef : undefined}
								identityLabel={rootConnector ? rootConnector.name : undefined}
								threadCount={group.children.length}
							/>
							{group.children.map((child, ci) => {
								const childConnector = connectorFor(child);
								const childIdx = messages.indexOf(child);
								return (
									<MessageListItem
										key={child.id}
										msg={child}
										idx={childIdx}
										active={child.id === selectedId}
										focused={child.id === focusedId}
										bulkSelected={selectedIds?.has(child.id) ?? false}
										hasBulk={hasBulk}
										onSelect={onSelect}
										onToggleStar={onToggleStar}
										onToggleSelect={onToggleSelect}
										onArchive={onArchiveMessage}
										archiveLabel={archiveMessageLabel}
										selectedRef={child.id === selectedId ? selectedRef : undefined}
										identityLabel={childConnector ? childConnector.name : undefined}
										threadChild
										threadLast={ci === group.children.length - 1}
									/>
								);
							})}
						</div>
					);
				})}
				{hasMore && (
					<div className="p-4 text-center">
						<button
							type="button"
							onClick={onLoadMore}
							disabled={loadingMore}
							className="px-4 py-2 text-sm text-stork-600 dark:text-stork-400 hover:bg-stork-50 dark:hover:bg-stork-950 rounded-md transition-colors disabled:opacity-50"
						>
							{loadingMore ? "Loading…" : "Load more messages"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
