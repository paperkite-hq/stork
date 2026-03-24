import { useCallback, useEffect, useState } from "react";
import { type AccountDetail, type UpdateAccountRequest, api } from "../../api";
import { WELL_KNOWN_PROVIDERS } from "../../utils";
import { FormField } from "./FormField";

export interface AccountFormData {
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
	default_view: string;
}

export const emptyForm: AccountFormData = {
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
	default_view: "inbox",
};

export function AccountForm({
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
				default_view: detail.default_view ?? "inbox",
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
				const update: UpdateAccountRequest = { ...form };
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
					Archive mode — automatically delete messages from the IMAP server after syncing them
					locally (treats your mail provider as a transient delivery edge)
				</label>
				<div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
					<label htmlFor="default_view_select" className="whitespace-nowrap">
						Default view on open
					</label>
					<select
						id="default_view_select"
						value={form.default_view}
						onChange={(e) => setField("default_view", e.target.value)}
						className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
					>
						<option value="inbox">Inbox</option>
						<option value="unread">Unread</option>
						<option value="all">All Mail</option>
					</select>
				</div>
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
