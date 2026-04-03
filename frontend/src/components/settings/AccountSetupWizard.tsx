import { useState } from "react";
import {
	type CreateInboundConnectorRequest,
	type CreateOutboundConnectorRequest,
	type InboundConnector,
	type OutboundConnector,
	api,
} from "../../api";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

interface IdentityData {
	name: string;
	email: string;
}

interface InboundData {
	mode: "existing" | "new";
	existingId: number | null;
	// new connector
	connectorName: string;
	type: "imap" | "cloudflare-r2";
	imap_host: string;
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	imap_pass: string;
	sync_delete_from_server: number;
	cf_r2_account_id: string;
	cf_r2_bucket_name: string;
	cf_r2_access_key_id: string;
	cf_r2_secret_access_key: string;
	cf_r2_prefix: string;
}

interface OutboundData {
	mode: "existing" | "new" | "skip";
	existingId: number | null;
	// new connector
	connectorName: string;
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

function defaultInbound(existing: InboundConnector[]): InboundData {
	return {
		mode: existing.length > 0 ? "existing" : "new",
		existingId: existing[0]?.id ?? null,
		connectorName: "",
		type: "imap",
		imap_host: "",
		imap_port: 993,
		imap_tls: 1,
		imap_user: "",
		imap_pass: "",
		sync_delete_from_server: 0,
		cf_r2_account_id: "",
		cf_r2_bucket_name: "",
		cf_r2_access_key_id: "",
		cf_r2_secret_access_key: "",
		cf_r2_prefix: "pending/",
	};
}

function defaultOutbound(existing: OutboundConnector[]): OutboundData {
	return {
		mode: existing.length > 0 ? "existing" : "skip",
		existingId: existing[0]?.id ?? null,
		connectorName: "",
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

// ── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
	const steps = [
		{ n: 1, label: "Email" },
		{ n: 2, label: "Inbound" },
		{ n: 3, label: "Outbound" },
		{ n: 4, label: "Review" },
	] as const;
	return (
		<div className="flex items-center gap-1 mb-6">
			{steps.map(({ n, label }, i) => (
				<div key={n} className="flex items-center gap-1">
					<div
						className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
							n === current
								? "bg-stork-600 text-white"
								: n < current
									? "bg-stork-100 dark:bg-stork-900 text-stork-700 dark:text-stork-300"
									: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
						}`}
					>
						<span
							className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
								n < current
									? "bg-stork-500 text-white"
									: n === current
										? "bg-white/30 text-white"
										: "bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
							}`}
						>
							{n < current ? "✓" : n}
						</span>
						{label}
					</div>
					{i < steps.length - 1 && (
						<div
							className={`w-4 h-px ${n < current ? "bg-stork-300 dark:bg-stork-700" : "bg-gray-200 dark:bg-gray-700"}`}
						/>
					)}
				</div>
			))}
		</div>
	);
}

// ── Input helpers ──────────────────────────────────────────────────────────

function Field({
	label,
	id,
	required,
	children,
}: {
	label: string;
	id?: string;
	required?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div>
			<label
				htmlFor={id}
				className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5"
			>
				{label} {required && <span className="text-red-500">*</span>}
			</label>
			{children}
		</div>
	);
}

const inputCls =
	"w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100";

// ── Step 1: Email identity basics ──────────────────────────────────────────

function Step1({
	data,
	onChange,
	onNext,
	onCancel,
}: {
	data: IdentityData;
	onChange: (d: IdentityData) => void;
	onNext: () => void;
	onCancel: () => void;
}) {
	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		onNext();
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
					Start with your email identity — the name and email address that will appear when you send
					mail.
				</p>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Display Name" id="wiz-name" required>
					<input
						id="wiz-name"
						type="text"
						required
						placeholder="Work Email"
						value={data.name}
						onChange={(e) => onChange({ ...data, name: e.target.value })}
						className={inputCls}
					/>
				</Field>
				<Field label="Email Address" id="wiz-email" required>
					<input
						id="wiz-email"
						type="email"
						required
						placeholder="you@example.com"
						value={data.email}
						onChange={(e) => onChange({ ...data, email: e.target.value })}
						className={inputCls}
					/>
				</Field>
			</div>
			<NavRow onCancel={onCancel} nextLabel="Next: Inbound →" />
		</form>
	);
}

