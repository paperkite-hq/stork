import { useEffect, useRef } from "react";
import type { Folder, MessageSummary } from "../api";
import { isFlagged, isUnread } from "../utils";
import { BulkActionsBar } from "./BulkActionsBar";
import { AlertCircleIcon, InboxEmptyIcon, PaperclipIcon, RefreshIcon, StarIcon } from "./Icons";

function formatDate(dateStr: string): string {
	const d = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffDays = Math.floor(diffMs / 86400000);

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

interface MessageListProps {
	messages: MessageSummary[];
	selectedId: number | null;
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
	folders?: Folder[];
}

export function MessageList({
	messages,
	selectedId,
	onSelect,
	loading,
	error,
	folderName,
	onRefresh,
	hasMore,
	onLoadMore,
	loadingMore,
	onToggleStar,
	selectedIds,
	onToggleSelect,
	onSelectAll,
	onClearSelection,
	onBulkDelete,
	onBulkMarkRead,
	onBulkMarkUnread,
	onBulkMove,
	onBulkArchive,
	folders = [],
	totalCount,
}: MessageListProps) {
	const selectedRef = useRef<HTMLButtonElement>(null);
	const bulkCount = selectedIds?.size ?? 0;
	const hasBulk = bulkCount > 0;

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
		<div className="flex-1 flex flex-col min-w-0">
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

			{/* Message list */}
			<div className="flex-1 overflow-y-auto">
				{messages.length === 0 && (
					<div className="p-8 text-center text-gray-400">
						<InboxEmptyIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
						<p>No messages in this folder</p>
					</div>
				)}
				{messages.map((msg, idx) => {
					const unread = isUnread(msg.flags);
					const starred = isFlagged(msg.flags);
					const active = msg.id === selectedId;
					const bulkSelected = selectedIds?.has(msg.id) ?? false;
					return (
						<div
							key={msg.id}
							className={`group relative border-b border-gray-100 dark:border-gray-800 transition-colors ${
								bulkSelected
									? "bg-stork-50 dark:bg-stork-950"
									: active
										? "bg-stork-50 dark:bg-stork-950"
										: "hover:bg-gray-50 dark:hover:bg-gray-900"
							}`}
						>
							{/* Star toggle — shown on hover or when starred */}
							{onToggleStar && (
								<button
									type="button"
									aria-label={starred ? "Remove star" : "Star message"}
									onClick={(e) => {
										e.stopPropagation();
										onToggleStar(msg.id);
									}}
									className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 transition-opacity ${
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
									className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 transition-opacity ${
										hasBulk || bulkSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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
								ref={active ? selectedRef : undefined}
								type="button"
								data-index={idx}
								onClick={() => onSelect(msg.id)}
								className={`w-full text-left py-3 border-b-0 transition-colors ${
									onToggleSelect ? hasBulk || "group-hover:[&]:pl-8" : ""
								} ${hasBulk || bulkSelected ? "pl-8 pr-4" : "px-4"}`}
							>
								<div className="flex items-start gap-2 min-w-0">
									{/* Unread dot */}
									<div className="pt-1.5 flex-shrink-0">
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
											<span
												className="flex-shrink-0 text-xs text-gray-400 ml-auto"
												title={new Date(msg.date).toLocaleString(undefined, {
													weekday: "long",
													year: "numeric",
													month: "long",
													day: "numeric",
													hour: "numeric",
													minute: "2-digit",
												})}
											>
												{formatDate(msg.date)}
											</span>
										</div>
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
										{msg.preview && (
											<div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">
												{msg.preview.replace(/\s+/g, " ").trim()}
											</div>
										)}
									</div>
								</div>
							</button>
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
