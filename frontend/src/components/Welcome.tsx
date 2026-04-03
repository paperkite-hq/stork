import { useState } from "react";
import { type CreateInboundConnectorRequest, api } from "../api";
import { WELL_KNOWN_PROVIDERS } from "../utils";
import { MoonIcon, SunIcon } from "./Icons";

interface WelcomeProps {
	onSetupComplete: () => void;
	dark: boolean;
	onToggleDark: () => void;
}

type ConnectorType = "imap" | "cloudflare-r2";

interface ImapFormData {
	imap_host: string;
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	imap_pass: string;
}

interface R2FormData {
	cf_r2_account_id: string;
	cf_r2_bucket_name: string;
	cf_r2_access_key_id: string;
	cf_r2_secret_access_key: string;
}

export function Welcome({ onSetupComplete, dark, onToggleDark }: WelcomeProps) {
	const [step, setStep] = useState<"intro" | "form">("intro");
	const [connectorType, setConnectorType] = useState<ConnectorType>("imap");

	const [imap, setImap] = useState<ImapFormData>({
		imap_host: "",
		imap_port: 993,
		imap_tls: 1,
		imap_user: "",
		imap_pass: "",
	});

	const [r2, setR2] = useState<R2FormData>({
		cf_r2_account_id: "",
		cf_r2_bucket_name: "",
		cf_r2_access_key_id: "",
		cf_r2_secret_access_key: "",
	});

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Auto-fill IMAP server settings when username looks like an email address.
	const handleImapUserChange = (username: string) => {
		const domain = username.split("@")[1]?.toLowerCase();
		if (domain && WELL_KNOWN_PROVIDERS[domain]) {
			const provider = WELL_KNOWN_PROVIDERS[domain];
			setImap((f) => ({
				...f,
				imap_user: username,
				imap_host: f.imap_host || provider.imap_host,
			}));
		} else {
			setImap((f) => ({ ...f, imap_user: username }));
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			// Build connector request
			let connectorReq: CreateInboundConnectorRequest;
			if (connectorType === "imap") {
				connectorReq = {
					name: imap.imap_user || imap.imap_host,
					type: "imap",
					imap_host: imap.imap_host,
					imap_port: imap.imap_port,
					imap_tls: imap.imap_tls,
					imap_user: imap.imap_user,
					imap_pass: imap.imap_pass,
					sync_delete_from_server: 0,
				};
			} else {
				connectorReq = {
					name: r2.cf_r2_bucket_name || "Cloudflare R2",
					type: "cloudflare-r2",
					cf_r2_account_id: r2.cf_r2_account_id,
					cf_r2_bucket_name: r2.cf_r2_bucket_name,
					cf_r2_access_key_id: r2.cf_r2_access_key_id,
					cf_r2_secret_access_key: r2.cf_r2_secret_access_key,
					cf_r2_prefix: "pending/",
				};
			}

			const connector = await api.connectors.inbound.create(connectorReq);

			// Test the connection before closing the wizard
			const result = await api.connectors.inbound.test(connector.id);
			if (!result.ok) {
				// Connection failed — delete the connector and show the error
				await api.connectors.inbound.delete(connector.id);
				setError(
					result.error || "Could not connect — please check your credentials and try again.",
				);
				return;
			}

			onSetupComplete();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
			{/* Dark mode toggle */}
			<button
				type="button"
				onClick={onToggleDark}
				className="absolute top-4 right-4 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex items-center gap-1.5"
				title="Toggle dark mode"
			>
				{dark ? (
					<>
						<SunIcon className="w-3.5 h-3.5" /> Light
					</>
				) : (
					<>
						<MoonIcon className="w-3.5 h-3.5" /> Dark
					</>
				)}
			</button>

			{step === "intro" ? (
				<div className="text-center max-w-md animate-fadeIn">
					{/* Stork icon */}
					<div className="mb-6">
						<img src="/stork.svg" alt="Stork" className="w-20 h-20 mx-auto rounded-2xl shadow-lg" />
					</div>
					<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
						Welcome to Stork
					</h1>
					<p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
						Your email, stored locally in an encrypted database — fully under your control. Connect
						any email source, search everything instantly.
					</p>
					<button
						type="button"
						onClick={() => setStep("form")}
						className="px-6 py-2.5 bg-stork-600 hover:bg-stork-700 text-white rounded-lg font-medium transition-colors shadow-sm"
					>
						Get Started
					</button>
				</div>
			) : (
				<div className="w-full max-w-lg animate-fadeIn">
					<div className="mb-6 text-center">
						<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
							Add a Connector
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Where should Stork pull your email from?
						</p>
					</div>

					{/* Connector type selector */}
					<div className="flex gap-2 mb-4 justify-center">
						<button
							type="button"
							onClick={() => setConnectorType("imap")}
							className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
								connectorType === "imap"
									? "bg-stork-600 border-stork-600 text-white"
									: "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-stork-400"
							}`}
						>
							IMAP
						</button>
						<button
							type="button"
							onClick={() => setConnectorType("cloudflare-r2")}
							className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
								connectorType === "cloudflare-r2"
									? "bg-stork-600 border-stork-600 text-white"
									: "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-stork-400"
							}`}
						>
							Cloudflare R2
						</button>
					</div>

					<form
						onSubmit={handleSubmit}
						className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 space-y-5"
					>
						{error && (
							<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
								{error}
							</div>
						)}

						{connectorType === "imap" ? (
							<ImapForm data={imap} onChange={setImap} onUserChange={handleImapUserChange} />
						) : (
							<R2Form data={r2} onChange={setR2} />
						)}

						{/* Actions */}
						<div className="flex items-center justify-between pt-2">
							<button
								type="button"
								onClick={() => setStep("intro")}
								className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
							>
								Back
							</button>
							<button
								type="submit"
								disabled={loading}
								className="px-5 py-2 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
							>
								{loading ? "Testing connection..." : "Connect"}
							</button>
						</div>

						<p className="text-xs text-gray-400 dark:text-gray-500 text-center">
							Credentials are stored encrypted in your local database. Stork never sends your data
							to any third party.
						</p>
					</form>
				</div>
			)}
		</div>
	);
}

