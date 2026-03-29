import { useEffect, useState } from "react";
import { api } from "../api";
import { WELL_KNOWN_PROVIDERS } from "../utils";
import { MoonIcon, SunIcon } from "./Icons";

interface WelcomeProps {
	onIdentityCreated: () => void;
	dark: boolean;
	onToggleDark: () => void;
}

interface SetupFormData {
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
}

export function Welcome({ onIdentityCreated, dark, onToggleDark }: WelcomeProps) {
	const [step, setStep] = useState<"intro" | "form">("intro");
	const [form, setForm] = useState<SetupFormData>({
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
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showAdvanced, setShowAdvanced] = useState(false);

	const setField = <K extends keyof SetupFormData>(key: K, value: SetupFormData[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	// Auto-fill server settings when email domain is recognized.
	// imap_user/smtp_user stay in sync with the email address as long as the
	// user hasn't manually customized them (detected by checking if they still
	// equal the previous email value — if so, keep updating them).
	const handleEmailChange = (email: string) => {
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

	// When email contains "@" but user hasn't typed a name yet, auto-suggest
	// from the local part. Waiting for "@" avoids setting a partial name on
	// the first keystroke (e.g. "J" instead of "John Doe").
	useEffect(() => {
		if (form.email.includes("@") && !form.name) {
			const local = form.email.split("@")[0];
			if (local) {
				const suggested = local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
				setForm((f) => (f.name ? f : { ...f, name: suggested }));
			}
		}
	}, [form.email, form.name]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			await api.identities.create({
				name: form.name,
				email: form.email,
			});
			onIdentityCreated();
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
						A self-hosted email client that keeps your messages in a local SQLite database. Your
						data stays on your machine — searchable, backupable, and fully under your control.
					</p>
					<button
						type="button"
						onClick={() => setStep("form")}
						className="px-6 py-2.5 bg-stork-600 hover:bg-stork-700 text-white rounded-lg font-medium transition-colors shadow-sm"
					>
						Add Your Email
					</button>
					<p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
						Stork connects via IMAP and does not delete mail from your server by default.
					</p>
				</div>
			) : (
				<div className="w-full max-w-lg animate-fadeIn">
					<div className="mb-6 text-center">
						<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
							Connect Your Email
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
							Enter your IMAP credentials to start syncing.
						</p>
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

						{/* Email + name */}
						<div className="space-y-3">
							<Field
								label="Email Address"
								value={form.email}
								onChange={handleEmailChange}
								placeholder="you@example.com"
								type="email"
								required
								autoFocus
							/>
							<Field
								label="Display Name"
								value={form.name}
								onChange={(v) => setField("name", v)}
								placeholder="Your Name"
								required
							/>
						</div>

						{/* IMAP */}
						<fieldset className="space-y-3">
							<legend className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
								Incoming Mail (IMAP)
							</legend>
							<div className="grid grid-cols-3 gap-3">
								<div className="col-span-2">
									<Field
										label="Server"
										value={form.imap_host}
										onChange={(v) => setField("imap_host", v)}
										placeholder="imap.example.com"
										required
									/>
								</div>
								<Field
									label="Port"
									value={String(form.imap_port)}
									onChange={(v) => setField("imap_port", Number(v) || 993)}
									type="number"
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<Field
									label="Username"
									value={form.imap_user}
									onChange={(v) => setField("imap_user", v)}
									placeholder="you@example.com"
									required
								/>
								<Field
									label="Password"
									value={form.imap_pass}
									onChange={(v) => setField("imap_pass", v)}
									type="password"
									required
								/>
							</div>
							<label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
								<input
									type="checkbox"
									checked={form.imap_tls === 1}
									onChange={(e) => setField("imap_tls", e.target.checked ? 1 : 0)}
									className="rounded border-gray-300 dark:border-gray-600"
								/>
								Use TLS (recommended)
							</label>
						</fieldset>

						{/* SMTP (collapsible) */}
						<div>
							<button
								type="button"
								onClick={() => setShowAdvanced(!showAdvanced)}
								className="text-sm text-stork-600 dark:text-stork-400 hover:text-stork-700 dark:hover:text-stork-300 transition-colors"
							>
								{showAdvanced ? "▾ Hide" : "▸ Show"} Outgoing Mail (SMTP)
							</button>
							{showAdvanced && (
								<fieldset className="mt-3 space-y-3">
									<div className="grid grid-cols-3 gap-3">
										<div className="col-span-2">
											<Field
												label="SMTP Server"
												value={form.smtp_host}
												onChange={(v) => setField("smtp_host", v)}
												placeholder="smtp.example.com"
											/>
										</div>
										<Field
											label="Port"
											value={String(form.smtp_port)}
											onChange={(v) => setField("smtp_port", Number(v) || 587)}
											type="number"
										/>
									</div>
									<div className="grid grid-cols-2 gap-3">
										<Field
											label="Username"
											value={form.smtp_user}
											onChange={(v) => setField("smtp_user", v)}
											placeholder="you@example.com"
										/>
										<Field
											label="Password"
											value={form.smtp_pass}
											onChange={(v) => setField("smtp_pass", v)}
											type="password"
										/>
									</div>
									<label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
										<input
											type="checkbox"
											checked={form.smtp_tls === 1}
											onChange={(e) => setField("smtp_tls", e.target.checked ? 1 : 0)}
											className="rounded border-gray-300 dark:border-gray-600"
										/>
										Use TLS
									</label>
								</fieldset>
							)}
						</div>

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
								{loading ? "Connecting..." : "Connect Email"}
							</button>
						</div>

						<p className="text-xs text-gray-400 dark:text-gray-500 text-center">
							Credentials are stored locally in your SQLite database. Stork never sends your data to
							any third party.
						</p>
					</form>
				</div>
			)}
		</div>
	);
}

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
