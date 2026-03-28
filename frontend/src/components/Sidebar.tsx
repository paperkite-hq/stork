import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { Account, GlobalSyncStatus, Label } from "../api";
import {
	ArchiveIcon,
	ComposeIcon,
	DraftIcon,
	InboxIcon,
	MailAllIcon,
	MoonIcon,
	RefreshIcon,
	SearchIcon,
	SendIcon,
	SettingsIcon,
	SpamIcon,
	StarIcon,
	SunIcon,
	TrashIcon,
	UnreadIcon,
} from "./Icons";
import { LabelManager } from "./LabelManager";

// Map well-known label names (derived from IMAP folder names) to icons
function labelIcon(label: Label): ReactNode {
	const name = label.name.toLowerCase();
	const cls = "w-4 h-4 flex-shrink-0";
	if (name === "inbox") return <InboxIcon className={cls} />;
	if (name === "sent" || name === "sent mail" || name === "sent items")
		return <SendIcon className={cls} />;
	if (name === "drafts" || name === "draft") return <DraftIcon className={cls} />;
	if (name === "trash" || name === "deleted" || name === "deleted items")
		return <TrashIcon className={cls} />;
	if (name === "junk" || name === "spam") return <SpamIcon className={cls} />;
	if (name === "archive" || name === "all mail") return <ArchiveIcon className={cls} />;
	if (name === "starred" || name === "flagged") return <StarIcon className={cls} filled />;
	// User-created labels get a colored dot if they have a color, otherwise a tag icon
	if (label.color) {
		return (
			<span
				className="w-3 h-3 rounded-full flex-shrink-0"
				style={{ backgroundColor: label.color }}
			/>
		);
	}
	return (
		<svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<title>Label</title>
			<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
			<line x1="7" y1="7" x2="7.01" y2="7" />
		</svg>
	);
}

/** Sentinel label ID for the "All Mail" virtual view */
export const ALL_MAIL_LABEL_ID = -1;
/** Sentinel label ID for the "Unread" virtual view */
export const UNREAD_LABEL_ID = -2;
/** Sentinel label ID for the promoted "Inbox" virtual view */
export const INBOX_LABEL_ID = -3;
/** Sentinel label ID for the unified cross-account inbox view */
export const UNIFIED_INBOX_LABEL_ID = -4;
/** Sentinel label ID for the unified cross-account All Mail view */
export const UNIFIED_ALL_MAIL_LABEL_ID = -5;
/** Sentinel label ID for the unified cross-account Unread view */
export const UNIFIED_UNREAD_LABEL_ID = -6;

interface SidebarProps {
	accounts: Account[];
	labels: Label[];
	selectedAccountId: number | null;
	selectedLabelId: number | null;
	onSelectAccount: (id: number) => void;
	onSelectLabel: (id: number) => void;
	onCompose: () => void;
	onSearch: (query: string) => void;
	onSettings: () => void;
	onSyncNow?: () => void;
	dark: boolean;
	onToggleDark: () => void;
	syncing?: boolean;
	syncError?: string | null;
	syncStatus?: GlobalSyncStatus | null;
	onLabelsChanged?: () => void;
	allMailCount?: { total: number; unread: number } | null;
	unreadCount?: { total: number } | null;
	inboxLabel?: Label | null;
	unifiedInboxCount?: { total: number; unread: number } | null;
	unifiedAllMailCount?: { total: number; unread: number } | null;
	unifiedUnreadCount?: { total: number } | null;
}

/** Formats a duration in ms as "Xm Ys" or "Xs" */
function formatDuration(ms: number): string {
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const rem = secs % 60;
	return `${mins}m ${rem}s`;
}

