import { useState } from "react";
import { api } from "../api";
import { MoonIcon, SunIcon } from "./Icons";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";

interface SetupScreenProps {
	onUnlocked: () => void;
	dark: boolean;
	onToggleDark: () => void;
}

type Step = "password" | "mnemonic";

export function SetupScreen({ onUnlocked, dark, onToggleDark }: SetupScreenProps) {
	const [step, setStep] = useState<Step>("password");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [mnemonic, setMnemonic] = useState<string | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSetup = async (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirm) {
			setError("Passwords do not match.");
			return;
		}
		if (password.length < 12) {
			setError("Password must be at least 12 characters.");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const { recoveryMnemonic } = await api.encryption.setup(password);
			setMnemonic(recoveryMnemonic);
			setStep("mnemonic");
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

			{step === "password" ? (
				<div className="w-full max-w-md animate-fadeIn">
					<div className="mb-6 text-center">
						<div className="mb-4">
							<img
								src="/stork.svg"
								alt="Stork"
								className="w-16 h-16 mx-auto rounded-2xl shadow-lg"
							/>
						</div>
						<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
							Set Up Encryption
						</h1>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
							Stork encrypts your email database with a password you choose. You'll also receive a
							24-word recovery phrase — keep it safe.
						</p>
					</div>

					<form
						onSubmit={handleSetup}
						className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 space-y-4"
					>
						{error && (
							<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
								{error}
							</div>
						)}

						<label className="block">
							<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
								Encryption Password
							</span>
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="At least 12 characters"
								required
								autoFocus
								className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
							/>
							<PasswordStrengthMeter password={password} />
						</label>

						<label className="block">
							<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
								Confirm Password
							</span>
							<input
								type="password"
								value={confirm}
								onChange={(e) => setConfirm(e.target.value)}
								placeholder="Repeat your password"
								required
								className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
							/>
						</label>

						<button
							type="submit"
							disabled={loading}
							className="w-full px-5 py-2 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
						>
							{loading ? "Setting up…" : "Create Encrypted Vault"}
						</button>
					</form>
				</div>
			) : (
				<div className="w-full max-w-lg animate-fadeIn">
					<div className="mb-6 text-center">
						<h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
							Save Your Recovery Phrase
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
							This 24-word phrase is the only way to recover your vault if you forget your password.
							Write it down and store it somewhere safe. You will not see it again.
						</p>
					</div>

					<div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 space-y-5">
						<div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
							<p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-3">
								Recovery Phrase
							</p>
							<div className="grid grid-cols-4 gap-2">
								{mnemonic?.split(/\s+/).map((word, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: order-dependent list
									<div key={i} className="flex items-center gap-1.5">
										<span className="text-xs text-amber-500 dark:text-amber-600 w-5 text-right flex-shrink-0">
											{i + 1}.
										</span>
										<span className="text-sm font-mono text-gray-800 dark:text-gray-200">
											{word}
										</span>
									</div>
								))}
							</div>
						</div>

						<label className="flex items-start gap-3 cursor-pointer">
							<input
								type="checkbox"
								checked={acknowledged}
								onChange={(e) => setAcknowledged(e.target.checked)}
								className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
							/>
							<span className="text-sm text-gray-600 dark:text-gray-400">
								I've written down my recovery phrase and stored it safely. I understand that losing
								both my password and recovery phrase means permanent loss of access.
							</span>
						</label>

						<button
							type="button"
							disabled={!acknowledged}
							onClick={onUnlocked}
							className="w-full px-5 py-2 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition-colors"
						>
							Continue to Stork
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
