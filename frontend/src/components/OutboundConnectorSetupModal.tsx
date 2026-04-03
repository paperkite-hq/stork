import { useRef, useState } from "react";
import { api } from "../api";
import { useFocusTrap } from "../hooks";

interface Props {
	/** Called when setup is complete and the user wants to open compose. */
	onDone: () => void;
	/** Called if the user dismisses without completing setup. */
	onCancel: () => void;
}

// ── Shared form types (mirroring ConnectorsTab internals) ──────────────────

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

function defaultForm(): OutboundFormData {
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

// ── Step 1: Create Connector ───────────────────────────────────────────────

function ConnectorStep({
	onCreated,
	onCancel,
}: {
	onCreated: () => void;
	onCancel: () => void;
}) {
	const [form, setForm] = useState<OutboundFormData>(defaultForm());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const payload =
				form.type === "smtp"
					? {
							name: form.name,
							type: form.type as "smtp",
							smtp_host: form.smtp_host,
							smtp_port: form.smtp_port,
							smtp_tls: form.smtp_tls,
							smtp_user: form.smtp_user,
							...(form.smtp_pass ? { smtp_pass: form.smtp_pass } : {}),
						}
					: {
							name: form.name,
							type: form.type as "ses",
							ses_region: form.ses_region,
							ses_access_key_id: form.ses_access_key_id,
							...(form.ses_secret_access_key
								? { ses_secret_access_key: form.ses_secret_access_key }
								: {}),
						};
			await api.connectors.outbound.create(payload);
			onCreated();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	const inputClass =
		"w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100";
	const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<div>
				<label htmlFor="obs-name" className={labelClass}>
					Name
				</label>
				<input
					id="obs-name"
					type="text"
					required
					placeholder="My SMTP server"
					value={form.name}
					onChange={(e) => setForm({ ...form, name: e.target.value })}
					className={inputClass}
					autoFocus
				/>
			</div>

			<div>
				<label htmlFor="obs-type" className={labelClass}>
					Type
				</label>
				<select
					id="obs-type"
					value={form.type}
					onChange={(e) => setForm({ ...form, type: e.target.value as "smtp" | "ses" })}
					className={inputClass}
				>
					<option value="smtp">SMTP</option>
					<option value="ses">AWS SES</option>
				</select>
			</div>

			{form.type === "smtp" && (
				<>
					<div>
						<label htmlFor="obs-smtp-host" className={labelClass}>
							SMTP Host
						</label>
						<input
							id="obs-smtp-host"
							type="text"
							required
							placeholder="smtp.example.com"
							value={form.smtp_host}
							onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
							className={inputClass}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div>
							<label htmlFor="obs-smtp-port" className={labelClass}>
								Port
							</label>
							<input
								id="obs-smtp-port"
								type="number"
								value={form.smtp_port}
								onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })}
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="obs-smtp-tls" className={labelClass}>
								TLS
							</label>
							<select
								id="obs-smtp-tls"
								value={form.smtp_tls}
								onChange={(e) => setForm({ ...form, smtp_tls: Number(e.target.value) })}
								className={inputClass}
							>
								<option value={1}>Enabled</option>
								<option value={0}>Disabled</option>
							</select>
						</div>
					</div>

					<div>
						<label htmlFor="obs-smtp-user" className={labelClass}>
							Username
						</label>
						<input
							id="obs-smtp-user"
							type="text"
							required
							value={form.smtp_user}
							onChange={(e) => setForm({ ...form, smtp_user: e.target.value })}
							className={inputClass}
						/>
					</div>

					<div>
						<label htmlFor="obs-smtp-pass" className={labelClass}>
							Password
						</label>
						<input
							id="obs-smtp-pass"
							type="password"
							required
							value={form.smtp_pass}
							onChange={(e) => setForm({ ...form, smtp_pass: e.target.value })}
							className={inputClass}
						/>
					</div>
				</>
			)}

			{form.type === "ses" && (
				<>
					<div>
						<label htmlFor="obs-ses-region" className={labelClass}>
							AWS Region
						</label>
						<input
							id="obs-ses-region"
							type="text"
							required
							placeholder="us-east-1"
							value={form.ses_region}
							onChange={(e) => setForm({ ...form, ses_region: e.target.value })}
							className={inputClass}
						/>
					</div>
					<div>
						<label htmlFor="obs-ses-aki" className={labelClass}>
							Access Key ID (optional — uses instance role if omitted)
						</label>
						<input
							id="obs-ses-aki"
							type="text"
							value={form.ses_access_key_id}
							onChange={(e) => setForm({ ...form, ses_access_key_id: e.target.value })}
							className={inputClass}
						/>
					</div>
					<div>
						<label htmlFor="obs-ses-sak" className={labelClass}>
							Secret Access Key
						</label>
						<input
							id="obs-ses-sak"
							type="password"
							value={form.ses_secret_access_key}
							onChange={(e) => setForm({ ...form, ses_secret_access_key: e.target.value })}
							className={inputClass}
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
					{saving ? "Saving…" : "Save connector"}
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

// ── Main modal ─────────────────────────────────────────────────────────────

type Step = "connector" | "done";

/**
 * Upsell wizard shown when the user tries to compose/reply but has no outbound
 * connectors configured. Walks through creating a connector, then opens compose.
 */
export function OutboundConnectorSetupModal({ onDone, onCancel }: Props) {
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	const [step, setStep] = useState<Step>("connector");

	const stepLabel: Record<Step, string> = {
		connector: "Set up outbound email",
		done: "All set!",
	};

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			aria-labelledby="obs-modal-title"
		>
			<div
				ref={dialogRef}
				className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto"
			>
				{/* Header */}
				<div className="mb-5">
					<h2
						id="obs-modal-title"
						className="text-lg font-semibold text-gray-900 dark:text-gray-100"
					>
						{stepLabel[step]}
					</h2>
					{step === "connector" && (
						<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
							To compose and send email, Stork needs an outbound connector — the SMTP server or AWS
							SES account that will deliver your messages.
						</p>
					)}
					{step === "done" && (
						<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
							Your outbound connector is configured. You can now send email.
						</p>
					)}
				</div>

				{/* Step content */}
				{step === "connector" && (
					<ConnectorStep onCreated={() => setStep("done")} onCancel={onCancel} />
				)}

				{step === "done" && (
					<div className="flex gap-2 pt-1">
						<button
							type="button"
							onClick={onDone}
							className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
						>
							Open compose
						</button>
						<button
							type="button"
							onClick={onCancel}
							className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
						>
							Close
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
