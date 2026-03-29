import { Fragment, useEffect, useState } from "react";
import {
	type CreateInboundConnectorRequest,
	type CreateOutboundConnectorRequest,
	type Identity,
	type InboundConnector,
	type OutboundConnector,
	api,
} from "../../api";
import { useAsync } from "../../hooks";
import { AccountSetupWizard } from "./AccountSetupWizard";
import { SyncStatusPanel } from "./SyncStatusPanel";

// ── Inbound Connector Form ─────────────────────────────────────────────────

interface InboundFormData {
	name: string;
	type: "imap" | "cloudflare-email";
	imap_host: string;
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	imap_pass: string;
	cf_email_webhook_secret: string;
	sync_delete_from_server: number;
}

function defaultInboundForm(): InboundFormData {
	return {
		name: "",
		type: "imap",
		imap_host: "",
		imap_port: 993,
		imap_tls: 1,
		imap_user: "",
		imap_pass: "",
		cf_email_webhook_secret: "",
		sync_delete_from_server: 0,
	};
}

function InboundConnectorForm({
	initial,
	onSave,
	onCancel,
}: {
	initial?: InboundConnector;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [form, setForm] = useState<InboundFormData>(
		initial
			? {
					name: initial.name,
					type: initial.type,
					imap_host: initial.imap_host ?? "",
					imap_port: initial.imap_port,
					imap_tls: initial.imap_tls,
					imap_user: initial.imap_user ?? "",
					imap_pass: "",
					cf_email_webhook_secret: initial.cf_email_webhook_secret ?? "",
					sync_delete_from_server: initial.sync_delete_from_server ?? 0,
				}
			: defaultInboundForm(),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const payload: CreateInboundConnectorRequest = {
				name: form.name,
				type: form.type,
				sync_delete_from_server: form.sync_delete_from_server,
				...(form.type === "imap"
					? {
							imap_host: form.imap_host,
							imap_port: form.imap_port,
							imap_tls: form.imap_tls,
							imap_user: form.imap_user,
							...(form.imap_pass ? { imap_pass: form.imap_pass } : {}),
						}
					: {
							cf_email_webhook_secret: form.cf_email_webhook_secret,
						}),
			};
			if (initial) {
				await api.connectors.inbound.update(initial.id, payload);
			} else {
				await api.connectors.inbound.create(payload);
			}
			onSave();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<div>
				<label
					htmlFor="ib-name"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Name
				</label>
				<input
					id="ib-name"
					type="text"
					required
					value={form.name}
					onChange={(e) => setForm({ ...form, name: e.target.value })}
					className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
				/>
			</div>

			<div>
				<label
					htmlFor="ib-type"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Type
				</label>
				<select
					id="ib-type"
					value={form.type}
					onChange={(e) =>
						setForm({ ...form, type: e.target.value as "imap" | "cloudflare-email" })
					}
					className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
				>
					<option value="imap">IMAP</option>
					<option value="cloudflare-email">Cloudflare Email</option>
				</select>
			</div>

			{form.type === "imap" && (
				<>
					<div>
						<label
							htmlFor="ib-imap-host"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							IMAP Host
						</label>
						<input
							id="ib-imap-host"
							type="text"
							required
							value={form.imap_host}
							onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label
								htmlFor="ib-imap-port"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
							>
								Port
							</label>
							<input
								id="ib-imap-port"
								type="number"
								value={form.imap_port}
								onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })}
								className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
							/>
						</div>
						<div>
							<label
								htmlFor="ib-imap-tls"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
							>
								TLS
							</label>
							<select
								id="ib-imap-tls"
								value={form.imap_tls}
								onChange={(e) => setForm({ ...form, imap_tls: Number(e.target.value) })}
								className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
							>
								<option value={1}>Enabled</option>
								<option value={0}>Disabled</option>
							</select>
						</div>
					</div>
					<div>
						<label
							htmlFor="ib-imap-user"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Username
						</label>
						<input
							id="ib-imap-user"
							type="text"
							required
							value={form.imap_user}
							onChange={(e) => setForm({ ...form, imap_user: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div>
						<label
							htmlFor="ib-imap-pass"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Password{initial ? " (leave blank to keep existing)" : ""}
						</label>
						<input
							id="ib-imap-pass"
							type="password"
							required={!initial}
							value={form.imap_pass}
							onChange={(e) => setForm({ ...form, imap_pass: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					{/* Mirror vs Connector mode — only applies to IMAP connectors */}
					<div className="space-y-2 pt-1">
						<label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
							<input
								type="checkbox"
								checked={form.sync_delete_from_server === 1}
								onChange={(e) =>
									setForm({ ...form, sync_delete_from_server: e.target.checked ? 1 : 0 })
								}
								className="rounded border-gray-300 dark:border-gray-600 mt-0.5 shrink-0"
							/>
							<span>
								<span className="font-medium">Connector mode</span> — after syncing, remove messages
								from the IMAP server so Stork becomes your permanent encrypted email home
							</span>
						</label>
						{form.sync_delete_from_server === 1 ? (
							<div className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded px-3 py-2">
								<p className="font-medium">
									Connector mode — Stork is your permanent encrypted email home.
								</p>
								<p>
									Messages are removed from the IMAP server after each sync. Back up your Stork
									database.
								</p>
							</div>
						) : (
							<div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
								<p className="font-medium">
									Mirror mode — Stork reads alongside your IMAP provider.
								</p>
								<p>
									Your provider stays authoritative; both hold copies. Actions in Stork are local
									only.
								</p>
							</div>
						)}
					</div>
				</>
			)}

			{form.type === "cloudflare-email" && (
				<div>
					<label
						htmlFor="ib-cf-secret"
						className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
					>
						Webhook Secret
					</label>
					<input
						id="ib-cf-secret"
						type="password"
						required={!initial}
						value={form.cf_email_webhook_secret}
						onChange={(e) => setForm({ ...form, cf_email_webhook_secret: e.target.value })}
						className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
					/>
				</div>
			)}

			{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

			<div className="flex gap-2 pt-1">
				<button
					type="submit"
					disabled={saving}
					className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}

// ── Outbound Connector Form ────────────────────────────────────────────────

interface OutboundFormData {
	name: string;
	type: "smtp" | "ses";
	smtp_host: string;
	smtp_port: number;
	smtp_tls: number;
	smtp_user: string;
	smtp_pass: string;
	ses_region: string;
	ses_access_key_id: string;
	ses_secret_access_key: string;
}

function defaultOutboundForm(): OutboundFormData {
	return {
		name: "",
		type: "smtp",
		smtp_host: "",
		smtp_port: 587,
		smtp_tls: 1,
		smtp_user: "",
		smtp_pass: "",
		ses_region: "",
		ses_access_key_id: "",
		ses_secret_access_key: "",
	};
}

function OutboundConnectorForm({
	initial,
	onSave,
	onCancel,
}: {
	initial?: OutboundConnector;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [form, setForm] = useState<OutboundFormData>(
		initial
			? {
					name: initial.name,
					type: initial.type,
					smtp_host: initial.smtp_host ?? "",
					smtp_port: initial.smtp_port,
					smtp_tls: initial.smtp_tls,
					smtp_user: initial.smtp_user ?? "",
					smtp_pass: "",
					ses_region: initial.ses_region ?? "",
					ses_access_key_id: initial.ses_access_key_id ?? "",
					ses_secret_access_key: "",
				}
			: defaultOutboundForm(),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const payload: CreateOutboundConnectorRequest = {
				name: form.name,
				type: form.type,
				...(form.type === "smtp"
					? {
							smtp_host: form.smtp_host,
							smtp_port: form.smtp_port,
							smtp_tls: form.smtp_tls,
							smtp_user: form.smtp_user,
							...(form.smtp_pass ? { smtp_pass: form.smtp_pass } : {}),
						}
					: {
							ses_region: form.ses_region,
							ses_access_key_id: form.ses_access_key_id,
							...(form.ses_secret_access_key
								? { ses_secret_access_key: form.ses_secret_access_key }
								: {}),
						}),
			};
			if (initial) {
				await api.connectors.outbound.update(initial.id, payload);
			} else {
				await api.connectors.outbound.create(payload);
			}
			onSave();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<div>
				<label
					htmlFor="ob-name"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Name
				</label>
				<input
					id="ob-name"
					type="text"
					required
					value={form.name}
					onChange={(e) => setForm({ ...form, name: e.target.value })}
					className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
				/>
			</div>

			<div>
				<label
					htmlFor="ob-type"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Type
				</label>
				<select
					id="ob-type"
					value={form.type}
					onChange={(e) => setForm({ ...form, type: e.target.value as "smtp" | "ses" })}
					className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
				>
					<option value="smtp">SMTP</option>
					<option value="ses">AWS SES</option>
				</select>
			</div>

			{form.type === "smtp" && (
				<>
					<div>
						<label
							htmlFor="ob-smtp-host"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							SMTP Host
						</label>
						<input
							id="ob-smtp-host"
							type="text"
							required
							value={form.smtp_host}
							onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label
								htmlFor="ob-smtp-port"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
							>
								Port
							</label>
							<input
								id="ob-smtp-port"
								type="number"
								value={form.smtp_port}
								onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })}
								className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
							/>
						</div>
						<div>
							<label
								htmlFor="ob-smtp-tls"
								className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
							>
								TLS
							</label>
							<select
								id="ob-smtp-tls"
								value={form.smtp_tls}
								onChange={(e) => setForm({ ...form, smtp_tls: Number(e.target.value) })}
								className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
							>
								<option value={1}>Enabled</option>
								<option value={0}>Disabled</option>
							</select>
						</div>
					</div>
					<div>
						<label
							htmlFor="ob-smtp-user"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Username
						</label>
						<input
							id="ob-smtp-user"
							type="text"
							required
							value={form.smtp_user}
							onChange={(e) => setForm({ ...form, smtp_user: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div>
						<label
							htmlFor="ob-smtp-pass"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Password{initial ? " (leave blank to keep existing)" : ""}
						</label>
						<input
							id="ob-smtp-pass"
							type="password"
							required={!initial}
							value={form.smtp_pass}
							onChange={(e) => setForm({ ...form, smtp_pass: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
				</>
			)}

			{form.type === "ses" && (
				<>
					<div>
						<label
							htmlFor="ob-ses-region"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							AWS Region
						</label>
						<input
							id="ob-ses-region"
							type="text"
							required
							placeholder="us-east-1"
							value={form.ses_region}
							onChange={(e) => setForm({ ...form, ses_region: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div>
						<label
							htmlFor="ob-ses-aki"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Access Key ID (optional — uses instance role if omitted)
						</label>
						<input
							id="ob-ses-aki"
							type="text"
							value={form.ses_access_key_id}
							onChange={(e) => setForm({ ...form, ses_access_key_id: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
					<div>
						<label
							htmlFor="ob-ses-sak"
							className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
						>
							Secret Access Key{initial ? " (leave blank to keep existing)" : ""}
						</label>
						<input
							id="ob-ses-sak"
							type="password"
							value={form.ses_secret_access_key}
							onChange={(e) => setForm({ ...form, ses_secret_access_key: e.target.value })}
							className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
						/>
					</div>
				</>
			)}

			{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

			<div className="flex gap-2 pt-1">
				<button
					type="submit"
					disabled={saving}
					className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}

// ── Identity Form ──────────────────────────────────────────────────────────

function IdentityForm({
	outboundConnectorId,
	identityId,
	onSave,
	onCancel,
}: {
	outboundConnectorId: number;
	identityId: number | null;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(identityId === null);

	// Load existing identity data when editing
	useEffect(() => {
		if (identityId === null) return;
		api.identities
			.get(identityId)
			.then((detail) => {
				setName(detail.name);
				setEmail(detail.email);
				setLoaded(true);
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : String(err));
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [identityId]);

	if (!loaded) {
		return <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Loading...</div>;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			if (identityId === null) {
				await api.identities.create({
					name,
					email,
					outbound_connector_id: outboundConnectorId,
					default_view: "inbox",
				});
			} else {
				await api.identities.update(identityId, {
					name,
					email,
					outbound_connector_id: outboundConnectorId,
				});
			}
			onSave();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form
			onSubmit={handleSubmit}
			className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 mt-2"
		>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<label
						htmlFor="id-name"
						className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
					>
						Name
					</label>
					<input
						id="id-name"
						type="text"
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
					/>
				</div>
				<div>
					<label
						htmlFor="id-email"
						className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
					>
						Email
					</label>
					<input
						id="id-email"
						type="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100"
					/>
				</div>
			</div>
			{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
			<div className="flex gap-2">
				<button
					type="submit"
					disabled={saving}
					className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}

// ── Connector List Item ────────────────────────────────────────────────────

function ConnectorBadge({ type }: { type: string }) {
	const colors: Record<string, string> = {
		imap: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
		"cloudflare-email": "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
		smtp: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
		ses: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
	};
	const label: Record<string, string> = {
		imap: "IMAP",
		"cloudflare-email": "Cloudflare",
		smtp: "SMTP",
		ses: "SES",
	};
	return (
		<span
			className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors[type] ?? "bg-gray-100 text-gray-600"}`}
		>
			{label[type] ?? type}
		</span>
	);
}

// ── Main ConnectorsTab ─────────────────────────────────────────────────────

export function ConnectorsTab() {
	const {
		data: inbound,
		refetch: refetchInbound,
		loading: loadingInbound,
	} = useAsync(() => api.connectors.inbound.list(), []);
	const {
		data: outbound,
		refetch: refetchOutbound,
		loading: loadingOutbound,
	} = useAsync(() => api.connectors.outbound.list(), []);
	const { data: identities, refetch: refetchIdentities } = useAsync(
		() => api.identities.list(),
		[],
	);

	const [showWizard, setShowWizard] = useState(false);
	const [editingInbound, setEditingInbound] = useState<number | "new" | null>(null);
	const [editingOutbound, setEditingOutbound] = useState<number | "new" | null>(null);
	const [testResult, setTestResult] = useState<{
		id: number;
		dir: "in" | "out";
		ok: boolean;
		msg: string;
	} | null>(null);
	const [deleting, setDeleting] = useState<{ id: number; dir: "in" | "out" } | null>(null);

	// Inbound connector sync status display
	const [syncStatusConnectorId, setSyncStatusConnectorId] = useState<number | null>(null);

	// Identity editing state — keyed on outbound connector ID
	const [editingIdentityFor, setEditingIdentityFor] = useState<number | null>(null);
	const [editingIdentityId, setEditingIdentityId] = useState<number | "new" | null>(null);
	const [deletingIdentity, setDeletingIdentity] = useState<Identity | null>(null);

	async function handleTestInbound(id: number) {
		setTestResult(null);
		try {
			const r = await api.connectors.inbound.test(id);
			setTestResult({
				id,
				dir: "in",
				ok: r.ok,
				msg: r.ok
					? `OK${r.details?.folders != null ? ` — ${r.details.folders} folders` : ""}`
					: (r.error ?? "Test failed"),
			});
		} catch (err) {
			setTestResult({ id, dir: "in", ok: false, msg: String(err) });
		}
	}

	async function handleTestOutbound(id: number) {
		setTestResult(null);
		try {
			const r = await api.connectors.outbound.test(id);
			setTestResult({ id, dir: "out", ok: r.ok, msg: r.ok ? "OK" : (r.error ?? "Test failed") });
		} catch (err) {
			setTestResult({ id, dir: "out", ok: false, msg: String(err) });
		}
	}

	async function handleDeleteInbound(id: number) {
		try {
			await api.connectors.inbound.delete(id);
			setDeleting(null);
			refetchInbound();
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleDeleteOutbound(id: number) {
		try {
			await api.connectors.outbound.delete(id);
			setDeleting(null);
			refetchOutbound();
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleDeleteIdentity(id: number) {
		try {
			await api.identities.delete(id);
			setDeletingIdentity(null);
			refetchIdentities();
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err));
		}
	}

	const inboundEditing =
		editingInbound === "new" ? undefined : inbound?.find((c) => c.id === editingInbound);
	const outboundEditing =
		editingOutbound === "new" ? undefined : outbound?.find((c) => c.id === editingOutbound);

	return (
		<div className="space-y-8 p-4 sm:p-6">
			{/* Add Email wizard */}
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-semibold text-gray-900 dark:text-gray-100">Email Identities</h3>
					<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
						Set up a new email identity with inbound and outbound connectors in one flow
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowWizard(true)}
					className="px-3 py-1.5 text-sm bg-stork-600 hover:bg-stork-700 text-white rounded transition-colors"
				>
					+ Add Email Identity
				</button>
			</div>

			{showWizard && (
				<AccountSetupWizard
					existingInbound={inbound ?? []}
					existingOutbound={outbound ?? []}
					onDone={() => {
						setShowWizard(false);
						refetchInbound();
						refetchOutbound();
						refetchIdentities();
					}}
					onCancel={() => setShowWizard(false)}
				/>
			)}

			{/* Inbound Connectors */}
			<section>
				<div className="flex items-center justify-between mb-3">
					<div>
						<h3 className="font-semibold text-gray-900 dark:text-gray-100">Inbound Connectors</h3>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Receive email via IMAP polling or Cloudflare Email webhook
						</p>
					</div>
					{editingInbound === null && (
						<button
							type="button"
							onClick={() => setEditingInbound("new")}
							className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
						>
							Add Inbound
						</button>
					)}
				</div>

				{editingInbound !== null && (
					<div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
						<h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">
							{editingInbound === "new" ? "New Inbound Connector" : "Edit Inbound Connector"}
						</h4>
						<InboundConnectorForm
							initial={inboundEditing}
							onSave={() => {
								setEditingInbound(null);
								refetchInbound();
							}}
							onCancel={() => setEditingInbound(null)}
						/>
					</div>
				)}

				{loadingInbound && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

				{!loadingInbound && inbound?.length === 0 && (
					<p className="text-sm text-gray-500 dark:text-gray-400 italic">
						No inbound connectors configured yet.
					</p>
				)}

				<ul className="space-y-2">
					{inbound?.map((c) => (
						<Fragment key={c.id}>
							<li className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
											{c.name}
										</span>
										<ConnectorBadge type={c.type} />
									</div>
									<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
										{c.type === "imap"
											? `${c.imap_user ?? ""}@${c.imap_host ?? ""}:${c.imap_port}`
											: "Push-based webhook"}
									</p>
									{testResult?.id === c.id && testResult.dir === "in" && (
										<p
											className={`text-xs mt-0.5 ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
										>
											{testResult.msg}
										</p>
									)}
								</div>
								<div className="flex items-center gap-1.5 shrink-0">
									{deleting?.id === c.id && deleting.dir === "in" ? (
										<>
											<span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
											<button
												type="button"
												onClick={() => handleDeleteInbound(c.id)}
												className="text-xs text-red-600 dark:text-red-400 hover:underline"
											>
												Yes
											</button>
											<button
												type="button"
												onClick={() => setDeleting(null)}
												className="text-xs text-gray-500 hover:underline"
											>
												No
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												onClick={() =>
													setSyncStatusConnectorId(syncStatusConnectorId === c.id ? null : c.id)
												}
												className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-600"
											>
												Sync Status
											</button>
											<button
												type="button"
												onClick={() => handleTestInbound(c.id)}
												className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-600"
											>
												Test
											</button>
											<button
												type="button"
												onClick={() => {
													setEditingInbound(c.id);
													setTestResult(null);
												}}
												className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
											>
												Edit
											</button>
											<button
												type="button"
												onClick={() => setDeleting({ id: c.id, dir: "in" })}
												className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400"
											>
												Delete
											</button>
										</>
									)}
								</div>
							</li>
							{syncStatusConnectorId === c.id && (
								<li className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
									<SyncStatusPanel connectorId={c.id} />
								</li>
							)}
						</Fragment>
					))}
				</ul>
			</section>

			{/* Outbound Connectors */}
			<section>
				<div className="flex items-center justify-between mb-3">
					<div>
						<h3 className="font-semibold text-gray-900 dark:text-gray-100">Outbound Connectors</h3>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Send email via SMTP or AWS SES
						</p>
					</div>
					{editingOutbound === null && (
						<button
							type="button"
							onClick={() => setEditingOutbound("new")}
							className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
						>
							Add Outbound
						</button>
					)}
				</div>

				{editingOutbound !== null && (
					<div className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
						<h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-3">
							{editingOutbound === "new" ? "New Outbound Connector" : "Edit Outbound Connector"}
						</h4>
						<OutboundConnectorForm
							initial={outboundEditing}
							onSave={() => {
								setEditingOutbound(null);
								refetchOutbound();
							}}
							onCancel={() => setEditingOutbound(null)}
						/>
					</div>
				)}

				{loadingOutbound && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

				{!loadingOutbound && outbound?.length === 0 && (
					<p className="text-sm text-gray-500 dark:text-gray-400 italic">
						No outbound connectors configured yet.
					</p>
				)}

				<ul className="space-y-3">
					{outbound?.map((c) => {
						const connectorIdentities = (identities ?? []).filter(
							(a) => a.outbound_connector_id === c.id,
						);
						const isEditingIdentityHere = editingIdentityFor === c.id && editingIdentityId !== null;

						return (
							<li
								key={c.id}
								className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
							>
								{/* Connector row */}
								<div className="flex items-center justify-between gap-3 p-3">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
												{c.name}
											</span>
											<ConnectorBadge type={c.type} />
										</div>
										<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
											{c.type === "smtp"
												? `${c.smtp_user ?? ""}@${c.smtp_host ?? ""}:${c.smtp_port}`
												: `SES — ${c.ses_region ?? "region not set"}`}
										</p>
										{testResult?.id === c.id && testResult.dir === "out" && (
											<p
												className={`text-xs mt-0.5 ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
											>
												{testResult.msg}
											</p>
										)}
									</div>
									<div className="flex items-center gap-1.5 shrink-0">
										{deleting?.id === c.id && deleting.dir === "out" ? (
											<>
												<span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
												<button
													type="button"
													onClick={() => handleDeleteOutbound(c.id)}
													className="text-xs text-red-600 dark:text-red-400 hover:underline"
												>
													Yes
												</button>
												<button
													type="button"
													onClick={() => setDeleting(null)}
													className="text-xs text-gray-500 hover:underline"
												>
													No
												</button>
											</>
										) : (
											<>
												<button
													type="button"
													onClick={() => handleTestOutbound(c.id)}
													className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-600"
												>
													Test
												</button>
												<button
													type="button"
													onClick={() => {
														setEditingOutbound(c.id);
														setTestResult(null);
													}}
													className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
												>
													Edit
												</button>
												<button
													type="button"
													onClick={() => setDeleting({ id: c.id, dir: "out" })}
													className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400"
												>
													Delete
												</button>
											</>
										)}
									</div>
								</div>

								{/* Identities section */}
								<div className="border-t border-gray-100 dark:border-gray-700/50 px-3 pb-3 pt-2">
									<p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
										Identities
									</p>

									{connectorIdentities.length === 0 && !isEditingIdentityHere && (
										<p className="text-xs text-gray-400 dark:text-gray-500 italic mb-2">
											No identities assigned to this connector.
										</p>
									)}

									{connectorIdentities.map((identity) => (
										<div key={identity.id}>
											{editingIdentityFor === c.id && editingIdentityId === identity.id ? (
												<IdentityForm
													outboundConnectorId={c.id}
													identityId={identity.id}
													onSave={() => {
														setEditingIdentityFor(null);
														setEditingIdentityId(null);
														refetchIdentities();
													}}
													onCancel={() => {
														setEditingIdentityFor(null);
														setEditingIdentityId(null);
													}}
												/>
											) : (
												<div className="mb-1">
													<div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/30">
														<div className="min-w-0">
															<span className="text-sm text-gray-900 dark:text-gray-100">
																{identity.name}
															</span>
															<span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
																{identity.email}
															</span>
														</div>
														<div className="flex items-center gap-1.5 shrink-0">
															<button
																type="button"
																onClick={() => {
																	setEditingIdentityFor(c.id);
																	setEditingIdentityId(identity.id);
																}}
																className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
															>
																Edit
															</button>
															<button
																type="button"
																onClick={() => setDeletingIdentity(identity)}
																className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400"
															>
																Delete
															</button>
														</div>
													</div>
												</div>
											)}
										</div>
									))}

									{isEditingIdentityHere && editingIdentityId === "new" && (
										<IdentityForm
											outboundConnectorId={c.id}
											identityId={null}
											onSave={() => {
												setEditingIdentityFor(null);
												setEditingIdentityId(null);
												refetchIdentities();
											}}
											onCancel={() => {
												setEditingIdentityFor(null);
												setEditingIdentityId(null);
											}}
										/>
									)}

									{!isEditingIdentityHere && (
										<button
											type="button"
											onClick={() => {
												setEditingIdentityFor(c.id);
												setEditingIdentityId("new");
											}}
											className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
										>
											+ Add Identity
										</button>
									)}
								</div>
							</li>
						);
					})}
				</ul>

				{/* Unassigned identities */}
				{(() => {
					const unassigned = (identities ?? []).filter((a) => a.outbound_connector_id === null);
					if (unassigned.length === 0) return null;
					return (
						<div className="mt-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
							<p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
								Unassigned identities: {unassigned.length} email
								{unassigned.length !== 1 ? "s" : ""} have no outbound connector assigned. Edit them
								below.
							</p>
							{unassigned.map((identity) => (
								<div key={identity.id}>
									{editingIdentityFor === -1 && editingIdentityId === identity.id ? (
										outbound && outbound.length > 0 ? (
											<IdentityForm
												outboundConnectorId={outbound[0]?.id ?? 0}
												identityId={identity.id}
												onSave={() => {
													setEditingIdentityFor(null);
													setEditingIdentityId(null);
													refetchIdentities();
												}}
												onCancel={() => {
													setEditingIdentityFor(null);
													setEditingIdentityId(null);
												}}
											/>
										) : (
											<p className="text-xs text-gray-500">Add an outbound connector first.</p>
										)
									) : (
										<div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30">
											<div className="min-w-0">
												<span className="text-sm text-gray-900 dark:text-gray-100">
													{identity.name}
												</span>
												<span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
													{identity.email}
												</span>
											</div>
											<div className="flex items-center gap-1.5 shrink-0">
												<button
													type="button"
													onClick={() => {
														setEditingIdentityFor(-1);
														setEditingIdentityId(identity.id);
													}}
													className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
												>
													Edit
												</button>
												<button
													type="button"
													onClick={() => setDeletingIdentity(identity)}
													className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400"
												>
													Delete
												</button>
											</div>
										</div>
									)}
								</div>
							))}
						</div>
					);
				})()}
			</section>

			{/* Delete identity confirmation */}
			{deletingIdentity && (
				<div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50">
					<div className="bg-white dark:bg-gray-900 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4 space-y-4">
						<h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
							Delete identity
						</h4>
						<p className="text-sm text-gray-600 dark:text-gray-400">
							Delete &ldquo;{deletingIdentity.name}&rdquo; ({deletingIdentity.email})? This removes
							all synced messages and cannot be undone.
						</p>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={() => setDeletingIdentity(null)}
								className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => handleDeleteIdentity(deletingIdentity.id)}
								className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
							>
								Delete Identity
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
