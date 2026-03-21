import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SearchResult, api } from "../api";
import { useFocusTrap } from "../hooks";
import {
	CalendarIcon,
	FilterIcon,
	MailOpenIcon,
	PaperclipIcon,
	SearchIcon,
	StarIcon,
	XIcon,
} from "./Icons";
import { toast } from "./Toast";

interface SearchPanelProps {
	onClose: () => void;
	onSelectMessage: (id: number) => void;
	accountId: number | null;
}

interface ActiveFilter {
	type: string;
	value: string;
	label: string;
}

const SEARCH_PAGE_SIZE = 30;

const QUICK_FILTERS: { type: string; value: string; label: string; icon: React.ReactNode }[] = [
	{
		type: "is",
		value: "unread",
		label: "Unread",
		icon: <MailOpenIcon className="w-3.5 h-3.5" />,
	},
	{
		type: "is",
		value: "starred",
		label: "Starred",
		icon: <StarIcon className="w-3.5 h-3.5" />,
	},
	{
		type: "has",
		value: "attachment",
		label: "Has attachment",
		icon: <PaperclipIcon className="w-3.5 h-3.5" />,
	},
];

function filterKey(f: ActiveFilter): string {
	return `${f.type}:${f.value}`;
}

function buildQueryWithFilters(text: string, filters: ActiveFilter[]): string {
	const parts = [text.trim()];
	for (const f of filters) {
		const val = f.value.includes(" ") ? `"${f.value}"` : f.value;
		parts.push(`${f.type}:${val}`);
	}
	return parts.filter(Boolean).join(" ");
}

