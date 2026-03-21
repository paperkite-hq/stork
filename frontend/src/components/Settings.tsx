import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import { useAsync } from "../hooks";
import { MailIcon, SettingsIcon, ShieldIcon, XIcon } from "./Icons";
import { AccountsTab } from "./settings/AccountsTab";
import { GeneralTab } from "./settings/GeneralTab";
import { SecurityTab } from "./settings/SecurityTab";

interface SettingsProps {
	onClose: () => void;
}

type SettingsTab = "accounts" | "general" | "security";

export function Settings({ onClose }: SettingsProps) {
	const [tab, setTab] = useState<SettingsTab>("accounts");
	const { data: accounts, refetch: refetchAccounts } = useAsync(() => api.accounts.list(), []);

	const [editingAccountId, setEditingAccountId] = useState<number | "new" | null>(null);
	const [syncStatusAccountId, setSyncStatusAccountId] = useState<number | null>(null);

	// Close on Escape (fires even when inputs inside the modal are focused,
	// unlike the app-level useKeyboardShortcuts hook which skips inputs)
	useEffect(() => {
		function handler(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			onClick={(e) => {
				// Close when clicking the backdrop (outside the modal panel)
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				// Escape is also handled by the useEffect above; this satisfies
				// the a11y requirement that interactive divs have keyboard handlers.
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[800px] max-h-[85vh] flex flex-col overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
					<h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close settings"
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5"
					>
						<XIcon className="w-5 h-5" />
					</button>
				</div>

				<div className="flex flex-1 min-h-0">
					{/* Sidebar tabs */}
					<nav className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 p-3 space-y-1">
						<TabButton
							active={tab === "accounts"}
							onClick={() => setTab("accounts")}
							label="Accounts"
							icon={<MailIcon className="w-4 h-4" />}
						/>
						<TabButton
							active={tab === "general"}
							onClick={() => setTab("general")}
							label="General"
							icon={<SettingsIcon className="w-4 h-4" />}
						/>
						<TabButton
							active={tab === "security"}
							onClick={() => setTab("security")}
							label="Security"
							icon={<ShieldIcon className="w-4 h-4" />}
						/>
					</nav>

					{/* Content */}
					<div className="flex-1 overflow-y-auto p-6">
						{tab === "accounts" && (
							<AccountsTab
								accounts={accounts ?? []}
								editingAccountId={editingAccountId}
								onEdit={setEditingAccountId}
								onRefetch={refetchAccounts}
								syncStatusAccountId={syncStatusAccountId}
								onShowSync={setSyncStatusAccountId}
							/>
						)}
						{tab === "general" && <GeneralTab />}
						{tab === "security" && <SecurityTab />}
					</div>
				</div>
			</div>
		</div>
	);
}

function TabButton({
	active,
	onClick,
	label,
	icon,
}: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
				active
					? "bg-stork-100 dark:bg-stork-950 text-stork-700 dark:text-stork-300 font-medium"
					: "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
			}`}
		>
			{icon}
			{label}
		</button>
	);
}
