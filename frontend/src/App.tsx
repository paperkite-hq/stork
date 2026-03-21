import { useCallback, useEffect, useMemo, useState } from "react";
import { type ContainerState, type Message, type MessageSummary, api } from "./api";
import { ComposeModal, type ComposeMode } from "./components/ComposeModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { AlertCircleIcon } from "./components/Icons";
import { MessageDetail } from "./components/MessageDetail";
import { MessageList } from "./components/MessageList";
import { SearchPanel } from "./components/SearchPanel";
import { Settings } from "./components/Settings";
import { SetupScreen } from "./components/SetupScreen";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ALL_MAIL_LABEL_ID, Sidebar } from "./components/Sidebar";
import { ToastContainer, toast } from "./components/Toast";
import { UnlockScreen } from "./components/UnlockScreen";
import { Welcome } from "./components/Welcome";
import {
	useAsync,
	useBulkSelection,
	useDarkMode,
	useKeyboardShortcuts,
	useMessageActions,
	useSyncPoller,
} from "./hooks";
import { getPageSize } from "./utils";

export function App() {
	const [dark, toggleDark] = useDarkMode();

	// Container lock state — checked before any data fetching
	const [containerState, setContainerState] = useState<ContainerState | "loading">("loading");

	useEffect(() => {
		api
			.status()
			.then(({ state }) => setContainerState(state))
			.catch(() => setContainerState("unlocked")); // server error — let data routes surface it
	}, []);

	// Data state
	const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
	const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
	const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);

	// UI state
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
	const [showSearch, setShowSearch] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [messageListIndex, setMessageListIndex] = useState(0);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	// Pagination state
	const [allMessages, setAllMessages] = useState<MessageSummary[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);

	// Fetch accounts — only when container is unlocked
	const {
		data: accounts,
		error: accountsError,
		refetch: refetchAccounts,
	} = useAsync(
		() => (containerState === "unlocked" ? api.accounts.list() : Promise.resolve(null)),
		[containerState],
	);

	// Auto-select first account
	const effectiveAccountId = selectedAccountId ?? accounts?.[0]?.id ?? null;

	// Fetch labels for selected account
	const { data: labels, refetch: refetchLabels } = useAsync(
		() => (effectiveAccountId ? api.labels.list(effectiveAccountId) : Promise.resolve([])),
		[effectiveAccountId],
	);

	// Also fetch folders (still needed for move-to-folder in MessageDetail)
	const { data: folders } = useAsync(
		() => (effectiveAccountId ? api.folders.list(effectiveAccountId) : Promise.resolve([])),
		[effectiveAccountId],
	);

	// Auto-select Inbox label
	const effectiveLabelId =
		selectedLabelId ??
		labels?.find((l) => l.name.toLowerCase() === "inbox")?.id ??
		labels?.[0]?.id ??
		null;

	const isAllMail = effectiveLabelId === ALL_MAIL_LABEL_ID;

	// Fetch "All Mail" count for the sidebar badge
	const { data: allMailCount, refetch: refetchAllMailCount } = useAsync(
		() => (effectiveAccountId ? api.allMessages.count(effectiveAccountId) : Promise.resolve(null)),
		[effectiveAccountId],
	);

	// Fetch messages for selected label (or all messages for "All Mail" view)
	const {
		loading: messagesLoading,
		error: messagesError,
		refetch: refetchMessages,
	} = useAsync(() => {
		if (!effectiveLabelId || (isAllMail && !effectiveAccountId)) {
			setAllMessages([]);
			setHasMore(false);
			return Promise.resolve([]);
		}
		const fetchFn =
			isAllMail && effectiveAccountId
				? api.allMessages.list(effectiveAccountId, { limit: getPageSize() })
				: api.labels.messages(effectiveLabelId, { limit: getPageSize() });
		return fetchFn.then((msgs) => {
			setAllMessages(msgs);
			setHasMore(msgs.length >= getPageSize());
			return msgs;
		});
	}, [effectiveLabelId, isAllMail, effectiveAccountId]);

	const handleLoadMore = useCallback(() => {
		if (!effectiveLabelId || loadingMore) return;
		if (isAllMail && !effectiveAccountId) return;
		setLoadingMore(true);
		const fetchFn =
			isAllMail && effectiveAccountId
				? api.allMessages.list(effectiveAccountId, {
						limit: getPageSize(),
						offset: allMessages.length,
					})
				: api.labels.messages(effectiveLabelId, {
						limit: getPageSize(),
						offset: allMessages.length,
					});
		fetchFn
			.then((more) => {
				setAllMessages((prev) => [...prev, ...more]);
				setHasMore(more.length >= getPageSize());
			})
			.catch(() => {
				toast("Failed to load more messages", "error");
			})
			.finally(() => setLoadingMore(false));
	}, [effectiveLabelId, isAllMail, effectiveAccountId, allMessages.length, loadingMore]);

	// Fetch selected message detail
	const {
		data: selectedMessage,
		loading: messageLoading,
		error: messageError,
		refetch: refetchMessage,
	} = useAsync(
		() => (selectedMessageId ? api.messages.get(selectedMessageId) : Promise.resolve(null)),
		[selectedMessageId],
	);

	// Fetch thread for selected message
	const { data: thread } = useAsync(
		() =>
			selectedMessageId
				? api.messages.getThread(selectedMessageId).catch(() => [])
				: Promise.resolve([]),
		[selectedMessageId],
	);

	// Poll sync status — auto-refresh labels & messages when sync completes
	const { syncing, syncStatus } = useSyncPoller(
		useCallback(() => {
			refetchLabels();
			refetchMessages();
			refetchAllMailCount();
		}, [refetchLabels, refetchMessages, refetchAllMailCount]),
	);

	const currentLabelName = isAllMail
		? "All Mail"
		: (labels?.find((l) => l.id === effectiveLabelId)?.name ?? "Inbox");

	// Update document title with total unread count
	const totalUnread = labels?.reduce((sum, l) => sum + (l.unread_count || 0), 0) ?? 0;
	useEffect(() => {
		document.title = totalUnread > 0 ? `(${totalUnread}) Stork Mail` : "Stork Mail";
	}, [totalUnread]);

	// Auto-refresh when window regains focus
	useEffect(() => {
		const handler = () => {
			refetchMessages();
			refetchLabels();
			refetchAllMailCount();
		};
		window.addEventListener("focus", handler);
		return () => window.removeEventListener("focus", handler);
	}, [refetchMessages, refetchLabels, refetchAllMailCount]);

	// Message selection
	const handleSelectMessage = useCallback(
		(id: number) => {
			setSelectedMessageId(id);
			const idx = allMessages.findIndex((m) => m.id === id);
			setMessageListIndex(idx >= 0 ? idx : 0);
			// Close sidebar on mobile when selecting a message
			setSidebarOpen(false);
		},
		[allMessages],
	);

	const handleSelectLabel = useCallback((id: number) => {
		setSelectedLabelId(id);
		setSelectedMessageId(null);
		setMessageListIndex(0);
		setSidebarOpen(false);
		bulk.clear();
	}, []);

	const handleSelectAccount = useCallback((id: number) => {
		setSelectedAccountId(id);
		setSelectedLabelId(null);
		setSelectedMessageId(null);
		setMessageListIndex(0);
	}, []);

	// Manual sync trigger
	const handleSyncNow = useCallback(async () => {
		if (!effectiveAccountId) return;
		try {
			await api.sync.trigger(effectiveAccountId);
		} catch {
			// Sync trigger is best-effort; sync status poller will show any errors
		}
	}, [effectiveAccountId]);

	// Bulk selection (state + action handlers extracted to hook)
	const bulk = useBulkSelection({
		messages: allMessages,
		selectedMessageId,
		setSelectedMessageId,
		refetchMessages,
		refetchLabels,
	});

	// Compose handlers
	const handleCompose = useCallback(() => {
		setComposeMode({ type: "new" });
	}, []);

	const handleReply = useCallback((msg: Message) => {
		setComposeMode({ type: "reply", original: msg });
	}, []);

	const handleReplyAll = useCallback((msg: Message) => {
		setComposeMode({ type: "reply-all", original: msg });
	}, []);

	const handleForward = useCallback((msg: Message) => {
		setComposeMode({ type: "forward", original: msg });
	}, []);

	const handleSend = useCallback(
		(_data: { accountId?: number; to: string; cc: string; subject: string; body: string }) => {
			// TODO: Integrate with SMTP sending API when #491 is done
			setComposeMode(null);
		},
		[],
	);

	// Per-message keyboard action handlers (star, mark read/unread, archive, delete)
	const msgActions = useMessageActions({
		messages: allMessages,
		messageListIndex,
		selectedMessageId,
		setSelectedMessageId,
		setAllMessages,
		labels: labels ?? null,
		folders: folders ?? null,
		effectiveLabelId,
		isAllMail,
		refetchMessages,
		refetchLabels,
		refetchAllMailCount,
	});
	const { focusedMessage } = msgActions;

	// Keyboard shortcuts
	const navigateDown = useCallback(() => {
		if (allMessages.length > 0 && messageListIndex < allMessages.length - 1) {
			const newIdx = messageListIndex + 1;
			setMessageListIndex(newIdx);
			setSelectedMessageId(allMessages[newIdx]?.id ?? 0);
		}
	}, [allMessages, messageListIndex]);

	const navigateUp = useCallback(() => {
		if (allMessages.length > 0 && messageListIndex > 0) {
			const newIdx = messageListIndex - 1;
			setMessageListIndex(newIdx);
			setSelectedMessageId(allMessages[newIdx]?.id ?? 0);
		}
	}, [allMessages, messageListIndex]);

	const shortcuts = useMemo(
		() => ({
			j: navigateDown,
			k: navigateUp,
			ArrowDown: navigateDown,
			ArrowUp: navigateUp,
			Enter: () => {
				if (allMessages[messageListIndex]) {
					setSelectedMessageId(allMessages[messageListIndex].id);
				}
			},
			Escape: () => {
				if (showSearch) setShowSearch(false);
				else if (showShortcuts) setShowShortcuts(false);
				else if (showSettings) setShowSettings(false);
				else if (composeMode) setComposeMode(null);
				else if (selectedMessageId) setSelectedMessageId(null);
			},
			c: () => {
				if (!composeMode && !showSearch) handleCompose();
			},
			r: () => {
				if (selectedMessage && !composeMode && !showSearch) {
					handleReply(selectedMessage);
				}
			},
			a: () => {
				if (selectedMessage && !composeMode && !showSearch) {
					handleReplyAll(selectedMessage);
				}
			},
			f: () => {
				if (selectedMessage && !composeMode && !showSearch) {
					handleForward(selectedMessage);
				}
			},
			"/": (e: KeyboardEvent) => {
				e.preventDefault();
				if (!showSearch) setShowSearch(true);
			},
			"?": () => {
				if (!showShortcuts && !showSearch && !composeMode) {
					setShowShortcuts(true);
				}
			},
			s: () => {
				if (focusedMessage && !composeMode && !showSearch) {
					msgActions.star();
				}
			},
			u: () => {
				if (focusedMessage && !composeMode && !showSearch) {
					msgActions.toggleRead();
				}
			},
			d: () => {
				if (focusedMessage && !composeMode && !showSearch) {
					msgActions.setPendingDelete(focusedMessage.id);
				}
			},
			e: () => {
				if (focusedMessage && !composeMode && !showSearch) {
					msgActions.archive();
				}
			},
			x: () => {
				if (focusedMessage && !composeMode && !showSearch) {
					bulk.toggle(focusedMessage.id);
				}
			},
		}),
		[
			navigateDown,
			navigateUp,
			allMessages,
			messageListIndex,
			focusedMessage,
			selectedMessage,
			composeMode,
			showSearch,
			showShortcuts,
			showSettings,
			selectedMessageId,
			handleCompose,
			handleReply,
			handleReplyAll,
			handleForward,
			msgActions,
			bulk,
		],
	);

	useKeyboardShortcuts(shortcuts);

	// Container state gates — render before any data UI
	if (containerState === "loading") {
		return (
			<div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
				<div className="w-6 h-6 border-2 border-stork-600 border-t-transparent rounded-full animate-spin" />
			</div>
		);
	}

	if (containerState === "setup") {
		return (
			<SetupScreen
				onUnlocked={() => setContainerState("unlocked")}
				dark={dark}
				onToggleDark={toggleDark}
			/>
		);
	}

	if (containerState === "locked") {
		return (
			<UnlockScreen
				onUnlocked={() => setContainerState("unlocked")}
				dark={dark}
				onToggleDark={toggleDark}
			/>
		);
	}

	// Fatal error: can't load accounts
	if (accountsError) {
		return (
			<div className="h-screen flex items-center justify-center">
				<div className="text-center space-y-3">
					<AlertCircleIcon className="w-10 h-10 mx-auto text-red-400" />
					<p className="text-gray-600 dark:text-gray-400">Failed to connect to server</p>
					<p className="text-sm text-gray-400">{accountsError}</p>
					<button
						type="button"
						onClick={refetchAccounts}
						className="px-4 py-2 text-sm bg-stork-600 hover:bg-stork-700 text-white rounded-md transition-colors"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// First-run: show welcome screen when no accounts exist yet
	if (Array.isArray(accounts) && accounts.length === 0) {
		return <Welcome onAccountCreated={refetchAccounts} dark={dark} onToggleDark={toggleDark} />;
	}

	return (
		<div className="h-screen flex overflow-hidden">
			{/* Mobile sidebar overlay */}
			{sidebarOpen && (
				<button
					type="button"
					className="fixed inset-0 z-30 bg-black/30 md:hidden"
					onClick={() => setSidebarOpen(false)}
					aria-label="Close sidebar"
				/>
			)}

			{/* Sidebar */}
			<div
				className={`fixed inset-y-0 left-0 z-40 md:relative md:z-0 transform transition-transform duration-200 ease-in-out ${
					sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
				}`}
			>
				<Sidebar
					accounts={accounts ?? []}
					labels={labels ?? []}
					selectedAccountId={effectiveAccountId}
					selectedLabelId={effectiveLabelId}
					onSelectAccount={handleSelectAccount}
					onSelectLabel={handleSelectLabel}
					onCompose={handleCompose}
					onSearch={() => setShowSearch(true)}
					onSettings={() => setShowSettings(true)}
					onSyncNow={handleSyncNow}
					dark={dark}
					onToggleDark={toggleDark}
					syncing={syncing}
					syncStatus={syncStatus}
					onLabelsChanged={refetchLabels}
					allMailCount={allMailCount}
				/>
			</div>

			{/* Main content area — split into message list + detail */}
			<div className="flex-1 flex min-w-0">
				{/* Mobile header with hamburger */}
				<div className="md:hidden absolute top-0 left-0 z-20 p-2">
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
						aria-label="Open sidebar"
					>
						<svg
							className="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							role="img"
							aria-label="Menu"
						>
							<title>Menu</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 6h16M4 12h16M4 18h16"
							/>
						</svg>
					</button>
				</div>

				{/* Message list panel — hidden on mobile when viewing a message */}
				<div
					className={`w-full md:w-80 xl:w-96 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col ${
						selectedMessageId !== null ? "hidden md:flex" : "flex"
					}`}
				>
					<MessageList
						messages={allMessages}
						selectedId={selectedMessageId}
						onSelect={handleSelectMessage}
						loading={messagesLoading}
						error={messagesError}
						folderName={currentLabelName}
						onRefresh={refetchMessages}
						hasMore={hasMore}
						onLoadMore={handleLoadMore}
						loadingMore={loadingMore}
						totalCount={
							isAllMail
								? allMailCount?.total
								: labels?.find((l) => l.id === effectiveLabelId)?.message_count
						}
						selectedIds={bulk.selectedIds}
						onToggleSelect={bulk.toggle}
						onSelectAll={bulk.selectAll}
						onClearSelection={bulk.clear}
						onBulkDelete={bulk.bulkDelete}
						onBulkMarkRead={bulk.markRead}
						onBulkMarkUnread={bulk.markUnread}
						onBulkMove={bulk.move}
						folders={folders ?? []}
					/>
				</div>

				{/* Message detail / thread view — hidden on mobile when no message selected */}
				<div className={`flex-1 min-w-0 ${selectedMessageId === null ? "hidden md:flex" : "flex"}`}>
					<MessageDetail
						message={selectedMessage ?? null}
						thread={thread ?? []}
						loading={messageLoading && selectedMessageId !== null}
						error={messageError}
						onReply={handleReply}
						onReplyAll={handleReplyAll}
						onForward={handleForward}
						onBack={() => setSelectedMessageId(null)}
						onMessageChanged={() => {
							refetchMessage();
							refetchMessages();
						}}
						onMessageDeleted={() => {
							setSelectedMessageId(null);
							refetchMessages();
							refetchLabels();
						}}
						folders={folders ?? []}
						accountId={effectiveAccountId}
						onLabelsChanged={refetchLabels}
					/>
				</div>
			</div>

			{/* Modals */}
			{composeMode && (
				<ComposeModal
					mode={composeMode}
					accounts={accounts ?? []}
					selectedAccountId={effectiveAccountId}
					onClose={() => setComposeMode(null)}
					onSend={handleSend}
				/>
			)}
			{showSearch && (
				<SearchPanel
					onClose={() => setShowSearch(false)}
					onSelectMessage={(id) => {
						setSelectedMessageId(id);
						setShowSearch(false);
					}}
					accountId={effectiveAccountId}
				/>
			)}
			{showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
			{showSettings && <Settings onClose={() => setShowSettings(false)} />}
			{msgActions.pendingDelete !== null && (
				<ConfirmDialog
					title="Delete message"
					message="This will permanently delete this message. This action cannot be undone."
					confirmLabel="Delete"
					variant="danger"
					onConfirm={msgActions.confirmDelete}
					onCancel={() => msgActions.setPendingDelete(null)}
				/>
			)}
			<ToastContainer />
		</div>
	);
}
