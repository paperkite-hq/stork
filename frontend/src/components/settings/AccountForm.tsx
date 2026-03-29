import { useCallback, useEffect, useState } from "react";
import {
	type IdentityDetail,
	type OutboundConnector,
	type UpdateIdentityRequest,
	api,
} from "../../api";
import { useAsync } from "../../hooks";
import { FormField } from "./FormField";

interface IdentityFormData {
	name: string;
	email: string;
	outbound_connector_id: number | null;
	default_view: string;
}

const emptyForm: IdentityFormData = {
	name: "",
	email: "",
	outbound_connector_id: null,
	default_view: "inbox",
};

function outboundConnectorLabel(c: OutboundConnector): string {
	if (c.type === "smtp") {
		return `${c.name} — SMTP (${c.smtp_user ?? ""}@${c.smtp_host ?? ""})`;
	}
	if (c.type === "ses") {
		return `${c.name} — AWS SES (${c.ses_region ?? ""})`;
	}
	return c.name;
}

export function AccountForm({
	identityId,
	onCancel,
	onSaved,
}: {
	identityId: number | null;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const [form, setForm] = useState<IdentityFormData>(emptyForm);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(identityId === null);

	const { data: outboundConnectors } = useAsync(() => api.connectors.outbound.list(), []);

	const loadIdentity = useCallback(async () => {
		if (identityId === null) return;
		try {
			const detail: IdentityDetail = await api.identities.get(identityId);
			setForm({
				name: detail.name,
				email: detail.email,
				outbound_connector_id: detail.outbound_connector_id ?? null,
				default_view: detail.default_view ?? "inbox",
			});
			setLoaded(true);
		} catch (e) {
			setError((e as Error).message);
		}
	}, [identityId]);

	useEffect(() => {
		loadIdentity();
	}, [loadIdentity]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			if (identityId === null) {
				await api.identities.create({
					name: form.name,
					email: form.email,
					...(form.outbound_connector_id
						? { outbound_connector_id: form.outbound_connector_id }
						: {}),
					default_view: form.default_view,
				});
			} else {
				const update: UpdateIdentityRequest = {
					name: form.name,
					email: form.email,
					outbound_connector_id: form.outbound_connector_id ?? undefined,
					default_view: form.default_view,
				};
				await api.identities.update(identityId, update);
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

	const hasOutbound = outboundConnectors && outboundConnectors.length > 0;

	return (
		<form
			onSubmit={handleSubmit}
			className="border border-stork-200 dark:border-stork-800 rounded-lg p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50"
		>
			<h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
				{identityId === null ? "Add Email Identity" : "Edit Email Identity"}
			</h4>

			{error && (
				<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
					{error}
				</div>
			)}

			{/* Philosophy intro — shown only when adding a new identity */}
			{identityId === null && (
				<div className="rounded-lg border-2 border-stork-300 dark:border-stork-700 bg-stork-50 dark:bg-stork-950 px-4 py-3 space-y-2">
					<p className="text-sm font-bold text-stork-800 dark:text-stork-200">
						⚡ Two minutes to understand how Stork thinks about email
					</p>
					<p className="text-xs text-stork-700 dark:text-stork-300">
						Most email clients treat your mail provider (Gmail, Fastmail, etc.) as the permanent
						home for your email. Stork{"'"}s philosophy is different:{" "}
						<strong>your provider is just the delivery edge</strong>. Mail arrives there, Stork
						picks it up and stores it encrypted on your own hardware, and — when you{"'"}re ready —
						clears it from the provider.
					</p>
					<p className="text-xs text-stork-700 dark:text-stork-300">
						<strong>Mirror mode (default):</strong> Stork reads alongside your provider. Both have
						copies. Perfect for trying Stork — your provider stays your safety net. Heads up:
						actions you take in Stork (delete, label, archive) stay local and don{"'"}t sync back.
					</p>
					<p className="text-xs text-stork-700 dark:text-stork-300">
						<strong>Connector mode:</strong> Once you{"'"}re confident, flip the switch. Stork
						becomes your permanent encrypted email home. Your provider is just a pipe — mail
						arrives, Stork grabs it and erases it from the server. Back up your Stork database.
					</p>
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
								{outboundConnectorLabel(c)}
							</option>
						))}
					</select>
				)}
			</div>

			{/* View Preferences */}
			<fieldset className="space-y-3">
				<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Preferences
				</legend>
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
					disabled={loading}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{loading ? "Saving..." : identityId === null ? "Add Email Identity" : "Save Changes"}
				</button>
			</div>
		</form>
	);
}