export function SearchPanel({ onClose, onSelectMessage, accountId }: SearchPanelProps) {
	const [query, setQuery] = useState("");
	const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [searched, setSearched] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const [showDateFilter, setShowDateFilter] = useState(false);
	const [dateAfter, setDateAfter] = useState("");
	const [dateBefore, setDateBefore] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const dialogRef = useRef<HTMLDivElement>(null);
	const lastQueryRef = useRef("");
	useFocusTrap(dialogRef);

	const doSearch = useCallback(
		(fullQuery: string) => {
			if (!fullQuery.trim()) {
				setResults([]);
				setSearched(false);
				setHasMore(false);
				return;
			}
			lastQueryRef.current = fullQuery;
			setLoading(true);
			api
				.search(fullQuery, { accountId: accountId ?? undefined, limit: SEARCH_PAGE_SIZE })
				.then((r) => {
					setResults(r);
					setSearched(true);
					setHasMore(r.length >= SEARCH_PAGE_SIZE);
					setFocusedIndex(r.length > 0 ? 0 : -1);
				})
				.catch(() => {
					setResults([]);
					setFocusedIndex(-1);
					setHasMore(false);
					toast("Search failed", "error");
				})
				.finally(() => setLoading(false));
		},
		[accountId],
	);

	const triggerSearch = useCallback(
		(text: string, filters: ActiveFilter[]) => {
			const fullQuery = buildQueryWithFilters(text, filters);
			doSearch(fullQuery);
		},
		[doSearch],
	);

	const handleLoadMore = useCallback(() => {
		if (loadingMore || !lastQueryRef.current) return;
		setLoadingMore(true);
		api
			.search(lastQueryRef.current, {
				accountId: accountId ?? undefined,
				limit: SEARCH_PAGE_SIZE,
				offset: results.length,
			})
			.then((more) => {
				setResults((prev) => [...prev, ...more]);
				setHasMore(more.length >= SEARCH_PAGE_SIZE);
			})
			.catch(() => {
				toast("Failed to load more results", "error");
			})
			.finally(() => setLoadingMore(false));
	}, [accountId, results.length, loadingMore]);

	// Cleanup debounce timeout on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	const handleChange = useCallback(
		(value: string) => {
			setQuery(value);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => triggerSearch(value, activeFilters), 300);
		},
		[triggerSearch, activeFilters],
	);

	const toggleFilter = useCallback(
		(type: string, value: string, label: string) => {
			setActiveFilters((prev) => {
				const key = filterKey({ type, value, label });
				const exists = prev.some((f) => filterKey(f) === key);
				const next = exists
					? prev.filter((f) => filterKey(f) !== key)
					: [...prev, { type, value, label }];
				// Trigger search with updated filters
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => triggerSearch(query, next), 150);
				return next;
			});
		},
		[query, triggerSearch],
	);

	const removeFilter = useCallback(
		(filter: ActiveFilter) => {
			setActiveFilters((prev) => {
				const next = prev.filter((f) => filterKey(f) !== filterKey(filter));
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => triggerSearch(query, next), 150);
				return next;
			});
		},
		[query, triggerSearch],
	);

	const applyDateFilter = useCallback(() => {
		const newFilters = activeFilters.filter((f) => f.type !== "after" && f.type !== "before");
		if (dateAfter) {
			newFilters.push({ type: "after", value: dateAfter, label: `After ${dateAfter}` });
		}
		if (dateBefore) {
			newFilters.push({ type: "before", value: dateBefore, label: `Before ${dateBefore}` });
		}
		setActiveFilters(newFilters);
		setShowDateFilter(false);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => triggerSearch(query, newFilters), 150);
	}, [dateAfter, dateBefore, activeFilters, query, triggerSearch]);

	// Scroll focused result into view
	useEffect(() => {
		if (focusedIndex >= 0) {
			resultRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
		}
	}, [focusedIndex]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
				return;
			}
			if (e.key === "Enter" && focusedIndex >= 0 && results[focusedIndex]) {
				e.preventDefault();
				onSelectMessage(results[focusedIndex].id);
				onClose();
			}
		},
		[results, focusedIndex, onSelectMessage, onClose],
	);

	const isFilterActive = (type: string, value: string) =>
		activeFilters.some((f) => f.type === type && f.value === value);

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/30"
			role="dialog"
			aria-modal="true"
			aria-label="Search messages"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col max-h-[70vh]">
				{/* Search input */}
				<div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
					<SearchIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
					<input
						type="text"
						value={query}
						onChange={(e) => handleChange(e.target.value)}
						onKeyDown={handleKeyDown}
						className="flex-1 bg-transparent text-sm outline-none"
						placeholder="Search messages…"
						autoFocus
					/>
					{loading && <span className="text-xs text-gray-400 animate-pulse">Searching…</span>}
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
					>
						<XIcon className="w-4 h-4" />
					</button>
				</div>

				{/* Quick filters */}
				<div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-wrap">
					<FilterIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
					{QUICK_FILTERS.map((qf) => (
						<button
							key={`${qf.type}:${qf.value}`}
							type="button"
							onClick={() => toggleFilter(qf.type, qf.value, qf.label)}
							className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
								isFilterActive(qf.type, qf.value)
									? "bg-stork-100 text-stork-700 dark:bg-stork-900 dark:text-stork-300"
									: "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
							}`}
						>
							{qf.icon}
							{qf.label}
						</button>
					))}
					<button
						type="button"
						onClick={() => setShowDateFilter((v) => !v)}
						className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
							activeFilters.some((f) => f.type === "after" || f.type === "before")
								? "bg-stork-100 text-stork-700 dark:bg-stork-900 dark:text-stork-300"
								: "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
						}`}
					>
						<CalendarIcon className="w-3.5 h-3.5" />
						Date range
					</button>
				</div>

				{/* Date range picker */}
				{showDateFilter && (
					<div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
						<label className="text-xs text-gray-500">
							After:
							<input
								type="date"
								value={dateAfter}
								onChange={(e) => setDateAfter(e.target.value)}
								className="ml-1 bg-transparent text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5"
							/>
						</label>
						<label className="text-xs text-gray-500">
							Before:
							<input
								type="date"
								value={dateBefore}
								onChange={(e) => setDateBefore(e.target.value)}
								className="ml-1 bg-transparent text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5"
							/>
						</label>
						<button
							type="button"
							onClick={applyDateFilter}
							className="text-xs px-2 py-0.5 bg-stork-600 text-white rounded hover:bg-stork-700 transition-colors"
						>
							Apply
						</button>
					</div>
				)}

				{/* Active filter chips */}
				{activeFilters.length > 0 && (
					<div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 flex-wrap">
						{activeFilters.map((f) => (
							<span
								key={filterKey(f)}
								className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-stork-100 text-stork-700 dark:bg-stork-900 dark:text-stork-300"
							>
								{f.label}
								<button
									type="button"
									onClick={() => removeFilter(f)}
									className="hover:text-stork-900 dark:hover:text-stork-100"
									aria-label={`Remove ${f.label} filter`}
								>
									<XIcon className="w-3 h-3" />
								</button>
							</span>
						))}
						<button
							type="button"
							onClick={() => {
								setActiveFilters([]);
								setDateAfter("");
								setDateBefore("");
								if (debounceRef.current) clearTimeout(debounceRef.current);
								debounceRef.current = setTimeout(() => triggerSearch(query, []), 150);
							}}
							className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
						>
							Clear all
						</button>
					</div>
				)}

				{/* Results */}
				<div className="flex-1 overflow-y-auto">
					{searched && results.length === 0 && (
						<div className="p-6 text-center text-gray-400 text-sm">No results for "{query}"</div>
					)}
					{results.map((r, idx) => (
						<button
							key={r.id}
							ref={(el) => {
								resultRefs.current[idx] = el;
							}}
							type="button"
							onClick={() => {
								onSelectMessage(r.id);
								onClose();
							}}
							onMouseEnter={() => setFocusedIndex(idx)}
							aria-label={`${r.subject || "No subject"} from ${r.from_name || r.from_address}`}
							aria-selected={idx === focusedIndex}
							className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 transition-colors ${
								idx === focusedIndex
									? "bg-stork-50 dark:bg-stork-950"
									: "hover:bg-gray-50 dark:hover:bg-gray-800"
							}`}
						>
							<div className="flex items-baseline gap-2">
								<span className="text-sm font-medium truncate">
									{r.from_name || r.from_address}
								</span>
								<span className="text-xs text-gray-400 flex-shrink-0">
									{new Date(r.date).toLocaleDateString()}
								</span>
							</div>
							<div className="text-sm text-gray-700 dark:text-gray-300 truncate">
								{r.subject || "(no subject)"}
							</div>
							{r.snippet && (
								<div
									className="text-xs text-gray-500 mt-0.5 line-clamp-1"
									dangerouslySetInnerHTML={{
										__html: DOMPurify.sanitize(r.snippet, {
											ALLOWED_TAGS: ["b", "mark"],
										}),
									}}
								/>
							)}
						</button>
					))}
					{hasMore && (
						<div className="px-4 py-3 text-center">
							<button
								type="button"
								onClick={handleLoadMore}
								disabled={loadingMore}
								className="text-sm text-stork-600 dark:text-stork-400 hover:text-stork-700 dark:hover:text-stork-300 disabled:opacity-50 transition-colors"
							>
								{loadingMore ? "Loading…" : `Load more results (${results.length} shown)`}
							</button>
						</div>
					)}
				</div>

				{/* Hint */}
				<div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
					Tip: <kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">↑</kbd>/
					<kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">↓</kbd> to navigate,{" "}
					<kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Enter</kbd> to select.{" "}
					<span className="text-gray-300 dark:text-gray-600">|</span>{" "}
					<code className="text-gray-500">from:</code> <code className="text-gray-500">to:</code>{" "}
					<code className="text-gray-500">subject:</code>{" "}
					<code className="text-gray-500">has:attachment</code>{" "}
					<code className="text-gray-500">is:unread</code>{" "}
					<code className="text-gray-500">before:</code>{" "}
					<code className="text-gray-500">after:</code>
				</div>
			</div>
		</div>
	);
}
