import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ContainerState, type Message, type SearchResult, api } from "./api";
import { ComposeModal, type ComposeMode } from "./components/ComposeModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DemoBanner } from "./components/DemoBanner";
import { MessageDetail } from "./components/MessageDetail";
import { MessageList } from "./components/MessageList";
import { SearchPanel } from "./components/SearchPanel";
import { Settings } from "./components/Settings";
import { SetupScreen } from "./components/SetupScreen";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import {
	ALL_MAIL_LABEL_ID,
	INBOX_LABEL_ID,
	Sidebar,
	UNIFIED_ALL_MAIL_LABEL_ID,
	UNIFIED_INBOX_LABEL_ID,
	UNIFIED_UNREAD_LABEL_ID,
	UNREAD_LABEL_ID,
} from "./components/Sidebar";
import { ToastContainer, toast } from "./components/Toast";
import { UnlockScreen } from "./components/UnlockScreen";
import { Welcome } from "./components/Welcome";
import { buildThreadingHeaders } from "./compose-utils";
import {
	useAsync,
	useBulkSelection,
	useDarkMode,
	useDesktopNotifications,
	useHistoryNavigation,
	useKeyboardShortcuts,
	useMessageActions,
	useMessagePagination,
	useSyncPoller,
} from "./hooks";
import { isFlagged, parseFlags } from "./utils";

