import { useState } from "react";
import { useDesktopNotifications } from "../../hooks";

function ShortcutRow({ keys, action }: { keys: string; action: string }) {
	return (
		<div className="flex items-center justify-between py-0.5">
			<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400 font-mono">
				{keys}
			</kbd>
			<span className="text-gray-600 dark:text-gray-400">{action}</span>
		</div>
	);
}

export function GeneralTab() {
	const [notificationsEnabled, setNotificationsEnabled] = useState(
		() => localStorage.getItem("stork-notifications") !== "false",
	);
	const { permission, requestPermission } = useDesktopNotifications();
	const [messagesPerPage, setMessagesPerPage] = useState(
		() => Number(localStorage.getItem("stork-messages-per-page")) || 50,
	);
	const [theme, setTheme] = useState(() => {
		const stored = localStorage.getItem("stork-dark-mode");
		if (stored === "true") return "dark";
		if (stored === "false") return "light";
		return "system";
	});

	const saveGeneral = () => {
		localStorage.setItem("stork-notifications", String(notificationsEnabled));
		localStorage.setItem("stork-messages-per-page", String(messagesPerPage));
		if (theme === "dark") {
			localStorage.setItem("stork-dark-mode", "true");
			document.documentElement.classList.add("dark");
		} else if (theme === "light") {
			localStorage.setItem("stork-dark-mode", "false");
			document.documentElement.classList.remove("dark");
		} else {
			localStorage.removeItem("stork-dark-mode");
			const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
			document.documentElement.classList.toggle("dark", prefersDark);
		}
	};

	return (
		<div className="space-y-6">
			<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">General Settings</h3>

			<div className="space-y-4">
				{/* Theme */}
				<label className="block text-sm text-gray-700 dark:text-gray-300">
					<span className="block mb-1">Theme</span>
					<select
						value={theme}
						onChange={(e) => setTheme(e.target.value)}
						className="w-48 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5"
					>
						<option value="system">System Default</option>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
					</select>
				</label>

				{/* Messages per page */}
				<label className="block text-sm text-gray-700 dark:text-gray-300">
					<span className="block mb-1">Messages per page</span>
					<select
						value={messagesPerPage}
						onChange={(e) => setMessagesPerPage(Number(e.target.value))}
						className="w-48 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5"
					>
						<option value={25}>25</option>
						<option value={50}>50</option>
						<option value={100}>100</option>
					</select>
				</label>

				{/* Notifications */}
				<div className="space-y-1">
					<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
						<input
							type="checkbox"
							checked={notificationsEnabled}
							onChange={async (e) => {
								const enabling = e.target.checked;
								setNotificationsEnabled(enabling);
								if (enabling && permission === "default") {
									await requestPermission();
								}
							}}
							className="rounded border-gray-300 dark:border-gray-600"
						/>
						Enable desktop notifications for new mail
					</label>
					{notificationsEnabled && permission === "denied" && (
						<p className="text-xs text-amber-600 dark:text-amber-400 ml-6">
							Browser permission is blocked. Enable notifications in your browser settings.
						</p>
					)}
				</div>
			</div>

			<div className="pt-2">
				<button
					type="button"
					onClick={saveGeneral}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 text-white rounded-md text-sm font-medium transition-colors"
				>
					Save Preferences
				</button>
			</div>

			{/* Keyboard shortcuts reference */}
			<div className="pt-4 border-t border-gray-200 dark:border-gray-700">
				<h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
					Keyboard Shortcuts
				</h4>
				<div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
					<ShortcutRow keys="j / k" action="Navigate messages" />
					<ShortcutRow keys="Enter" action="Open message" />
					<ShortcutRow keys="Escape" action="Close / go back" />
					<ShortcutRow keys="c" action="Compose new message" />
					<ShortcutRow keys="r" action="Reply to message" />
					<ShortcutRow keys="a" action="Reply all" />
					<ShortcutRow keys="f" action="Forward message" />
					<ShortcutRow keys="s" action="Star / unstar message" />
					<ShortcutRow keys="u" action="Toggle read / unread" />
					<ShortcutRow keys="d" action="Delete message" />
					<ShortcutRow keys="e" action="Archive message" />
					<ShortcutRow keys="x" action="Select / deselect" />
					<ShortcutRow keys="/" action="Search" />
					<ShortcutRow keys="?" action="Show shortcuts help" />
					<ShortcutRow keys="⌘+Enter" action="Send message" />
				</div>
			</div>
		</div>
	);
}
