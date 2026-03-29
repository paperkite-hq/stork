import { type ReactNode, useRef, useState } from "react";
import { useFocusTrap } from "../hooks";
import { LinkIcon, SettingsIcon, ShieldIcon, XIcon } from "./Icons";
import { ConnectorsTab } from "./settings/ConnectorsTab";
import { GeneralTab } from "./settings/GeneralTab";
import { SecurityTab } from "./settings/SecurityTab";

interface SettingsProps {
	onClose: () => void;
}

type SettingsTab = "connectors" | "general" | "security";

export function Settings({ onClose }: SettingsProps) {
	const [tab, setTab] = useState<SettingsTab>("connectors");
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			onClick={(e) => {
				// Close when clicking the backdrop (outside the modal panel)
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				// useFocusTrap keeps focus inside the dialog, so this handler
				// fires even when inputs are focused (unlike the app-level
				// useKeyboardShortcuts which skips inputs).
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-[800px] h-[85vh] mx-4 flex flex-col overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
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

				{/* Mobile tab bar — horizontal, shown below md */}
				<nav className="sm:hidden flex border-b border-gray-200 dark:border-gray-800">
					<MobileTabButton
						active={tab === "connectors"}
						onClick={() => setTab("connectors")}
						label="Connectors"
					/>
					<MobileTabButton
						active={tab === "general"}
						onClick={() => setTab("general")}
						label="General"
					/>
					<MobileTabButton
						active={tab === "security"}
						onClick={() => setTab("security")}
						label="Security"
					/>
				</nav>

				<div className="flex flex-1 min-h-0">
					{/* Sidebar tabs — hidden on mobile */}
					<nav className="hidden sm:block w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 p-3 space-y-1">
						<TabButton
							active={tab === "connectors"}
							onClick={() => setTab("connectors")}
							label="Connectors"
							icon={<LinkIcon className="w-4 h-4" />}
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
					<div className="flex-1 overflow-y-auto p-4 sm:p-6">
						{tab === "connectors" && <ConnectorsTab />}
						{tab === "general" && <GeneralTab />}
						{tab === "security" && <SecurityTab />}
					</div>
				</div>
			</div>
		</div>
	);
}

function MobileTabButton({
	active,
	onClick,
	label,
}: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
				active
					? "text-stork-600 dark:text-stork-400 border-b-2 border-stork-500"
					: "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
			}`}
		>
			{label}
		</button>
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