// ── Step 2: Inbound connector ──────────────────────────────────────────────

function Step2({
	data,
	existingConnectors,
	onChange,
	onNext,
	onBack,
}: {
	data: InboundData;
	existingConnectors: InboundConnector[];
	onChange: (d: InboundData) => void;
	onNext: () => void;
	onBack: () => void;
}) {
	const [showConnectorWarning, setShowConnectorWarning] = useState(false);

	function handleSelectConnectorMode() {
		onChange({ ...data, sync_delete_from_server: 1 });
		setShowConnectorWarning(true);
	}

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		onNext();
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<p className="text-sm text-gray-600 dark:text-gray-400">
				How will Stork receive your email? Stork polls your IMAP server or polls a Cloudflare R2
				bucket for queued emails.
			</p>

			{/* mode selector */}
			<div className="flex gap-3">
				{existingConnectors.length > 0 && (
					<ModeButton
						active={data.mode === "existing"}
						onClick={() => onChange({ ...data, mode: "existing" })}
						label="Use existing connector"
					/>
				)}
				<ModeButton
					active={data.mode === "new"}
					onClick={() => onChange({ ...data, mode: "new" })}
					label="Create new connector"
				/>
			</div>

			{data.mode === "existing" && existingConnectors.length > 0 && (
				<Field label="Inbound Connector" id="wiz-ib-existing" required>
					<select
						id="wiz-ib-existing"
						value={data.existingId ?? ""}
						onChange={(e) =>
							onChange({ ...data, existingId: e.target.value ? Number(e.target.value) : null })
						}
						required
						className={inputCls}
					>
						<option value="">Select…</option>
						{existingConnectors.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name} —{" "}
								{c.type === "imap" ? `${c.imap_user}@${c.imap_host}` : "Cloudflare Email"}
							</option>
						))}
					</select>
				</Field>
			)}

			{data.mode === "new" && (
				<div className="space-y-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
					<Field label="Connector Name" id="wiz-ib-name" required>
						<input
							id="wiz-ib-name"
							type="text"
							required
							placeholder="My IMAP"
							value={data.connectorName}
							onChange={(e) => onChange({ ...data, connectorName: e.target.value })}
							className={inputCls}
						/>
					</Field>

					<Field label="Type" id="wiz-ib-type">
						<select
							id="wiz-ib-type"
							value={data.type}
							onChange={(e) =>
								onChange({ ...data, type: e.target.value as "imap" | "cloudflare-r2" })
							}
							className={inputCls}
						>
							<option value="imap">IMAP</option>
							<option value="cloudflare-r2">Cloudflare R2 (queue/poll)</option>
						</select>
					</Field>

					{data.type === "imap" && (
						<div className="rounded-lg border-2 border-stork-300 dark:border-stork-700 bg-stork-50 dark:bg-stork-950 px-4 py-3 space-y-2">
							<p className="text-sm font-bold text-stork-800 dark:text-stork-200">
								⚡ Two minutes to understand how Stork thinks about email
							</p>
							<p className="text-xs text-stork-700 dark:text-stork-300">
								Most email clients treat your mail provider as the permanent home for your email.
								Stork{"'"}s philosophy is different:{" "}
								<strong>your provider is just the delivery edge</strong>. Mail arrives there, Stork
								picks it up and stores it encrypted on your own hardware, and — when you{"'"}re
								ready — clears it from the provider.
							</p>
							<p className="text-xs text-stork-700 dark:text-stork-300">
								<strong>Mirror mode (default):</strong> Stork reads alongside your provider. Both
								have copies. Perfect for trying Stork — your provider stays your safety net.
							</p>
							<p className="text-xs text-stork-700 dark:text-stork-300">
								<strong>Connector mode:</strong> Once you{"'"}re confident, Stork becomes your
								permanent encrypted email home — mail arrives, Stork grabs it and erases it from the
								server. Back up your Stork database.
							</p>
						</div>
					)}

					{data.type === "imap" && (
						<>
							<Field label="IMAP Host" id="wiz-ib-host" required>
								<input
									id="wiz-ib-host"
									type="text"
									required
									placeholder="imap.example.com"
									value={data.imap_host}
									onChange={(e) => onChange({ ...data, imap_host: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Port" id="wiz-ib-port">
									<input
										id="wiz-ib-port"
										type="number"
										value={data.imap_port}
										onChange={(e) => onChange({ ...data, imap_port: Number(e.target.value) })}
										className={inputCls}
									/>
								</Field>
								<Field label="TLS" id="wiz-ib-tls">
									<select
										id="wiz-ib-tls"
										value={data.imap_tls}
										onChange={(e) => onChange({ ...data, imap_tls: Number(e.target.value) })}
										className={inputCls}
									>
										<option value={1}>Enabled</option>
										<option value={0}>Disabled</option>
									</select>
								</Field>
							</div>
							<Field label="Username" id="wiz-ib-user" required>
								<input
									id="wiz-ib-user"
									type="text"
									required
									value={data.imap_user}
									onChange={(e) => onChange({ ...data, imap_user: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="Password" id="wiz-ib-pass" required>
								<input
									id="wiz-ib-pass"
									type="password"
									required
									value={data.imap_pass}
									onChange={(e) => onChange({ ...data, imap_pass: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<div className="space-y-1.5">
								<label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
									<input
										type="radio"
										name="wiz-sync-mode"
										value="mirror"
										checked={data.sync_delete_from_server === 0}
										onChange={() => {
											onChange({ ...data, sync_delete_from_server: 0 });
											setShowConnectorWarning(false);
										}}
										className="mt-0.5 shrink-0"
									/>
									<span>
										<span className="font-medium">Mirror mode</span> — Stork reads alongside your
										provider; your IMAP mailbox stays intact.
									</span>
								</label>
								<label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
									<input
										type="radio"
										name="wiz-sync-mode"
										value="connector"
										checked={data.sync_delete_from_server === 1}
										onChange={handleSelectConnectorMode}
										className="mt-0.5 shrink-0"
									/>
									<span>
										<span className="font-medium">Connector mode</span> — After syncing, Stork
										deletes messages from your IMAP server and becomes your permanent encrypted
										email home.
									</span>
								</label>
								{showConnectorWarning && (
									<p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded px-3 py-2">
										Great choice! Just so you know: Stork will remove messages from your IMAP
										mailbox after importing them — Stork becomes the single source of truth for your
										email. Make sure to keep your Stork database backed up.
									</p>
								)}
							</div>
						</>
					)}

					{data.type === "cloudflare-r2" && (
						<>
							<div className="text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded px-3 py-2 space-y-1">
								<p className="font-medium">Cloudflare R2 queue/poll model</p>
								<p>
									A Cloudflare Email Worker writes each inbound email as an object to an R2 bucket.
									Stork polls the bucket on a regular interval — no public webhook required.
								</p>
							</div>
							<Field label="Cloudflare Account ID" id="wiz-ib-r2-account" required>
								<input
									id="wiz-ib-r2-account"
									type="text"
									required
									value={data.cf_r2_account_id}
									onChange={(e) => onChange({ ...data, cf_r2_account_id: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="R2 Bucket Name" id="wiz-ib-r2-bucket" required>
								<input
									id="wiz-ib-r2-bucket"
									type="text"
									required
									value={data.cf_r2_bucket_name}
									onChange={(e) => onChange({ ...data, cf_r2_bucket_name: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="R2 Access Key ID" id="wiz-ib-r2-aki" required>
								<input
									id="wiz-ib-r2-aki"
									type="text"
									required
									value={data.cf_r2_access_key_id}
									onChange={(e) => onChange({ ...data, cf_r2_access_key_id: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="R2 Secret Access Key" id="wiz-ib-r2-sak" required>
								<input
									id="wiz-ib-r2-sak"
									type="password"
									required
									value={data.cf_r2_secret_access_key}
									onChange={(e) => onChange({ ...data, cf_r2_secret_access_key: e.target.value })}
									className={inputCls}
								/>
							</Field>
						</>
					)}
				</div>
			)}

			<NavRow onBack={onBack} nextLabel="Next: Outbound →" />
		</form>
	);
}

// ── Step 3: Outbound connector ─────────────────────────────────────────────

function Step3({
	data,
	existingConnectors,
	onChange,
	onNext,
	onBack,
}: {
	data: OutboundData;
	existingConnectors: OutboundConnector[];
	onChange: (d: OutboundData) => void;
	onNext: () => void;
	onBack: () => void;
}) {
	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		onNext();
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<p className="text-sm text-gray-600 dark:text-gray-400">
				Optionally configure how Stork sends email. You can skip this and add it later.
			</p>

			<div className="flex gap-3 flex-wrap">
				{existingConnectors.length > 0 && (
					<ModeButton
						active={data.mode === "existing"}
						onClick={() => onChange({ ...data, mode: "existing" })}
						label="Use existing connector"
					/>
				)}
				<ModeButton
					active={data.mode === "new"}
					onClick={() => onChange({ ...data, mode: "new" })}
					label="Create new connector"
				/>
				<ModeButton
					active={data.mode === "skip"}
					onClick={() => onChange({ ...data, mode: "skip" })}
					label="Skip (receive only)"
				/>
			</div>

			{data.mode === "existing" && existingConnectors.length > 0 && (
				<Field label="Outbound Connector" id="wiz-ob-existing" required>
					<select
						id="wiz-ob-existing"
						value={data.existingId ?? ""}
						onChange={(e) =>
							onChange({ ...data, existingId: e.target.value ? Number(e.target.value) : null })
						}
						required
						className={inputCls}
					>
						<option value="">Select…</option>
						{existingConnectors.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name} —{" "}
								{c.type === "smtp" ? `${c.smtp_user}@${c.smtp_host}` : `SES ${c.ses_region}`}
							</option>
						))}
					</select>
				</Field>
			)}

			{data.mode === "new" && (
				<div className="space-y-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
					<Field label="Connector Name" id="wiz-ob-name" required>
						<input
							id="wiz-ob-name"
							type="text"
							required
							placeholder="My SMTP"
							value={data.connectorName}
							onChange={(e) => onChange({ ...data, connectorName: e.target.value })}
							className={inputCls}
						/>
					</Field>

					<Field label="Type" id="wiz-ob-type">
						<select
							id="wiz-ob-type"
							value={data.type}
							onChange={(e) => onChange({ ...data, type: e.target.value as "smtp" | "ses" })}
							className={inputCls}
						>
							<option value="smtp">SMTP</option>
							<option value="ses">AWS SES</option>
						</select>
					</Field>

					{data.type === "smtp" && (
						<>
							<Field label="SMTP Host" id="wiz-ob-host" required>
								<input
									id="wiz-ob-host"
									type="text"
									required
									placeholder="smtp.example.com"
									value={data.smtp_host}
									onChange={(e) => onChange({ ...data, smtp_host: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Port" id="wiz-ob-port">
									<input
										id="wiz-ob-port"
										type="number"
										value={data.smtp_port}
										onChange={(e) => onChange({ ...data, smtp_port: Number(e.target.value) })}
										className={inputCls}
									/>
								</Field>
								<Field label="TLS" id="wiz-ob-tls">
									<select
										id="wiz-ob-tls"
										value={data.smtp_tls}
										onChange={(e) => onChange({ ...data, smtp_tls: Number(e.target.value) })}
										className={inputCls}
									>
										<option value={1}>Enabled</option>
										<option value={0}>Disabled</option>
									</select>
								</Field>
							</div>
							<Field label="Username" id="wiz-ob-user" required>
								<input
									id="wiz-ob-user"
									type="text"
									required
									value={data.smtp_user}
									onChange={(e) => onChange({ ...data, smtp_user: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="Password" id="wiz-ob-pass" required>
								<input
									id="wiz-ob-pass"
									type="password"
									required
									value={data.smtp_pass}
									onChange={(e) => onChange({ ...data, smtp_pass: e.target.value })}
									className={inputCls}
								/>
							</Field>
						</>
					)}

					{data.type === "ses" && (
						<>
							<Field label="AWS Region" id="wiz-ob-ses-region" required>
								<input
									id="wiz-ob-ses-region"
									type="text"
									required
									placeholder="us-east-1"
									value={data.ses_region}
									onChange={(e) => onChange({ ...data, ses_region: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field
								label="Access Key ID (optional — uses instance role if omitted)"
								id="wiz-ob-aki"
							>
								<input
									id="wiz-ob-aki"
									type="text"
									value={data.ses_access_key_id}
									onChange={(e) => onChange({ ...data, ses_access_key_id: e.target.value })}
									className={inputCls}
								/>
							</Field>
							<Field label="Secret Access Key" id="wiz-ob-sak" required>
								<input
									id="wiz-ob-sak"
									type="password"
									required
									value={data.ses_secret_access_key}
									onChange={(e) => onChange({ ...data, ses_secret_access_key: e.target.value })}
									className={inputCls}
								/>
							</Field>
						</>
					)}
				</div>
			)}

			{data.mode === "skip" && (
				<p className="text-xs text-gray-500 dark:text-gray-400 italic">
					You can add an outbound connector later from the Outbound tab in Settings.
				</p>
			)}

			<NavRow onBack={onBack} nextLabel="Review →" />
		</form>
	);
}

// ── Step 4: Review & Create ────────────────────────────────────────────────

function Step4({
	identity,
	inbound,
	outbound,
	existingInbound,
	existingOutbound,
	onBack,
	onDone,
}: {
	identity: IdentityData;
	inbound: InboundData;
	outbound: OutboundData;
	existingInbound: InboundConnector[];
	existingOutbound: OutboundConnector[];
	onBack: () => void;
	onDone: () => void;
}) {
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inboundSummary =
		inbound.mode === "existing"
			? (() => {
					const c = existingInbound.find((c) => c.id === inbound.existingId);
					return c
						? `${c.name} (existing — ${c.type === "imap" ? `${c.imap_user}@${c.imap_host}` : `Cloudflare R2: ${c.cf_r2_bucket_name}`})`
						: "Unknown connector";
				})()
			: inbound.type === "imap"
				? `New IMAP: ${inbound.imap_user}@${inbound.imap_host}:${inbound.imap_port}`
				: `New Cloudflare R2: ${inbound.cf_r2_bucket_name}`;

	const outboundSummary =
		outbound.mode === "skip"
			? "None (receive only)"
			: outbound.mode === "existing"
				? (() => {
						const c = existingOutbound.find((c) => c.id === outbound.existingId);
						return c
							? `${c.name} (existing — ${c.type === "smtp" ? `${c.smtp_user}@${c.smtp_host}` : `SES ${c.ses_region}`})`
							: "Unknown connector";
					})()
				: outbound.type === "smtp"
					? `New SMTP: ${outbound.smtp_user}@${outbound.smtp_host}:${outbound.smtp_port}`
					: `New AWS SES: ${outbound.ses_region}`;

	async function handleCreate() {
		setCreating(true);
		setError(null);

		let outboundId: number | undefined;

		try {
			// Create inbound connector if needed
			if (inbound.mode === "new") {
				const payload: CreateInboundConnectorRequest = {
					name: inbound.connectorName,
					type: inbound.type,
					...(inbound.type === "imap"
						? {
								imap_host: inbound.imap_host,
								imap_port: inbound.imap_port,
								imap_tls: inbound.imap_tls,
								imap_user: inbound.imap_user,
								imap_pass: inbound.imap_pass,
								sync_delete_from_server: inbound.sync_delete_from_server,
							}
						: {
								cf_r2_account_id: inbound.cf_r2_account_id,
								cf_r2_bucket_name: inbound.cf_r2_bucket_name,
								cf_r2_access_key_id: inbound.cf_r2_access_key_id,
								cf_r2_secret_access_key: inbound.cf_r2_secret_access_key,
								cf_r2_prefix: inbound.cf_r2_prefix || "pending/",
							}),
				};
				await api.connectors.inbound.create(payload);
			}

			// Create outbound connector if needed
			if (outbound.mode === "new") {
				const payload: CreateOutboundConnectorRequest = {
					name: outbound.connectorName,
					type: outbound.type,
					...(outbound.type === "smtp"
						? {
								smtp_host: outbound.smtp_host,
								smtp_port: outbound.smtp_port,
								smtp_tls: outbound.smtp_tls,
								smtp_user: outbound.smtp_user,
								smtp_pass: outbound.smtp_pass,
							}
						: {
								ses_region: outbound.ses_region,
								...(outbound.ses_access_key_id
									? { ses_access_key_id: outbound.ses_access_key_id }
									: {}),
								...(outbound.ses_secret_access_key
									? { ses_secret_access_key: outbound.ses_secret_access_key }
									: {}),
							}),
				};
				const created = await api.connectors.outbound.create(payload);
				outboundId = created.id;
			} else if (outbound.mode === "existing") {
				outboundId = outbound.existingId ?? undefined;
			}

			// Create identity (send-only: name + email + outbound connector)
			await api.identities.create({
				name: identity.name,
				email: identity.email,
				...(outboundId ? { outbound_connector_id: outboundId } : {}),
				default_view: "inbox",
			});

			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}

	return (
		<div className="space-y-4">
			<p className="text-sm text-gray-600 dark:text-gray-400">
				Review your setup before creating. All resources will be created in one step.
			</p>

			<div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
				<ReviewRow label="Email" value={`${identity.name} <${identity.email}>`} />
				<ReviewRow label="Inbound" value={inboundSummary} />
				<ReviewRow label="Outbound" value={outboundSummary} />
			</div>

			{error && (
				<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
					{error}
				</div>
			)}

			<div className="flex items-center justify-between pt-2">
				<button
					type="button"
					onClick={onBack}
					disabled={creating}
					className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
				>
					← Back
				</button>
				<button
					type="button"
					onClick={handleCreate}
					disabled={creating}
					className="px-5 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{creating ? "Creating…" : "Create Email Identity"}
				</button>
			</div>
		</div>
	);
}

function ReviewRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex gap-4 px-4 py-2.5">
			<span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20 shrink-0 pt-0.5">
				{label}
			</span>
			<span className="text-sm text-gray-900 dark:text-gray-100">{value}</span>
		</div>
	);
}

// ── Shared nav helpers ─────────────────────────────────────────────────────

function NavRow({
	onBack,
	onCancel,
	nextLabel,
}: {
	onBack?: () => void;
	onCancel?: () => void;
	nextLabel: string;
}) {
	return (
		<div className="flex items-center justify-between pt-2">
			{onBack ? (
				<button
					type="button"
					onClick={onBack}
					className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
				>
					← Back
				</button>
			) : onCancel ? (
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
				>
					Cancel
				</button>
			) : (
				<div />
			)}
			<button
				type="submit"
				className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 text-white rounded-md text-sm font-medium transition-colors"
			>
				{nextLabel}
			</button>
		</div>
	);
}

function ModeButton({
	active,
	onClick,
	label,
}: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
				active
					? "bg-stork-600 border-stork-600 text-white"
					: "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-stork-400 dark:hover:border-stork-600"
			}`}
		>
			{label}
		</button>
	);
}

// ── Main wizard component ──────────────────────────────────────────────────

export function AccountSetupWizard({
	existingInbound,
	existingOutbound,
	onDone,
	onCancel,
}: {
	existingInbound: InboundConnector[];
	existingOutbound: OutboundConnector[];
	onDone: () => void;
	onCancel: () => void;
}) {
	const [step, setStep] = useState<Step>(1);
	const [identity, setIdentity] = useState<IdentityData>({ name: "", email: "" });
	const [inbound, setInbound] = useState<InboundData>(() => defaultInbound(existingInbound));
	const [outbound, setOutbound] = useState<OutboundData>(() => defaultOutbound(existingOutbound));

	return (
		<div
			className="fixed inset-0 z-60 flex items-center justify-center bg-black/50"
			role="dialog"
			aria-modal="true"
			aria-label="Add Email Identity"
		>
			<div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 flex flex-col min-h-[480px] max-h-[90vh] overflow-y-auto">
				<div className="flex items-center justify-between mb-2">
					<h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
						Add Email Identity
					</h3>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
					>
						✕
					</button>
				</div>

				<StepIndicator current={step} />

				{step === 1 && (
					<Step1
						data={identity}
						onChange={setIdentity}
						onNext={() => setStep(2)}
						onCancel={onCancel}
					/>
				)}
				{step === 2 && (
					<Step2
						data={inbound}
						existingConnectors={existingInbound}
						onChange={setInbound}
						onNext={() => setStep(3)}
						onBack={() => setStep(1)}
					/>
				)}
				{step === 3 && (
					<Step3
						data={outbound}
						existingConnectors={existingOutbound}
						onChange={setOutbound}
						onNext={() => setStep(4)}
						onBack={() => setStep(2)}
					/>
				)}
				{step === 4 && (
					<Step4
						identity={identity}
						inbound={inbound}
						outbound={outbound}
						existingInbound={existingInbound}
						existingOutbound={existingOutbound}
						onBack={() => setStep(3)}
						onDone={onDone}
					/>
				)}
			</div>
		</div>
	);
}