export function App() {
	const [dark, toggleDark] = useDarkMode();
	const { notifyNewMail } = useDesktopNotifications();

	// Container lock state — checked before any data fetching
	const [containerState, setContainerState] = useState<ContainerState | "loading">("loading");

	useEffect(() => {
		api
			.status()
			.then(({ state }) => setContainerState(state))
			.catch(() => setContainerState("unlocked")); // server error — let data routes surface it
	}, []);

	// Listen for 423 responses — container restarted and is now locked (or in setup)
	useEffect(() => {
		const handler = (e: Event) => {
			const state = (e as CustomEvent<{ state: string }>).detail?.state;
			setContainerState(state === "setup" ? "setup" : "locked");
		};
		window.addEventListener("stork-container-locked", handler);
		return () => window.removeEventListener("stork-container-locked", handler);
	}, []);

	// Data state
	const [selectedIdentityId, setSelectedIdentityId] = useState<number | null>(null);
	const [selectedLabelId, setSelectedLabelId] = useState<number | null>(null);
	const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
	const [filterLabelIds, setFilterLabelIds] = useState<number[]>([]);

	// UI state
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
	const [showSearch, setShowSearch] = useState(false);
	const [initialSearchQuery, setInitialSearchQuery] = useState("");
	const [openedFromSearch, setOpenedFromSearch] = useState(false);
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [activeSearchQuery, setActiveSearchQuery] = useState("");
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [messageListIndex, setMessageListIndex] = useState(0);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	// Fetch identities — only when container is unlocked
	const {
		data: identities,
		error: identitiesError,
		refetch: refetchIdentities,
	} = useAsync(
		() => (containerState === "unlocked" ? api.identities.list() : Promise.resolve(null)),
		[containerState],
	);

	// Auto-select first identity
	const effectiveIdentityId = selectedIdentityId ?? identities?.[0]?.id ?? null;

	// Labels are global — not per-identity
	const { data: labels, refetch: refetchLabels } = useAsync(
		() => (containerState === "unlocked" ? api.labels.list() : Promise.resolve(null)),
		[containerState],
	);

	// Fetch all folders (needed for move-to-folder in MessageDetail)
	const { data: folders } = useAsync(
		() => (containerState === "unlocked" ? api.folders.listAll() : Promise.resolve([])),
		[containerState],
	);

	// Fetch inbound connectors (needed for per-connector labels in unified inbox view,
	// and to determine first-run state)
	const { data: inboundConnectors, refetch: refetchInboundConnectors } = useAsync(
		() => (containerState === "unlocked" ? api.connectors.inbound.list() : Promise.resolve([])),
		[containerState],
	);

	// Resolve the default view. In multi-identity mode the primary navigation is
	// unified (cross-identity), so default to UNIFIED_INBOX. In single-identity mode
	// honour the per-identity default_view setting.
	const effectiveIdentity = identities?.find((a) => a.id === effectiveIdentityId) ?? null;
	const defaultLabelId = useMemo(() => {
		if (!labels || labels.length === 0) return INBOX_LABEL_ID;
		// Multi-identity: unified inbox is the default starting point
		if ((identities?.length ?? 0) > 1 && !selectedIdentityId) return UNIFIED_INBOX_LABEL_ID;
		if (!effectiveIdentity) return INBOX_LABEL_ID;
		const dv = effectiveIdentity.default_view ?? "inbox";
		if (dv === "unread") return UNREAD_LABEL_ID;
		if (dv === "all") return ALL_MAIL_LABEL_ID;
		if (dv.startsWith("label:")) {
			const id = Number.parseInt(dv.slice(6), 10);
			return Number.isNaN(id) ? INBOX_LABEL_ID : id;
		}
		return INBOX_LABEL_ID; // 'inbox' or unknown
	}, [effectiveIdentity, labels, identities?.length, selectedIdentityId]);

	// Auto-select default view (uses per-identity setting, falls back to Inbox).
	// Guard on identities !== null to avoid a double-fetch: if labels resolve before
	// identities, effectiveLabelId would become non-null with effectiveIdentityId=null,
	// then when identities load effectiveIdentityId changes → getFetchFn changes → second
	// message fetch with the same args. Waiting for identities ensures one fetch.
	const effectiveLabelId =
		selectedLabelId ?? (labels && labels.length > 0 && identities !== null ? defaultLabelId : null);

	const isAllMail = effectiveLabelId === ALL_MAIL_LABEL_ID;
	const isUnread = effectiveLabelId === UNREAD_LABEL_ID;
	const isInbox = effectiveLabelId === INBOX_LABEL_ID;
	const isUnifiedInbox = effectiveLabelId === UNIFIED_INBOX_LABEL_ID;
	const isUnifiedAllMail = effectiveLabelId === UNIFIED_ALL_MAIL_LABEL_ID;
	const isUnifiedUnread = effectiveLabelId === UNIFIED_UNREAD_LABEL_ID;

	// Find the real inbox label for the promoted Inbox view
	const inboxLabel = labels?.find((l) => l.name.toLowerCase() === "inbox") ?? null;
	const inboxLabelId = inboxLabel?.id ?? null;

	// Suggested intersection filters: labels that commonly co-occur with messages in the current view.
	// For real labels (positive ID) and the promoted Inbox view: fetch from the related-labels API.
	// For virtual views (All Mail, Unread, unified variants): derive from labels by message count.
	const suggestForLabelId =
		filterLabelIds.length === 0
			? isInbox || isUnifiedInbox
				? inboxLabelId
				: effectiveLabelId && effectiveLabelId > 0
					? effectiveLabelId
					: null
			: null;
	const { data: relatedLabelsFromApi } = useAsync(
		() => (suggestForLabelId ? api.labels.related(suggestForLabelId, 5) : Promise.resolve(null)),
		[suggestForLabelId],
	);

	// For virtual "all" views, suggest top labels by message count (all non-system labels)
	const isVirtualAllView =
		filterLabelIds.length === 0 &&
		!suggestForLabelId &&
		(isAllMail || isUnread || isUnifiedAllMail || isUnifiedUnread);
	const virtualViewSuggestions =
		isVirtualAllView && labels
			? labels
					.filter((l) => l.message_count > 0 && !filterLabelIds.includes(l.id))
					.sort((a, b) => b.message_count - a.message_count)
					.slice(0, 5)
					.map((l) => ({ id: l.id, name: l.name, color: l.color, source: l.source }))
			: null;

	const relatedLabels = relatedLabelsFromApi ?? virtualViewSuggestions;

	// Fetch "All Mail" count for the sidebar badge (global across all inbound connectors)
	const { data: allMailCount, refetch: refetchAllMailCount } = useAsync(
		() => api.inbox.allMessages.count(),
		[],
	);

	// Fetch "Unread" count for the sidebar badge (global across all inbound connectors)
	const { data: unreadCount, refetch: refetchUnreadCount } = useAsync(
		() => api.inbox.unreadMessages.count(),
		[],
	);

	// Fetch unified inbox count for the "All Inboxes" sidebar badge (only with multiple identities)
	const hasMultipleIdentities = (identities?.length ?? 0) > 1;
	const { data: unifiedInboxCount, refetch: refetchUnifiedInboxCount } = useAsync(
		() => (hasMultipleIdentities ? api.inbox.unified.count() : Promise.resolve(null)),
		[hasMultipleIdentities],
	);
	const { data: unifiedAllMailCount, refetch: refetchUnifiedAllMailCount } = useAsync(
		() => (hasMultipleIdentities ? api.inbox.allMessages.count() : Promise.resolve(null)),
		[hasMultipleIdentities],
	);
	const { data: unifiedUnreadCount, refetch: refetchUnifiedUnreadCount } = useAsync(
		() => (hasMultipleIdentities ? api.inbox.unreadMessages.count() : Promise.resolve(null)),
		[hasMultipleIdentities],
	);

	// Message list fetching + pagination (extracted to hook)
	const {
		allMessages,
		setAllMessages,
		messagesLoading,
		messagesError,
		refetchMessages,
		hasMore,
		loadingMore,
		handleLoadMore,
	} = useMessagePagination({
		effectiveLabelId: isInbox ? inboxLabelId : effectiveLabelId,
		isAllMail,
		isUnread,
		isUnifiedInbox,
		isUnifiedAllMail,
		isUnifiedUnread,
		filterLabelIds,
	});

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
	const { data: thread, error: threadError } = useAsync(
		() => (selectedMessageId ? api.messages.getThread(selectedMessageId) : Promise.resolve([])),
		[selectedMessageId],
	);

	// Show toast when thread fails to load
	useEffect(() => {
		if (threadError) {
			toast("Failed to load thread", "error");
		}
	}, [threadError]);

	// Poll sync status — auto-refresh labels & messages when sync completes
	const {
		syncing,
		lastError: syncError,
		syncStatus,
	} = useSyncPoller(
		useCallback(() => {
			refetchLabels();
			refetchMessages();
			refetchAllMailCount();
			refetchUnreadCount();
			refetchUnifiedInboxCount();
			refetchUnifiedAllMailCount();
			refetchUnifiedUnreadCount();
		}, [
			refetchLabels,
			refetchMessages,
			refetchAllMailCount,
			refetchUnreadCount,
			refetchUnifiedInboxCount,
			refetchUnifiedAllMailCount,
			refetchUnifiedUnreadCount,
		]),
	);

	const currentLabelName =
		filterLabelIds.length > 1
			? filterLabelIds
					.map((id) => labels?.find((l) => l.id === id)?.name)
					.filter(Boolean)
					.join(" + ")
			: isUnifiedInbox
				? "All Inboxes"
				: isUnifiedAllMail
					? "All Mail"
					: isUnifiedUnread
						? "Unread"
						: isAllMail
							? "All Mail"
							: isUnread
								? "Unread"
								: isInbox
									? "Inbox"
									: (labels?.find((l) => l.id === effectiveLabelId)?.name ?? "Inbox");

	// Update document title with total unread count
	const totalUnread = labels?.reduce((sum, l) => sum + (l.unread_count || 0), 0) ?? 0;
	useEffect(() => {
		document.title = totalUnread > 0 ? `(${totalUnread}) Stork Mail` : "Stork Mail";
	}, [totalUnread]);

	// Fire desktop notification when new mail arrives (unread count increases after sync)
	const prevTotalUnreadRef = useRef<number | null>(null);
	useEffect(() => {
		if (labels === null) return;
		const prev = prevTotalUnreadRef.current;
		if (prev !== null && totalUnread > prev) {
			const diff = totalUnread - prev;
			notifyNewMail(diff, inboxLabel?.name ?? "Inbox");
		}
		prevTotalUnreadRef.current = totalUnread;
	}, [totalUnread, labels, inboxLabel?.name, notifyNewMail]);

	// Auto-refresh when window regains focus
	useEffect(() => {
		const handler = () => {
			refetchMessages();
			refetchLabels();
			refetchAllMailCount();
			refetchUnreadCount();
			refetchUnifiedInboxCount();
			refetchUnifiedAllMailCount();
			refetchUnifiedUnreadCount();
		};
		window.addEventListener("focus", handler);
		return () => window.removeEventListener("focus", handler);
	}, [
		refetchMessages,
		refetchLabels,
		refetchAllMailCount,
		refetchUnreadCount,
		refetchUnifiedInboxCount,
		refetchUnifiedAllMailCount,
		refetchUnifiedUnreadCount,
	]);

	// Message selection
	const handleSelectMessage = useCallback(
		(id: number) => {
			setSelectedMessageId(id);
			const idx = allMessages.findIndex((m) => m.id === id);
			setMessageListIndex(idx >= 0 ? idx : 0);
			// Close sidebar on mobile when selecting a message
			setSidebarOpen(false);
			// Clear search origin when selecting from message list
			setOpenedFromSearch(false);
		},
		[allMessages],
	);

	// Search result prev/next navigation
	const searchResultIndex = useMemo(() => {
		if (!openedFromSearch || !selectedMessageId) return -1;
		return searchResults.findIndex((r) => r.id === selectedMessageId);
	}, [openedFromSearch, selectedMessageId, searchResults]);

	const handleSearchPrev = useCallback(() => {
		const prev = searchResults[searchResultIndex - 1];
		if (searchResultIndex > 0 && prev) {
			setSelectedMessageId(prev.id);
		}
	}, [searchResultIndex, searchResults]);

	const handleSearchNext = useCallback(() => {
		const next = searchResults[searchResultIndex + 1];
		if (searchResultIndex >= 0 && searchResultIndex < searchResults.length - 1 && next) {
			setSelectedMessageId(next.id);
		}
	}, [searchResultIndex, searchResults]);

	// Browser back/forward navigation
	useHistoryNavigation({
		identityId: effectiveIdentityId,
		labelId: effectiveLabelId,
		messageId: selectedMessageId,
		searchActive: openedFromSearch,
		onNavigate: useCallback((state) => {
			if (state.identityId !== null) setSelectedIdentityId(state.identityId);
			setSelectedLabelId(state.labelId);
			setSelectedMessageId(state.messageId);
			setMessageListIndex(0);
			if (state.searchActive) {
				setShowSearch(true);
				setOpenedFromSearch(false);
			}
		}, []),
	});

	// Manual sync trigger
	const handleSyncNow = useCallback(async () => {
		if (!effectiveIdentityId) return;
		try {
			await api.sync.trigger(effectiveIdentityId);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown error";
			// "already syncing" is expected — sync poller will show progress
			if (!message.includes("already syncing")) {
				toast(`Sync failed: ${message}`, "error");
			}
		}
	}, [effectiveIdentityId]);

	// Inline star toggle from message list — uses parseFlags for consistent flag manipulation
	const handleToggleStar = useCallback(
		async (messageId: number) => {
			const msg = allMessages.find((m) => m.id === messageId);
			if (!msg) return;
			const flagged = isFlagged(msg.flags);
			const flagsUpdate = flagged ? { remove: ["\\Flagged"] } : { add: ["\\Flagged"] };
			// Optimistic update using parseFlags (same pattern as useMessageActions)
			setAllMessages((prev) =>
				prev.map((m) => {
					if (m.id !== messageId) return m;
					const flagSet = parseFlags(m.flags);
					if (flagged) flagSet.delete("\\Flagged");
					else flagSet.add("\\Flagged");
					return { ...m, flags: [...flagSet].join(",") };
				}),
			);
			try {
				await api.messages.updateFlags(messageId, flagsUpdate);
			} catch {
				refetchMessages();
			}
		},
		[allMessages, setAllMessages, refetchMessages],
	);

	// Archive = remove Inbox label. Only available when viewing the Inbox.
	const archiveLabelId = inboxLabelId;
	const archiveDisabled = !isInbox;

	// Bulk selection (state + action handlers extracted to hook)
	const bulk = useBulkSelection({
		messages: allMessages,
		selectedMessageId,
		setSelectedMessageId,
		refetchMessages,
		refetchLabels,
		effectiveLabelId: archiveLabelId,
		isAllMail: archiveDisabled,
		refetchAllMailCount,
		refetchUnreadCount,
	});

	const handleSelectLabel = useCallback(
		(id: number) => {
			setSelectedLabelId(id);
			setFilterLabelIds([]);
			setSelectedMessageId(null);
			setMessageListIndex(0);
			setSidebarOpen(false);
			setShowSearch(false);
			setOpenedFromSearch(false);
			bulk.clear();
		},
		[bulk],
	);

	const handleToggleFilterLabel = useCallback(
		(id: number) => {
			setFilterLabelIds((prev) => {
				if (prev.length === 0) {
					// Starting a multi-label filter: include the currently selected label + the new one
					const currentIds: number[] = [];
					if (effectiveLabelId && effectiveLabelId > 0) {
						currentIds.push(effectiveLabelId);
					} else if (isInbox && inboxLabelId) {
						currentIds.push(inboxLabelId);
					}
					if (!currentIds.includes(id)) currentIds.push(id);
					// Need at least 2 labels for multi-filter to be meaningful
					if (currentIds.length < 2) return [id];
					setSelectedLabelId(null);
					return currentIds;
				}
				if (prev.includes(id)) {
					const next = prev.filter((x) => x !== id);
					// If only one label left, switch to single-label view
					if (next.length <= 1) {
						if (next[0]) setSelectedLabelId(next[0]);
						return [];
					}
					return next;
				}
				return [...prev, id];
			});
			setSelectedMessageId(null);
			setMessageListIndex(0);
			bulk.clear();
		},
		[effectiveLabelId, isInbox, inboxLabelId, bulk],
	);

	const handleClearFilter = useCallback(() => {
		setFilterLabelIds([]);
	}, []);

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
		async (data: {
			identityId?: number;
			to: string;
			cc: string;
			bcc: string;
			subject: string;
			body: string;
			htmlBody?: string;
		}) => {
			const sendIdentityId = data.identityId ?? selectedIdentityId;
			if (!sendIdentityId) throw new Error("No email identity selected");

			const parseAddresses = (raw: string): string[] =>
				raw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);

			// Build threading headers for replies/forwards
			const { inReplyTo, references } =
				composeMode && composeMode.type !== "new"
					? buildThreadingHeaders(composeMode.original)
					: { inReplyTo: undefined, references: undefined };

			await api.send({
				identity_id: sendIdentityId,
				to: parseAddresses(data.to),
				cc: data.cc ? parseAddresses(data.cc) : undefined,
				bcc: data.bcc ? parseAddresses(data.bcc) : undefined,
				subject: data.subject,
				text_body: data.body,
				html_body: data.htmlBody,
				in_reply_to: inReplyTo,
				references,
			});

			setComposeMode(null);
			toast("Message sent", "success");
			refetchMessages();
			refetchLabels();
		},
		[selectedIdentityId, composeMode, refetchMessages, refetchLabels],
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
		effectiveLabelId: archiveLabelId,
		isAllMail: archiveDisabled,
		refetchMessages,
		refetchLabels,
		refetchAllMailCount,
		refetchUnreadCount,
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
				else if (selectedMessageId) {
					setSelectedMessageId(null);
					if (openedFromSearch) {
						setShowSearch(true);
						setOpenedFromSearch(false);
					}
				}
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
			openedFromSearch,
			handleCompose,
			handleReply,
			handleReplyAll,
			handleForward,
			msgActions,
			bulk,
		],
	);

	useKeyboardShortcuts(shortcuts);

	// Auto-recover when server comes back after a connection failure.
	// Polls /api/status and updates containerState so the correct screen renders.
	useEffect(() => {
		if (!identitiesError) return;
		let active = true;
		// Sequential scheduling: wait for each probe to complete before
		// scheduling the next, so slow responses don't stack up.
		async function probe() {
			if (!active) return;
			try {
				const { state } = await api.status();
				if (!active) return;
				if (state !== containerState) {
					setContainerState(state);
				} else if (state === "unlocked") {
					refetchIdentities();
				}
			} catch {
				// Still unreachable — keep polling
			}
			if (active) setTimeout(probe, 3000);
		}
		probe();
		return () => {
			active = false;
		};
	}, [identitiesError, containerState, refetchIdentities]);

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

	if (identitiesError) {
		return (
			<div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
				<div className="text-center space-y-3">
					<div className="w-8 h-8 mx-auto border-2 border-stork-600 border-t-transparent rounded-full animate-spin" />
					<p className="text-gray-600 dark:text-gray-400">Reconnecting to server…</p>
					<p className="text-sm text-gray-400">{identitiesError}</p>
				</div>
			</div>
		);
	}

	// First-run: show welcome screen when no inbound connectors exist yet.
	// Checking connectors (not identities) means users who configure a connector
	// manually via Settings won't see the welcome screen again.
	if (Array.isArray(inboundConnectors) && inboundConnectors.length === 0) {
		return (
			<Welcome
				onSetupComplete={() => {
					refetchIdentities();
					refetchInboundConnectors();
				}}
				dark={dark}
				onToggleDark={toggleDark}
			/>
		);
	}

	return (
		<div className="h-screen flex flex-col overflow-hidden">
			<DemoBanner />
			<div className="flex-1 flex min-h-0 overflow-hidden">
				{/* Skip to content link — visible on Tab for keyboard users */}
				<a
					href="#message-list"
					className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-stork-600 focus:text-white focus:rounded-md focus:text-sm"
				>
					Skip to messages
				</a>
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
						identities={identities ?? []}
						labels={labels ?? []}
						selectedLabelId={effectiveLabelId}
						filterLabelIds={filterLabelIds}
						onSelectLabel={handleSelectLabel}
						onToggleFilterLabel={handleToggleFilterLabel}
						onClearFilter={handleClearFilter}
						onCompose={handleCompose}
						onSearch={(query) => {
							setInitialSearchQuery(query);
							setShowSearch(true);
						}}
						onSettings={() => setShowSettings(true)}
						onSyncNow={handleSyncNow}
						dark={dark}
						onToggleDark={toggleDark}
						syncing={syncing}
						syncError={syncError}
						syncStatus={syncStatus}
						onLabelsChanged={refetchLabels}
						allMailCount={allMailCount}
						unreadCount={unreadCount}
						inboxLabel={inboxLabel}
						unifiedInboxCount={unifiedInboxCount}
						unifiedAllMailCount={unifiedAllMailCount}
						unifiedUnreadCount={unifiedUnreadCount}
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

					{/* Message list panel — hidden on mobile when viewing a message (unless search is active) */}
					<div
						id="message-list"
						className={`w-full md:w-80 xl:w-96 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col min-h-0 ${
							selectedMessageId !== null && !showSearch ? "hidden md:flex" : "flex"
						}`}
					>
						{showSearch ? (
							<SearchPanel
								onClose={() => {
									setShowSearch(false);
									setInitialSearchQuery("");
								}}
								onSelectMessage={(id) => {
									setSelectedMessageId(id);
									setOpenedFromSearch(true);
								}}
								inboundConnectorId={null}
								onResultsChange={setSearchResults}
								onQueryChange={setActiveSearchQuery}
								initialQuery={initialSearchQuery}
							/>
						) : (
							<MessageList
								messages={allMessages}
								selectedId={selectedMessageId}
								focusedId={focusedMessage?.id ?? null}
								onSelect={handleSelectMessage}
								loading={messagesLoading}
								error={messagesError}
								folderName={currentLabelName}
								onRefresh={refetchMessages}
								hasMore={hasMore}
								onLoadMore={handleLoadMore}
								loadingMore={loadingMore}
								onToggleStar={handleToggleStar}
								inboundConnectors={
									isUnifiedInbox || isUnifiedAllMail || isUnifiedUnread || filterLabelIds.length > 1
										? (inboundConnectors ?? undefined)
										: undefined
								}
								totalCount={
									isUnifiedInbox
										? unifiedInboxCount?.total
										: isUnifiedAllMail
											? unifiedAllMailCount?.total
											: isUnifiedUnread
												? unifiedUnreadCount?.total
												: isAllMail
													? allMailCount?.total
													: isUnread
														? unreadCount?.total
														: isInbox
															? inboxLabel?.message_count
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
								onBulkArchive={!archiveDisabled ? bulk.archive : undefined}
								folders={folders ?? []}
								suggestedLabels={relatedLabels ?? undefined}
								onAddFilterLabel={handleToggleFilterLabel}
								filterLabelIds={filterLabelIds}
								allLabels={labels ?? undefined}
								onRemoveFilterLabel={handleToggleFilterLabel}
								onClearFilter={handleClearFilter}
							/>
						)}
					</div>

					{/* Message detail / thread view — hidden on mobile when no message selected */}
					<div
						className={`flex-1 min-w-0 ${selectedMessageId === null ? "hidden md:flex" : "flex"}`}
					>
						<MessageDetail
							message={selectedMessage ?? null}
							thread={thread ?? []}
							loading={messageLoading && selectedMessageId !== null}
							error={messageError}
							dark={dark}
							onReply={handleReply}
							onReplyAll={handleReplyAll}
							onForward={handleForward}
							openedFromSearch={openedFromSearch}
							searchPosition={
								searchResultIndex >= 0
									? { current: searchResultIndex + 1, total: searchResults.length }
									: undefined
							}
							onSearchPrev={searchResultIndex > 0 ? handleSearchPrev : undefined}
							onSearchNext={
								searchResultIndex >= 0 && searchResultIndex < searchResults.length - 1
									? handleSearchNext
									: undefined
							}
							onBack={() => {
								setSelectedMessageId(null);
								if (openedFromSearch) {
									setShowSearch(true);
									setOpenedFromSearch(false);
								}
							}}
							onMessageChanged={() => {
								refetchMessage();
								refetchMessages();
								refetchLabels();
								refetchUnreadCount();
							}}
							onMessageDeleted={() => {
								setSelectedMessageId(null);
								refetchMessages();
								refetchLabels();
								refetchUnreadCount();
							}}
							folders={folders ?? []}
							identityId={effectiveIdentityId}
							onLabelsChanged={refetchLabels}
							searchQuery={openedFromSearch ? activeSearchQuery : undefined}
						/>
					</div>
				</div>

				{/* Modals */}
				{composeMode && (
					<ComposeModal
						mode={composeMode}
						identities={identities ?? []}
						selectedIdentityId={effectiveIdentityId}
						onClose={() => setComposeMode(null)}
						onSend={handleSend}
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
		</div>
	);
}