// ── IMAP form ─────────────────────────────────────────────────────────────────

function ImapForm({
	data,
	onChange,
	onUserChange,
}: {
	data: ImapFormData;
	onChange: (d: ImapFormData) => void;
	onUserChange: (username: string) => void;
}) {
	return (
		<div className="space-y-3">
			<Field
				label="Username"
				value={data.imap_user}
				onChange={onUserChange}
				placeholder="you@example.com"
				required
				autoFocus
			/>
			<div className="grid grid-cols-3 gap-3">
				<div className="col-span-2">
					<Field
						label="Server"
						value={data.imap_host}
						onChange={(v) => onChange({ ...data, imap_host: v })}
						placeholder="imap.example.com"
						required
					/>
				</div>
				<Field
					label="Port"
					value={String(data.imap_port)}
					onChange={(v) => onChange({ ...data, imap_port: Number(v) || 993 })}
					type="number"
				/>
			</div>
			<Field
				label="Password"
				value={data.imap_pass}
				onChange={(v) => onChange({ ...data, imap_pass: v })}
				type="password"
				required
			/>
			<label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
				<input
					type="checkbox"
					checked={data.imap_tls === 1}
					onChange={(e) => onChange({ ...data, imap_tls: e.target.checked ? 1 : 0 })}
					className="rounded border-gray-300 dark:border-gray-600"
				/>
				Use TLS (recommended)
			</label>
		</div>
	);
}

// ── Cloudflare R2 form ────────────────────────────────────────────────────────

function R2Form({
	data,
	onChange,
}: {
	data: R2FormData;
	onChange: (d: R2FormData) => void;
}) {
	return (
		<div className="space-y-3">
			<div className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2 space-y-1">
				<p className="font-medium">Cloudflare R2 queue/poll model</p>
				<p>
					A Cloudflare Email Worker writes each inbound email as an object to an R2 bucket. Stork
					polls the bucket on a regular interval — no public webhook required.
				</p>
			</div>
			<Field
				label="Account ID"
				value={data.cf_r2_account_id}
				onChange={(v) => onChange({ ...data, cf_r2_account_id: v })}
				placeholder="Cloudflare Account ID"
				required
				autoFocus
			/>
			<Field
				label="Bucket Name"
				value={data.cf_r2_bucket_name}
				onChange={(v) => onChange({ ...data, cf_r2_bucket_name: v })}
				placeholder="my-email-bucket"
				required
			/>
			<div className="grid grid-cols-2 gap-3">
				<Field
					label="Access Key ID"
					value={data.cf_r2_access_key_id}
					onChange={(v) => onChange({ ...data, cf_r2_access_key_id: v })}
					placeholder="Access Key ID"
					required
				/>
				<Field
					label="Secret Access Key"
					value={data.cf_r2_secret_access_key}
					onChange={(v) => onChange({ ...data, cf_r2_secret_access_key: v })}
					type="password"
					placeholder="Secret Key"
					required
				/>
			</div>
		</div>
	);
}

// ── Generic field ─────────────────────────────────────────────────────────────

function Field({
	label,
	value,
	onChange,
	type = "text",
	placeholder,
	required = false,
	autoFocus = false,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	type?: string;
	placeholder?: string;
	required?: boolean;
	autoFocus?: boolean;
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
				autoFocus={autoFocus}
				className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
			/>
		</label>
	);
}
