import { useEffect, useRef, useState } from "react";
import type { Folder } from "../api";
import { ArchiveIcon, FolderIcon, MailIcon, MailOpenIcon, TrashIcon, XIcon } from "./Icons";

interface BulkActionsBarProps {
	count: number;
	total: number;
	allSelected: boolean;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onDelete: () => void;
	onMarkRead: () => void;
	onMarkUnread: () => void;
	onMove: (folderId: number) => void;
	onArchive?: () => void;
	folders: Folder[];
}

export function BulkActionsBar({
	count,
	total,
	allSelected,
	onSelectAll,
	onClearSelection,
	onDelete,
	onMarkRead,
	onMarkUnread,
	onMove,
	onArchive,
	folders,
}: BulkActionsBarProps) {
	const [showMoveMenu, setShowMoveMenu] = useState(false);
	const moveMenuRef = useRef<HTMLDivElement>(null);

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

	return (
		<div
			className="flex items-center gap-2 px-4 py-2 bg-stork-50 dark:bg-stork-950 border-b border-stork-200 dark:border-stork-800"
			data-testid="bulk-actions-bar"
		>
			{/* Selection count + select-all toggle */}
			<span className="text-sm font-medium text-stork-700 dark:text-stork-300 mr-1">
				{count} selected
			</span>
			{!allSelected && (
				<button
					type="button"
					onClick={onSelectAll}
					className="text-xs text-stork-600 dark:text-stork-400 hover:underline"
				>
					Select all {total}
				</button>
			)}

			<div className="flex-1" />

			{/* Action buttons */}
			<button
				type="button"
				onClick={onMarkRead}
				title="Mark as read"
				aria-label="Mark as read"
				className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-stork-100 dark:hover:bg-stork-900 transition-colors"
			>
				<MailOpenIcon className="w-4 h-4" />
			</button>
			<button
				type="button"
				onClick={onMarkUnread}
				title="Mark as unread"
				aria-label="Mark as unread"
				className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-stork-100 dark:hover:bg-stork-900 transition-colors"
			>
				<MailIcon className="w-4 h-4" />
			</button>

			{/* Move dropdown — click-based with outside-click dismiss */}
			{folders.length > 0 && (
				<div className="relative" ref={moveMenuRef}>
					<button
						type="button"
						onClick={() => setShowMoveMenu((v) => !v)}
						title="Move to folder"
						aria-label="Move to folder"
						aria-haspopup="true"
						aria-expanded={showMoveMenu}
						className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-stork-100 dark:hover:bg-stork-900 transition-colors"
					>
						<FolderIcon className="w-4 h-4" />
					</button>
					{showMoveMenu && (
						<div
							role="menu"
							className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px] max-h-64 overflow-y-auto"
						>
							{folders.map((folder) => (
								<button
									key={folder.id}
									type="button"
									role="menuitem"
									onClick={() => {
										onMove(folder.id);
										setShowMoveMenu(false);
									}}
									className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
								>
									{folder.name}
								</button>
							))}
						</div>
					)}
				</div>
			)}

			<button
				type="button"
				onClick={onDelete}
				title="Delete selected"
				aria-label="Delete selected"
				className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
			>
				<TrashIcon className="w-4 h-4" />
			</button>

			{/* Archive button */}
			{onArchive && (
				<button
					type="button"
					onClick={onArchive}
					title="Archive selected"
					aria-label="Archive selected"
					className="p-1.5 rounded text-gray-600 dark:text-gray-300 hover:bg-stork-100 dark:hover:bg-stork-900 transition-colors"
				>
					<ArchiveIcon className="w-4 h-4" />
				</button>
			)}

			{/* Clear selection */}
			<button
				type="button"
				onClick={onClearSelection}
				title="Clear selection"
				aria-label="Clear selection"
				className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ml-1"
			>
				<XIcon className="w-4 h-4" />
			</button>
		</div>
	);
}
