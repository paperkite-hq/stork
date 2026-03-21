import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SearchResult, api } from "../api";
import { useFocusTrap } from "../hooks";
import { SearchIcon, XIcon } from "./Icons";
import { toast } from "./Toast";

interface SearchPanelProps {
	onClose: () => void;
	onSelectMessage: (id: number) => void;
	accountId: number | null;
}

export function SearchPanel({ onClose, onSelectMessage, accountId }: SearchPanelProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [searched, setSearched] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	const doSearch = useCallback(
		(q: string) => {
			if (!q.trim()) {
				setResults([]);
				setSearched(false);
				return;
			}
			setLoading(true);
			api
				.search(q, { accountId: accountId ?? undefined, limit: 30 })
				.then((r) => {
					setResults(r);
					setSearched(true);
					setFocusedIndex(r.length > 0 ? 0 : -1);
				})
				.catch(() => {
					setResults([]);
					setFocusedIndex(-1);
					toast("Search failed", "error");
				})
				.finally(() => setLoading(false));
		},
		[accountId],
	);

	// Cleanup debounce timeout on unmount to prevent setState on unmounted component
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	const handleChange = useCallback(
		(value: string) => {
			setQuery(value);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => doSearch(value), 300);
		},
		[doSearch],
	);

	// Scroll focused result into view
	useEffect(() => {
		if (focusedIndex >= 0) {
			resultRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
		}
	}, [focusedIndex]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
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

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/30"
			role="dialog"
			aria-modal="true"
			aria-label="Search messages"
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
				</div>

				{/* Hint */}
				<div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
					Tip: Use <kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">↑</kbd>/
					<kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">↓</kbd> to navigate,{" "}
					<kbd className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Enter</kbd> to select. AND, OR,
					NOT, "phrases" for advanced search
				</div>
			</div>
		</div>
	);
}
