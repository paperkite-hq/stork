import { useRef } from "react";
import { useFocusTrap } from "../hooks";
import { XIcon } from "./Icons";

interface ShortcutsHelpProps {
	onClose: () => void;
}

const shortcuts = [
	{ key: "j / ↓", desc: "Next message" },
	{ key: "k / ↑", desc: "Previous message" },
	{ key: "Enter", desc: "Open message" },
	{ key: "Escape", desc: "Close / go back" },
	{ key: "r", desc: "Reply" },
	{ key: "a", desc: "Reply all" },
	{ key: "f", desc: "Forward" },
	{ key: "c", desc: "Compose new" },
	{ key: "s", desc: "Star / unstar message" },
	{ key: "u", desc: "Toggle read / unread" },
	{ key: "d", desc: "Delete message" },
	{ key: "e", desc: "Archive message" },
	{ key: "x", desc: "Select / deselect message" },
	{ key: "/", desc: "Search" },
	{ key: "?", desc: "Show shortcuts" },
	{ key: "⌘+Enter", desc: "Send message" },
];

export function ShortcutsHelp({ onClose }: ShortcutsHelpProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
		>
			<div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-sm w-full">
				<div className="flex items-center justify-between mb-4">
					<h3 className="font-semibold text-lg">Keyboard Shortcuts</h3>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
					>
						<XIcon className="w-4 h-4" />
					</button>
				</div>
				<div className="space-y-2">
					{shortcuts.map((s) => (
						<div key={s.key} className="flex items-center justify-between">
							<span className="text-sm text-gray-600 dark:text-gray-400">{s.desc}</span>
							<kbd className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
								{s.key}
							</kbd>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
