import { useCallback, useEffect, useRef, useState } from "react";
import type { Folder, Message } from "../api";
import { api } from "../api";
import { isFlagged, isUnread } from "../utils";
import { FolderIcon, StarIcon, TrashIcon } from "./Icons";
import { MessageLabelPicker } from "./LabelManager";
import { toast } from "./Toast";

interface MessageHeaderActionsProps {
	message: Message;
	folders?: Folder[];
	accountId?: number | null;
	onMessageChanged?: () => void;
	onMessageDeleted?: () => void;
	onLabelsChanged?: () => void;
	onRequestDelete: (msg: Message) => void;
}

/** Action buttons shown in the message detail header: star, mark read/unread,
 *  move-to-folder, labels, and delete. Extracted from MessageDetail to reduce
 *  component complexity. */
export function MessageHeaderActions({
	message,
	folders,
	accountId,
	onMessageChanged,
	onMessageDeleted,
	onLabelsChanged,
	onRequestDelete,
}: MessageHeaderActionsProps) {
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

	return (
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
				onClick={() => onRequestDelete(message)}
				className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors text-gray-400 hover:text-red-600 dark:hover:text-red-400"
				title="Delete message"
			>
				<TrashIcon className="w-4 h-4" />
			</button>
		</div>
	);
}