/** Shows real-time sync progress details, ticking elapsed time once per second */
function SyncProgressDetail({ syncStatus }: { syncStatus: GlobalSyncStatus }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, []);

	// Aggregate progress across all accounts
	const accountStatuses = Object.values(syncStatus);
	const running = accountStatuses.filter((a) => a.running);

	if (running.length === 0) return null;

	// Show progress for first running account (most users have one)
	const account = running[0];
	if (!account) return null;
	const progress = account.progress;

	const elapsedMs = progress ? now - progress.startedAt : 0;
	const elapsedStr = formatDuration(elapsedMs);

	let estimatedStr: string | null = null;
	if (
		progress &&
		progress.foldersCompleted > 0 &&
		progress.totalFolders > progress.foldersCompleted
	) {
		const msPerFolder = elapsedMs / progress.foldersCompleted;
		const remaining = msPerFolder * (progress.totalFolders - progress.foldersCompleted);
		estimatedStr = formatDuration(remaining);
	}

	return (
		<div className="px-4 py-3 text-xs space-y-1.5 bg-stork-50 dark:bg-stork-950">
			{progress ? (
				<>
					{progress.currentFolder && (
						<div className="flex items-start gap-1.5">
							<span className="text-stork-500 dark:text-stork-400 shrink-0">Folder:</span>
							<span
								className="text-stork-700 dark:text-stork-300 truncate font-medium"
								title={progress.currentFolder}
							>
								{progress.currentFolder}
							</span>
						</div>
					)}
					{progress.totalFolders > 0 && (
						<div className="space-y-1">
							<div className="flex justify-between text-stork-600 dark:text-stork-400">
								<span>
									{progress.foldersCompleted} of {progress.totalFolders} folders
								</span>
								<span>
									{Math.round((progress.foldersCompleted / progress.totalFolders) * 100)}%
								</span>
							</div>
							<div className="w-full h-1 bg-stork-200 dark:bg-stork-800 rounded-full overflow-hidden">
								<div
									className="h-full bg-stork-500 dark:bg-stork-400 rounded-full transition-all duration-500"
									style={{
										width: `${Math.round((progress.foldersCompleted / progress.totalFolders) * 100)}%`,
									}}
								/>
							</div>
						</div>
					)}
					{progress.messagesNew > 0 && (
						<div className="text-stork-600 dark:text-stork-400">
							{progress.messagesNew} new {progress.messagesNew === 1 ? "message" : "messages"} found
						</div>
					)}
					<div className="flex justify-between text-stork-500 dark:text-stork-500">
						<span>Elapsed: {elapsedStr}</span>
						{estimatedStr && <span>~{estimatedStr} remaining</span>}
					</div>
				</>
			) : (
				<div className="text-stork-600 dark:text-stork-400">Connecting to server…</div>
			)}
			{running.length > 1 && (
				<div className="text-stork-500 dark:text-stork-500">
					+{running.length - 1} more {running.length - 1 === 1 ? "account" : "accounts"} syncing
				</div>
			)}
		</div>
	);
}

