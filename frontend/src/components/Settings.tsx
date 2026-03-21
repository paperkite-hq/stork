import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type AccountDetail, type SyncStatus, api } from "../api";
import { useAsync } from "../hooks";
import { ConfirmDialog } from "./ConfirmDialog";
import { MailIcon, SettingsIcon, ShieldIcon, XIcon } from "./Icons";

interface SettingsProps {
	onClose: () => void;
}

interface AccountFormData {
	name: string;
	email: string;
	imap_host: string;
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	imap_pass: string;
	smtp_host: string;
	smtp_port: number;
	smtp_tls: number;
	smtp_user: string;
	smtp_pass: string;
	sync_delete_from_server: number;
}

const emptyForm: AccountFormData = {
	name: "",
	email: "",
	imap_host: "",
	imap_port: 993,
	imap_tls: 1,
	imap_user: "",
	imap_pass: "",
	smtp_host: "",
	smtp_port: 587,
	smtp_tls: 1,
	smtp_user: "",
	smtp_pass: "",
	sync_delete_from_server: 0,
};

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

// --- Accounts Tab ---

function AccountsTab({
	accounts,
	editingAccountId,
	onEdit,
	onRefetch,
	syncStatusAccountId,
	onShowSync,
}: {
	accounts: { id: number; name: string; email: string; imap_host: string }[];
	editingAccountId: number | "new" | null;
	onEdit: (id: number | "new" | null) => void;
	onRefetch: () => void;
	syncStatusAccountId: number | null;
	onShowSync: (id: number | null) => void;
}) {
	const [deleteTarget, setDeleteTarget] = useState<{
		id: number;
		name: string;
		email: string;
	} | null>(null);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Email Accounts</h3>
				<button
					type="button"
					onClick={() => onEdit("new")}
					className="px-3 py-1.5 bg-stork-600 hover:bg-stork-700 text-white rounded-md text-sm font-medium transition-colors"
				>
					+ Add Account
				</button>
			</div>

			{/* Account list */}
			{accounts.length === 0 && editingAccountId !== "new" && (
				<p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
					No accounts configured. Add one to get started.
				</p>
			)}

			{accounts.map((account) => (
				<div key={account.id}>
					{editingAccountId === account.id ? (
						<AccountForm
							accountId={account.id}
							onCancel={() => onEdit(null)}
							onSaved={() => {
								onEdit(null);
								onRefetch();
							}}
						/>
					) : (
						<AccountCard
							account={account}
							onEdit={() => onEdit(account.id)}
							onDelete={() => setDeleteTarget(account)}
							showSync={syncStatusAccountId === account.id}
							onToggleSync={() =>
								onShowSync(syncStatusAccountId === account.id ? null : account.id)
							}
						/>
					)}
				</div>
			))}

			{editingAccountId === "new" && (
				<AccountForm
					accountId={null}
					onCancel={() => onEdit(null)}
					onSaved={() => {
						onEdit(null);
						onRefetch();
					}}
				/>
			)}

			{deleteTarget && (
				<ConfirmDialog
					title="Delete account"
					message={`Delete "${deleteTarget.name}" (${deleteTarget.email})? This removes all synced messages and cannot be undone.`}
					confirmLabel="Delete Account"
					variant="danger"
					onConfirm={() => {
						api.accounts.delete(deleteTarget.id).then(onRefetch);
						setDeleteTarget(null);
					}}
					onCancel={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
}

function AccountCard({
	account,
	onEdit,
	onDelete,
	showSync,
	onToggleSync,
}: {
	account: { id: number; name: string; email: string; imap_host: string };
	onEdit: () => void;
	onDelete: () => void;
	showSync: boolean;
	onToggleSync: () => void;
}) {
	return (
		<div className="border border-gray-200 dark:border-gray-700 rounded-lg">
			<div className="flex items-center justify-between px-4 py-3">
				<div>
					<p className="text-sm font-medium text-gray-900 dark:text-gray-100">{account.name}</p>
					<p className="text-xs text-gray-500 dark:text-gray-400">
						{account.email} &middot; {account.imap_host}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onToggleSync}
						className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
						title="View sync status"
					>
						Sync Status
					</button>
					<button
						type="button"
						onClick={onEdit}
						className="text-xs text-stork-600 hover:text-stork-700 dark:text-stork-400 dark:hover:text-stork-300 px-2 py-1 rounded transition-colors"
					>
						Edit
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded transition-colors"
					>
						Delete
					</button>
				</div>
			</div>
			{showSync && <SyncStatusPanel accountId={account.id} />}
		</div>
	);
}

function SyncStatusPanel({ accountId }: { accountId: number }) {
	const { data: syncStatus, loading } = useAsync(
		() => api.accounts.syncStatus(accountId),
		[accountId],
	);

	if (loading) {
		return (
			<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
				Loading sync status...
			</div>
		);
	}

	return (
		<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
			<table className="w-full text-xs">
				<thead>
					<tr className="text-left text-gray-500 dark:text-gray-400">
						<th className="pb-1 font-medium">Folder</th>
						<th className="pb-1 font-medium text-right">Messages</th>
						<th className="pb-1 font-medium text-right">Unread</th>
						<th className="pb-1 font-medium text-right">Last Synced</th>
					</tr>
				</thead>
				<tbody>
					{(syncStatus ?? []).map((f: SyncStatus) => (
						<tr
							key={f.id}
							className="text-gray-700 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800"
						>
							<td className="py-1 truncate max-w-[180px]" title={f.path}>
								{f.name}
							</td>
							<td className="py-1 text-right">{f.message_count}</td>
							<td className="py-1 text-right">{f.unread_count}</td>
							<td className="py-1 text-right text-gray-400">
								{f.last_synced_at ? formatRelative(f.last_synced_at) : "Never"}
							</td>
						</tr>
					))}
					{(syncStatus ?? []).length === 0 && (
						<tr>
							<td colSpan={4} className="py-2 text-center text-gray-400">
								No folders synced yet
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

// --- Account Form ---

function AccountForm({
	accountId,
	onCancel,
	onSaved,
}: {
	accountId: number | null;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const [form, setForm] = useState<AccountFormData>(emptyForm);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(accountId === null);

	// Load existing account data
	const loadAccount = useCallback(async () => {
		if (accountId === null) return;
		try {
			const detail: AccountDetail = await api.accounts.get(accountId);
			setForm({
				name: detail.name,
				email: detail.email,
				imap_host: detail.imap_host,
				imap_port: detail.imap_port,
				imap_tls: detail.imap_tls,
				imap_user: detail.imap_user,
				imap_pass: "", // Never sent back from server
				smtp_host: detail.smtp_host ?? "",
				smtp_port: detail.smtp_port ?? 587,
				smtp_tls: detail.smtp_tls ?? 1,
				smtp_user: detail.smtp_user ?? "",
				smtp_pass: "",
				sync_delete_from_server: detail.sync_delete_from_server,
			});
			setLoaded(true);
		} catch (e) {
			setError((e as Error).message);
		}
	}, [accountId]);

	useEffect(() => {
		loadAccount();
	}, [loadAccount]);

	const setField = <K extends keyof AccountFormData>(key: K, value: AccountFormData[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			if (accountId === null) {
				await api.accounts.create({ ...form } as Record<string, unknown>);
			} else {
				// Only send non-empty password fields on update
				const update: Record<string, unknown> = { ...form };
				if (!update.imap_pass) update.imap_pass = undefined;
				if (!update.smtp_pass) update.smtp_pass = undefined;
				await api.accounts.update(accountId, update);
			}
			onSaved();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	};

	if (!loaded) {
		return (
			<div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-sm text-gray-400">
				Loading...
			</div>
		);
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="border border-stork-200 dark:border-stork-800 rounded-lg p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50"
		>
			<h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
				{accountId === null ? "Add Account" : "Edit Account"}
			</h4>

			{error && (
				<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
					{error}
				</div>
			)}

			{/* Basic info */}
			<div className="grid grid-cols-2 gap-3">
				<FormField
					label="Display Name"
					value={form.name}
					onChange={(v) => setField("name", v)}
					placeholder="Work Email"
					required
				/>
				<FormField
					label="Email Address"
					value={form.email}
					onChange={(v) => setField("email", v)}
					placeholder="you@example.com"
					type="email"
					required
				/>
			</div>

			{/* IMAP Settings */}
			<fieldset className="space-y-3">
				<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Incoming Mail (IMAP)
				</legend>
				<div className="grid grid-cols-3 gap-3">
					<FormField
						label="IMAP Host"
						value={form.imap_host}
						onChange={(v) => setField("imap_host", v)}
						placeholder="imap.example.com"
						required
					/>
					<FormField
						label="Port"
						value={String(form.imap_port)}
						onChange={(v) => setField("imap_port", Number(v) || 993)}
						type="number"
					/>
					<div className="flex items-end pb-0.5">
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
							<input
								type="checkbox"
								checked={form.imap_tls === 1}
								onChange={(e) => setField("imap_tls", e.target.checked ? 1 : 0)}
								className="rounded border-gray-300 dark:border-gray-600"
							/>
							Use TLS
						</label>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<FormField
						label="Username"
						value={form.imap_user}
						onChange={(v) => setField("imap_user", v)}
						placeholder="you@example.com"
						required
					/>
					<FormField
						label="Password"
						value={form.imap_pass}
						onChange={(v) => setField("imap_pass", v)}
						type="password"
						placeholder={accountId ? "(unchanged)" : ""}
						required={accountId === null}
					/>
				</div>
			</fieldset>

			{/* SMTP Settings */}
			<fieldset className="space-y-3">
				<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Outgoing Mail (SMTP)
				</legend>
				<div className="grid grid-cols-3 gap-3">
					<FormField
						label="SMTP Host"
						value={form.smtp_host}
						onChange={(v) => setField("smtp_host", v)}
						placeholder="smtp.example.com"
					/>
					<FormField
						label="Port"
						value={String(form.smtp_port)}
						onChange={(v) => setField("smtp_port", Number(v) || 587)}
						type="number"
					/>
					<div className="flex items-end pb-0.5">
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
							<input
								type="checkbox"
								checked={form.smtp_tls === 1}
								onChange={(e) => setField("smtp_tls", e.target.checked ? 1 : 0)}
								className="rounded border-gray-300 dark:border-gray-600"
							/>
							Use TLS
						</label>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<FormField
						label="Username"
						value={form.smtp_user}
						onChange={(v) => setField("smtp_user", v)}
						placeholder="you@example.com"
					/>
					<FormField
						label="Password"
						value={form.smtp_pass}
						onChange={(v) => setField("smtp_pass", v)}
						type="password"
						placeholder={accountId ? "(unchanged)" : ""}
					/>
				</div>
			</fieldset>

			{/* Sync preferences */}
			<fieldset className="space-y-2">
				<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Sync Preferences
				</legend>
				<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
					<input
						type="checkbox"
						checked={form.sync_delete_from_server === 1}
						onChange={(e) => setField("sync_delete_from_server", e.target.checked ? 1 : 0)}
						className="rounded border-gray-300 dark:border-gray-600"
					/>
					Sync deletions from server (remove locally when deleted on server)
				</label>
			</fieldset>

			{/* Actions */}
			<div className="flex items-center justify-end gap-2 pt-2">
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={loading}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{loading ? "Saving..." : accountId === null ? "Add Account" : "Save Changes"}
				</button>
			</div>
		</form>
	);
}

// --- General Tab ---

function GeneralTab() {
	const [notificationsEnabled, setNotificationsEnabled] = useState(
		() => localStorage.getItem("stork-notifications") !== "false",
	);
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
				<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
					<input
						type="checkbox"
						checked={notificationsEnabled}
						onChange={(e) => setNotificationsEnabled(e.target.checked)}
						className="rounded border-gray-300 dark:border-gray-600"
					/>
					Enable desktop notifications for new mail
				</label>
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
					<ShortcutRow keys="/" action="Search" />
					<ShortcutRow keys="?" action="Show shortcuts help" />
					<ShortcutRow keys="⌘+Enter" action="Send message" />
				</div>
			</div>
		</div>
	);
}

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

// --- Security Tab ---

function SecurityTab() {
	// Change password state
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [changePwLoading, setChangePwLoading] = useState(false);
	const [changePwError, setChangePwError] = useState<string | null>(null);
	const [changePwSuccess, setChangePwSuccess] = useState(false);

	// Rotate recovery key state
	const [rotatePassword, setRotatePassword] = useState("");
	const [rotateLoading, setRotateLoading] = useState(false);
	const [rotateError, setRotateError] = useState<string | null>(null);
	const [newMnemonic, setNewMnemonic] = useState<string | null>(null);
	const [rotateAcknowledged, setRotateAcknowledged] = useState(false);

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			setChangePwError("New passwords do not match.");
			return;
		}
		if (newPassword.length < 12) {
			setChangePwError("New password must be at least 12 characters.");
			return;
		}
		setChangePwLoading(true);
		setChangePwError(null);
		setChangePwSuccess(false);
		try {
			await api.encryption.changePassword(currentPassword, newPassword);
			setChangePwSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			setChangePwError((err as Error).message);
		} finally {
			setChangePwLoading(false);
		}
	};

	const handleRotateRecoveryKey = async (e: React.FormEvent) => {
		e.preventDefault();
		setRotateLoading(true);
		setRotateError(null);
		try {
			const { recoveryMnemonic } = await api.encryption.rotateRecoveryKey(rotatePassword);
			setNewMnemonic(recoveryMnemonic);
			setRotatePassword("");
		} catch (err) {
			setRotateError((err as Error).message);
		} finally {
			setRotateLoading(false);
		}
	};

	const handleRotateDone = () => {
		setNewMnemonic(null);
		setRotateAcknowledged(false);
	};

	return (
		<div className="space-y-8">
			<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Security</h3>

			{/* Change Password */}
			<form onSubmit={handleChangePassword} className="space-y-4">
				<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Change Password</h4>

				{changePwError && (
					<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
						{changePwError}
					</div>
				)}
				{changePwSuccess && (
					<div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-md">
						Password changed successfully.
					</div>
				)}

				<FormField
					label="Current Password"
					value={currentPassword}
					onChange={setCurrentPassword}
					type="password"
					placeholder="Your current encryption password"
					required
				/>
				<FormField
					label="New Password"
					value={newPassword}
					onChange={setNewPassword}
					type="password"
					placeholder="At least 12 characters"
					required
				/>
				<FormField
					label="Confirm New Password"
					value={confirmPassword}
					onChange={setConfirmPassword}
					type="password"
					placeholder="Repeat your new password"
					required
				/>

				<button
					type="submit"
					disabled={changePwLoading}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{changePwLoading ? "Changing…" : "Change Password"}
				</button>
			</form>

			<hr className="border-gray-200 dark:border-gray-700" />

			{/* Rotate Recovery Key */}
			{newMnemonic ? (
				<div className="space-y-4">
					<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
						New Recovery Phrase
					</h4>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Your old recovery phrase is no longer valid. Write down this new phrase and store it
						safely.
					</p>

					<div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
						<p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-3">
							Recovery Phrase
						</p>
						<div className="grid grid-cols-4 gap-2">
							{newMnemonic.split(/\s+/).map((word, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: order-dependent list
								<div key={i} className="flex items-center gap-1.5">
									<span className="text-xs text-amber-500 dark:text-amber-600 w-5 text-right flex-shrink-0">
										{i + 1}.
									</span>
									<span className="text-sm font-mono text-gray-800 dark:text-gray-200">{word}</span>
								</div>
							))}
						</div>
					</div>

					<label className="flex items-start gap-3 cursor-pointer">
						<input
							type="checkbox"
							checked={rotateAcknowledged}
							onChange={(e) => setRotateAcknowledged(e.target.checked)}
							className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
						/>
						<span className="text-sm text-gray-600 dark:text-gray-400">
							I've written down my new recovery phrase and stored it safely.
						</span>
					</label>

					<button
						type="button"
						disabled={!rotateAcknowledged}
						onClick={handleRotateDone}
						className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
					>
						Done
					</button>
				</div>
			) : (
				<form onSubmit={handleRotateRecoveryKey} className="space-y-4">
					<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
						Rotate Recovery Key
					</h4>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Generate a new 24-word recovery phrase. Your old phrase will stop working.
					</p>

					{rotateError && (
						<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
							{rotateError}
						</div>
					)}

					<FormField
						label="Current Password"
						value={rotatePassword}
						onChange={setRotatePassword}
						type="password"
						placeholder="Confirm your encryption password"
						required
					/>

					<button
						type="submit"
						disabled={rotateLoading}
						className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
					>
						{rotateLoading ? "Generating…" : "Rotate Recovery Key"}
					</button>
				</form>
			)}
		</div>
	);
}

// --- Helpers ---

function FormField({
	label,
	value,
	onChange,
	type = "text",
	placeholder,
	required = false,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	type?: string;
	placeholder?: string;
	required?: boolean;
}) {
	return (
		<label className="block">
			<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</span>
			<input
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				required={required}
				className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
			/>
		</label>
	);
}

function formatRelative(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return "Just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}
