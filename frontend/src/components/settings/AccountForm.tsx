import { useCallback, useEffect, useState } from "react";
import {
	type AccountDetail,
	type InboundConnector,
	type OutboundConnector,
	type UpdateAccountRequest,
	api,
} from "../../api";
import { useAsync } from "../../hooks";
import { FormField } from "./FormField";

interface AccountFormData {
	name: string;
	email: string;
	inbound_connector_id: number | null;
	outbound_connector_id: number | null;
	sync_delete_from_server: number;
	default_view: string;
}

const emptyForm: AccountFormData = {
	name: "",
	email: "",
	inbound_connector_id: null,
	outbound_connector_id: null,
	sync_delete_from_server: 0,
	default_view: "inbox",
};

function connectorLabel(c: InboundConnector | OutboundConnector): string {
	if ("imap_host" in c && c.type === "imap") {
		return `${c.name} — IMAP (${c.imap_user ?? ""}@${c.imap_host ?? ""})`;
	}
	if (c.type === "cloudflare-email") {
		return `${c.name} — Cloudflare Email`;
	}
	if ("smtp_host" in c && c.type === "smtp") {
		return `${c.name} — SMTP (${(c as OutboundConnector).smtp_user ?? ""}@${(c as OutboundConnector).smtp_host ?? ""})`;
	}
	if (c.type === "ses") {
		return `${c.name} — AWS SES (${(c as OutboundConnector).ses_region ?? ""})`;
	}
	return c.name;
}

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

	const { data: inboundConnectors } = useAsync(() => api.connectors.inbound.list(), []);
	const { data: outboundConnectors } = useAsync(() => api.connectors.outbound.list(), []);

	const loadAccount = useCallback(async () => {
		if (accountId === null) return;
		try {
			const detail: AccountDetail = await api.accounts.get(accountId);
			setForm({
				name: detail.name,
				email: detail.email,
				inbound_connector_id: detail.inbound_connector_id ?? null,
				outbound_connector_id: detail.outbound_connector_id ?? null,
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

	// Auto-select first inbound connector when creating a new account
	useEffect(() => {
		if (accountId !== null) return;
		if (form.inbound_connector_id !== null) return;
		const first = inboundConnectors?.[0];
		if (first) {
			setForm((f) => ({ ...f, inbound_connector_id: first.id }));
		}
	}, [inboundConnectors, accountId, form.inbound_connector_id]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.inbound_connector_id) {
			setError("An inbound connector is required. Set one up in the Connectors tab first.");
			return;
		}
		setLoading(true);
		setError(null);

		try {
			if (accountId === null) {
				await api.accounts.create({
					name: form.name,
					email: form.email,
					inbound_connector_id: form.inbound_connector_id,
					...(form.outbound_connector_id
						? { outbound_connector_id: form.outbound_connector_id }
						: {}),
					sync_delete_from_server: form.sync_delete_from_server,
					default_view: form.default_view,
				});
			} else {
				const update: UpdateAccountRequest = {
					name: form.name,
					email: form.email,
					inbound_connector_id: form.inbound_connector_id,
					outbound_connector_id: form.outbound_connector_id ?? undefined,
					sync_delete_from_server: form.sync_delete_from_server,
					default_view: form.default_view,
				};
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

	const hasInbound = inboundConnectors && inboundConnectors.length > 0;
	const hasOutbound = outboundConnectors && outboundConnectors.length > 0;

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

			{/* Identity */}
			<div className="grid grid-cols-2 gap-3">
				<FormField
					label="Display Name"
					value={form.name}
					onChange={(v) => setForm((f) => ({ ...f, name: v }))}
					placeholder="Work Email"
					required
				/>
				<FormField
					label="Email Address"
					value={form.email}
					onChange={(v) => setForm((f) => ({ ...f, email: v }))}
					placeholder="you@example.com"
					type="email"
					required
				/>
			</div>

			{/* Inbound Connector */}
			<div>
				<label
					htmlFor="inbound-connector"
					className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5"
				>
					Inbound Connector <span className="text-red-500">*</span>
				</label>
				{!hasInbound ? (
					<p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded">
						No inbound connectors configured yet. Go to the <strong>Connectors</strong> tab to add
						one (IMAP or Cloudflare Email).
					</p>
				) : (
					<select
						id="inbound-connector"
						value={form.inbound_connector_id ?? ""}
						onChange={(e) =>
							setForm((f) => ({
								...f,
								inbound_connector_id: e.target.value ? Number(e.target.value) : null,
							}))
						}
						required
						className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
					>
						<option value="">Select inbound connector…</option>
						{inboundConnectors?.map((c) => (
							<option key={c.id} value={c.id}>
								{connectorLabel(c)}
							</option>
						))}
					</select>
				)}
			</div>

			{/* Outbound Connector */}
			<div>
				<label
					htmlFor="outbound-connector"
					className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5"
				>
					Outbound Connector <span className="text-gray-400">(optional)</span>
				</label>
				{!hasOutbound ? (
					<p className="text-sm text-gray-500 dark:text-gray-400 italic">
						No outbound connectors configured. Add one in the <strong>Connectors</strong> tab to
						enable sending (SMTP or AWS SES).
					</p>
				) : (
					<select
						id="outbound-connector"
						value={form.outbound_connector_id ?? ""}
						onChange={(e) =>
							setForm((f) => ({
								...f,
								outbound_connector_id: e.target.value ? Number(e.target.value) : null,
							}))
						}
						className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100"
					>
						<option value="">None (receive only)</option>
						{outboundConnectors?.map((c) => (
							<option key={c.id} value={c.id}>
								{connectorLabel(c)}
							</option>
						))}
					</select>
				)}
			</div>

			{/* Sync Preferences */}
			<fieldset className="space-y-3">
				<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Sync Preferences
				</legend>
				<label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
					<input
						type="checkbox"
						checked={form.sync_delete_from_server === 1}
						onChange={(e) =>
							setForm((f) => ({ ...f, sync_delete_from_server: e.target.checked ? 1 : 0 }))
						}
						className="rounded border-gray-300 dark:border-gray-600 mt-0.5 shrink-0"
					/>
					<span>
						<span className="font-medium">Connector mode</span> — after syncing, remove messages
						from the inbound source so Stork becomes your permanent encrypted email home
					</span>
				</label>
				{form.sync_delete_from_server === 1 ? (
					<div className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded px-3 py-2">
						<p className="font-medium">
							Connector mode is on — Stork is your permanent encrypted email home.
						</p>
						<p>
							Messages are removed from the inbound source after each sync. Make sure your Stork
							database is backed up.
						</p>
					</div>
				) : (
					<div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
						<p className="font-medium">Mirror mode is on — Stork reads alongside your provider.</p>
						<p>
							Your provider stays authoritative; both hold copies. Actions in Stork are local only.
						</p>
					</div>
				)}
				<div className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
					<label htmlFor="default_view_select" className="whitespace-nowrap">
						Default view on open
					</label>
					<select
						id="default_view_select"
						value={form.default_view}
						onChange={(e) => setForm((f) => ({ ...f, default_view: e.target.value }))}
						className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
					>
						<option value="inbox">Inbox</option>
						<option value="unread">Unread</option>
						<option value="all">All Mail</option>
					</select>
				</div>
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
					disabled={loading || !hasInbound}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{loading ? "Saving..." : accountId === null ? "Add Account" : "Save Changes"}
				</button>
			</div>
		</form>
	);
}
