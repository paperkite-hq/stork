import { useCallback, useEffect, useState } from "react";
import { type AccountDetail, type SyncStatus, type TrustedSender, api } from "../../api";
import { useAsync } from "../../hooks";
import { WELL_KNOWN_PROVIDERS } from "../../utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { toast } from "../Toast";
import { FormField, formatRelative } from "./FormField";

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

export function AccountsTab({
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
						api.accounts
							.delete(deleteTarget.id)
							.then(() => {
								toast("Account deleted", "success");
								onRefetch();
							})
							.catch(() => {
								toast("Failed to delete account", "error");
							});
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
	const [showTrustedSenders, setShowTrustedSenders] = useState(false);

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
						onClick={() => setShowTrustedSenders((v) => !v)}
						className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
						title="Manage senders whose remote images are always loaded"
					>
						Trusted Senders
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
			{showTrustedSenders && (
				<TrustedSendersPanel accountId={account.id} onClose={() => setShowTrustedSenders(false)} />
			)}
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

function TrustedSendersPanel({
	accountId,
	onClose,
}: {
	accountId: number;
	onClose: () => void;
}) {
	const [senders, setSenders] = useState<TrustedSender[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleteConfirm, setDeleteConfirm] = useState<TrustedSender | null>(null);

	useEffect(() => {
		setLoading(true);
		api.trustedSenders
			.list(accountId)
			.then(setSenders)
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [accountId]);

	const handleRemove = (sender: TrustedSender) => {
		api.trustedSenders
			.remove(accountId, sender.sender_address)
			.then(() => {
				setSenders((prev) => prev.filter((s) => s.id !== sender.id));
				toast(`Removed ${sender.sender_address} from trusted senders`, "success");
			})
			.catch(() => {
				toast("Failed to remove trusted sender", "error");
			});
		setDeleteConfirm(null);
	};

	return (
		<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
			<div className="flex items-center justify-between mb-2">
				<h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Trusted Senders
				</h4>
				<button
					type="button"
					onClick={onClose}
					className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					aria-label="Close trusted senders"
				>
					Close
				</button>
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
				Remote images from these senders are always loaded. Tracking pixels are still blocked.
			</p>
			{loading ? (
				<p className="text-xs text-gray-400 py-2">Loading…</p>
			) : senders.length === 0 ? (
				<p className="text-xs text-gray-400 py-2 text-center">
					No trusted senders yet. Use "Always show from this sender" when viewing a message.
				</p>
			) : (
				<ul className="space-y-1">
					{senders.map((sender) => (
						<li
							key={sender.id}
							className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<span className="text-xs text-gray-700 dark:text-gray-300">
								{sender.sender_address}
							</span>
							<button
								type="button"
								onClick={() => setDeleteConfirm(sender)}
								className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
								aria-label={`Remove ${sender.sender_address} from trusted senders`}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
			{deleteConfirm && (
				<ConfirmDialog
					title="Remove trusted sender"
					message={`Remote images from "${deleteConfirm.sender_address}" will be hidden again. You can re-trust them from the message view.`}
					confirmLabel="Remove"
					variant="danger"
					onConfirm={() => handleRemove(deleteConfirm)}
					onCancel={() => setDeleteConfirm(null)}
				/>
			)}
		</div>
	);
}

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
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		ok: boolean;
		error?: string;
		mailboxes?: number;
	} | null>(null);
	const [testingSmtp, setTestingSmtp] = useState(false);
	const [smtpTestResult, setSmtpTestResult] = useState<{
		ok: boolean;
		error?: string;
	} | null>(null);

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

	const handleEmailChange = (email: string) => {
		if (accountId !== null) {
			setField("email", email);
			return;
		}
		const domain = email.split("@")[1]?.toLowerCase();
		if (domain && WELL_KNOWN_PROVIDERS[domain]) {
			const provider = WELL_KNOWN_PROVIDERS[domain];
			setForm((f) => ({
				...f,
				email,
				imap_host: f.imap_host || provider.imap_host,
				smtp_host: f.smtp_host || provider.smtp_host,
				imap_user: !f.imap_user || f.imap_user === f.email ? email : f.imap_user,
				smtp_user: !f.smtp_user || f.smtp_user === f.email ? email : f.smtp_user,
			}));
		} else {
			setForm((f) => ({
				...f,
				email,
				imap_user: !f.imap_user || f.imap_user === f.email ? email : f.imap_user,
				smtp_user: !f.smtp_user || f.smtp_user === f.email ? email : f.smtp_user,
			}));
		}
	};

	const handleTestConnection = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			const result = await api.accounts.testConnection({
				imap_host: form.imap_host,
				imap_port: form.imap_port,
				imap_tls: form.imap_tls,
				imap_user: form.imap_user,
				imap_pass: form.imap_pass,
			});
			setTestResult(result);
		} catch (err) {
			setTestResult({ ok: false, error: (err as Error).message });
		} finally {
			setTesting(false);
		}
	};

	const handleTestSmtp = async () => {
		setTestingSmtp(true);
		setSmtpTestResult(null);
		try {
			const result = await api.testSmtp({
				smtp_host: form.smtp_host,
				smtp_port: form.smtp_port,
				smtp_tls: form.smtp_tls,
				smtp_user: form.smtp_user || form.imap_user,
				smtp_pass: form.smtp_pass || form.imap_pass,
			});
			setSmtpTestResult(result);
		} catch (err) {
			setSmtpTestResult({ ok: false, error: (err as Error).message });
		} finally {
			setTestingSmtp(false);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			if (accountId === null) {
				await api.accounts.create({ ...form });
			} else {
				// Only send non-empty password fields on update
				const update: import("../../api.js").UpdateAccountRequest = { ...form };
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
					onChange={handleEmailChange}
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

			{/* Test connection results */}
			{testResult && (
				<div
					className={`text-sm px-3 py-2 rounded ${
						testResult.ok
							? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
							: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
					}`}
				>
					{testResult.ok
						? `IMAP connection successful — ${testResult.mailboxes} mailboxes found`
						: `IMAP connection failed: ${testResult.error}`}
				</div>
			)}
			{smtpTestResult && (
				<div
					className={`text-sm px-3 py-2 rounded ${
						smtpTestResult.ok
							? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
							: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
					}`}
				>
					{smtpTestResult.ok
						? "SMTP connection successful — ready to send"
						: `SMTP connection failed: ${smtpTestResult.error}`}
				</div>
			)}

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
					type="button"
					onClick={handleTestConnection}
					disabled={testing || !form.imap_host || !form.imap_user || !form.imap_pass}
					className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
				>
					{testing ? "Testing..." : "Test IMAP"}
				</button>
				{form.smtp_host && (
					<button
						type="button"
						onClick={handleTestSmtp}
						disabled={testingSmtp || !form.smtp_host}
						className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
					>
						{testingSmtp ? "Testing..." : "Test SMTP"}
					</button>
				)}
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