export function Sidebar({
	accounts,
	labels,
	selectedAccountId,
	selectedLabelId,
	onSelectAccount,
	onSelectLabel,
	onCompose,
	onSearch,
	onSettings,
	onSyncNow,
	dark,
	onToggleDark,
	syncing,
	syncError,
	syncStatus,
	onLabelsChanged,
	allMailCount,
	unreadCount,
	inboxLabel,
	unifiedInboxCount,
	unifiedAllMailCount,
	unifiedUnreadCount,
}: SidebarProps) {
	const [contextMenu, setContextMenu] = useState<{
		label: Label;
		position: { x: number; y: number };
	} | null>(null);
	const [syncDetailOpen, setSyncDetailOpen] = useState(false);

	const handleLabelContextMenu = useCallback((e: React.MouseEvent, label: Label) => {
		if (label.source !== "user") return;
		e.preventDefault();
		setContextMenu({ label, position: { x: e.clientX, y: e.clientY } });
	}, []);

	return (
		<aside className="w-64 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
			{/* Logo + compose */}
			<div className="p-4 border-b border-gray-200 dark:border-gray-800">
				<div className="flex items-center gap-2 mb-3">
					<span className="text-xl font-bold text-stork-600 dark:text-stork-400">Stork</span>
					<span className="text-xs text-gray-400">Mail</span>
				</div>
				<button
					type="button"
					onClick={onCompose}
					className="w-full py-2 px-4 bg-stork-600 hover:bg-stork-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
				>
					<ComposeIcon className="w-4 h-4" />
					Compose
				</button>
			</div>

			{/* Search button — opens the search panel */}
			<div className="px-4 pt-3">
				<button
					type="button"
					onClick={() => onSearch("")}
					className="w-full flex items-center gap-2 py-1.5 pl-3 pr-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-sm text-gray-400 transition-colors"
				>
					<SearchIcon className="w-3.5 h-3.5 flex-shrink-0" />
					<span className="flex-1 text-left">Search mail…</span>
					<kbd className="text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">/</kbd>
				</button>
			</div>

			{/* Account selector */}
			{accounts.length > 1 && (
				<div className="px-4 pt-3">
					<select
						value={selectedAccountId ?? ""}
						onChange={(e) => onSelectAccount(Number(e.target.value))}
						className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1"
					>
						{accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name} ({a.email})
							</option>
						))}
					</select>
				</div>
			)}

			{/* Mirror mode nag — shown when any account is in mirror mode (not connector mode) */}
			{accounts.some((a) => a.sync_delete_from_server === 0) && (
				<div className="mx-4 mt-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
					<button type="button" onClick={onSettings} className="text-left w-full">
						<span className="font-medium">Mirror mode active.</span> Actions in Stork don't sync
						back to your provider. <span className="underline">Switch to Connector mode</span> when
						you're ready to commit.
					</button>
				</div>
			)}

			{/* Sync indicator — clickable to show verbose progress */}
			{syncing && (
				<div className="border-b border-gray-200 dark:border-gray-800">
					<button
						type="button"
						onClick={() => setSyncDetailOpen((v) => !v)}
						className="w-full px-4 py-2 flex items-center gap-2 text-xs text-stork-600 dark:text-stork-400 hover:bg-stork-50 dark:hover:bg-stork-950 transition-colors"
						title="Click for sync details"
					>
						<svg
							className="w-3.5 h-3.5 animate-spin flex-shrink-0"
							viewBox="0 0 24 24"
							fill="none"
							role="img"
							aria-label="Syncing"
						>
							<title>Syncing</title>
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
							/>
						</svg>
						<span className="flex-1 text-left">Syncing mail…</span>
						<svg
							className={`w-3 h-3 flex-shrink-0 transition-transform ${syncDetailOpen ? "rotate-180" : ""}`}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<title>{syncDetailOpen ? "Hide details" : "Show details"}</title>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</button>
					{syncDetailOpen && syncStatus && <SyncProgressDetail syncStatus={syncStatus} />}
				</div>
			)}

			{/* Sync error indicator — shown when not syncing but last sync failed */}
			{!syncing && syncError && (
				<div className="border-b border-gray-200 dark:border-gray-800 px-4 py-2">
					<div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
						<svg
							className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							role="img"
							aria-label="Sync error"
						>
							<title>Sync error</title>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="12" />
							<line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
						<div className="flex-1 min-w-0">
							<span className="font-medium">Sync failed</span>
							<p className="text-red-500 dark:text-red-500 truncate mt-0.5" title={syncError}>
								{syncError}
							</p>
						</div>
					</div>
				</div>
			)}

			{/* Navigation — promoted views + label list */}
			<nav className="flex-1 overflow-y-auto px-2 py-3">
				{/* All Inboxes — unified cross-account inbox, only shown with multiple accounts */}
				{accounts.length > 1 && (
					<>
						<p className="px-3 pt-1 pb-1 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
							All Accounts
						</p>
						<button
							type="button"
							onClick={() => onSelectLabel(UNIFIED_INBOX_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === UNIFIED_INBOX_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<InboxIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">All Inboxes</span>
							{unifiedInboxCount && unifiedInboxCount.unread > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{unifiedInboxCount.unread}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSelectLabel(UNIFIED_UNREAD_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === UNIFIED_UNREAD_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<UnreadIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">All Unread</span>
							{unifiedUnreadCount && unifiedUnreadCount.total > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{unifiedUnreadCount.total}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSelectLabel(UNIFIED_ALL_MAIL_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === UNIFIED_ALL_MAIL_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<MailAllIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">All Mail</span>
							{unifiedAllMailCount && unifiedAllMailCount.unread > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{unifiedAllMailCount.unread}
								</span>
							)}
						</button>
						<div className="my-2 mx-3 border-t border-gray-200 dark:border-gray-700" />
					</>
				)}

				{/* Promoted views: Inbox, Unread, All Mail — always at top */}
				{labels.length > 0 && (
					<>
						<button
							type="button"
							onClick={() => onSelectLabel(INBOX_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === INBOX_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<InboxIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">Inbox</span>
							{inboxLabel && inboxLabel.unread_count > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{inboxLabel.unread_count}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSelectLabel(UNREAD_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === UNREAD_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<UnreadIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">Unread</span>
							{unreadCount && unreadCount.total > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{unreadCount.total}
								</span>
							)}
						</button>
						<button
							type="button"
							onClick={() => onSelectLabel(ALL_MAIL_LABEL_ID)}
							className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
								selectedLabelId === ALL_MAIL_LABEL_ID
									? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
							}`}
						>
							<MailAllIcon className="w-4 h-4 flex-shrink-0" />
							<span className="truncate">All Mail</span>
							{allMailCount && allMailCount.unread > 0 && (
								<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
									{allMailCount.unread}
								</span>
							)}
						</button>
						<div className="my-2 mx-3 border-t border-gray-200 dark:border-gray-700" />
					</>
				)}

				{/* Regular labels — Inbox is excluded since it's promoted above */}
				{labels
					.filter((l) => l.name.toLowerCase() !== "inbox")
					.map((label) => {
						const active = label.id === selectedLabelId;
						return (
							<button
								key={label.id}
								type="button"
								onClick={() => onSelectLabel(label.id)}
								onContextMenu={(e) => handleLabelContextMenu(e, label)}
								className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
									active
										? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
										: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
								}`}
							>
								{labelIcon(label)}
								<span className="truncate">{label.name}</span>
								{label.unread_count > 0 && (
									<span className="ml-auto text-xs font-medium text-stork-600 dark:text-stork-400 bg-stork-100 dark:bg-stork-900 px-1.5 py-0.5 rounded-full">
										{label.unread_count}
									</span>
								)}
							</button>
						);
					})}

				{labels.length === 0 && (
					<p className="text-xs text-gray-400 px-3 py-2">
						{syncing ? "Waiting for initial sync…" : "No labels yet"}
					</p>
				)}
				{/* Label management — create button + context menu + edit/delete */}
				{selectedAccountId && onLabelsChanged && (
					<LabelManager
						accountId={selectedAccountId}
						onLabelsChanged={onLabelsChanged}
						contextMenu={contextMenu}
						onContextMenuClose={() => setContextMenu(null)}
					/>
				)}
			</nav>

			{/* Footer controls */}
			<div className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
				<button
					type="button"
					onClick={onToggleDark}
					className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors flex items-center gap-1.5"
					title="Toggle dark mode"
				>
					{dark ? (
						<>
							<SunIcon className="w-3.5 h-3.5" /> Light
						</>
					) : (
						<>
							<MoonIcon className="w-3.5 h-3.5" /> Dark
						</>
					)}
				</button>
				<div className="flex items-center gap-1">
					{onSyncNow && (
						<button
							type="button"
							onClick={onSyncNow}
							disabled={syncing}
							className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40 transition-colors"
							title={syncing ? "Sync in progress…" : "Sync now"}
						>
							<RefreshIcon className={`w-4 h-4${syncing ? " animate-spin" : ""}`} />
						</button>
					)}
					<button
						type="button"
						onClick={onSettings}
						className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
						title="Settings"
					>
						<SettingsIcon className="w-4 h-4" />
					</button>
				</div>
			</div>
		</aside>
	);
}
