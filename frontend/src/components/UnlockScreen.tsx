import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { MoonIcon, SunIcon } from "./Icons";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";

// Matches the server-side delay progression
const UNLOCK_DELAYS_SEC = [0, 1, 2, 4, 8, 16, 30];

interface UnlockScreenProps {
	onUnlocked: () => void;
	dark: boolean;
	onToggleDark: () => void;
}

export function UnlockScreen({ onUnlocked, dark, onToggleDark }: UnlockScreenProps) {
	const [recoveryMode, setRecoveryMode] = useState(false);
	const [password, setPassword] = useState("");
	const [recoveryMnemonic, setRecoveryMnemonic] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [countdown, setCountdown] = useState(0);
	const failedAttempts = useRef(0);

	// Countdown timer
	useEffect(() => {
		if (countdown <= 0) return;
		const timer = setInterval(() => {
			setCountdown((c) => Math.max(0, c - 1));
		}, 1000);
		return () => clearInterval(timer);
	}, [countdown]);

	const handleUnlock = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setError(null);
		try {
			if (recoveryMode) {
				if (newPassword !== newPasswordConfirm) {
					setError("New passwords do not match.");
					setLoading(false);
					return;
				}
				if (newPassword.length < 12) {
					setError("New password must be at least 12 characters.");
					setLoading(false);
					return;
				}
				await api.encryption.unlock({ recoveryMnemonic, newPassword });
			} else {
				await api.encryption.unlock({ password });
			}
			failedAttempts.current = 0;
			onUnlocked();
		} catch (_err) {
			failedAttempts.current++;
			const nextDelay =
				UNLOCK_DELAYS_SEC[Math.min(failedAttempts.current, UNLOCK_DELAYS_SEC.length - 1)] ?? 0;
			if (nextDelay > 0) {
				setCountdown(nextDelay);
			}
			setError(recoveryMode ? "Invalid recovery phrase or password." : "Incorrect password.");
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

			<div className="w-full max-w-md animate-fadeIn">
				<div className="mb-6 text-center">
					<div className="mb-4">
						<img src="/stork.svg" alt="Stork" className="w-16 h-16 mx-auto rounded-2xl shadow-lg" />
					</div>
					<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
						{recoveryMode ? "Recover Access" : "Unlock Stork"}
					</h1>
					<p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
						{recoveryMode
							? "Enter your 24-word recovery phrase and choose a new password."
							: "Enter your encryption password to unlock your vault."}
					</p>
				</div>

				<form
					onSubmit={handleUnlock}
					className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6 space-y-4"
				>
					{error && (
						<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
							{error}
						</div>
					)}

					{countdown > 0 && (
						<div
							className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-md"
							data-testid="rate-limit-countdown"
						>
							Too many attempts. Try again in {countdown}s.
						</div>
					)}

					{recoveryMode ? (
						<>
							<label className="block">
								<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
									Recovery Phrase
								</span>
								<textarea
									value={recoveryMnemonic}
									onChange={(e) => setRecoveryMnemonic(e.target.value)}
									placeholder="word1 word2 word3 … (24 words)"
									required
									rows={3}
									autoFocus
									className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500 resize-none"
								/>
							</label>

							<label className="block">
								<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
									New Password
								</span>
								<input
									type="password"
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
									placeholder="At least 12 characters"
									required
									className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
								/>
								<PasswordStrengthMeter password={newPassword} />
							</label>

							<label className="block">
								<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
									Confirm New Password
								</span>
								<input
									type="password"
									value={newPasswordConfirm}
									onChange={(e) => setNewPasswordConfirm(e.target.value)}
									placeholder="Repeat your new password"
									required
									className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
								/>
							</label>
						</>
					) : (
						<label className="block">
							<span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Password</span>
							<input
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Your encryption password"
								required
								autoFocus
								className="w-full text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-stork-500 focus:border-stork-500"
							/>
						</label>
					)}

					<button
						type="submit"
						disabled={loading || countdown > 0}
						className="w-full px-5 py-2 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors"
					>
						{loading
							? "Unlocking…"
							: countdown > 0
								? `Wait ${countdown}s…`
								: recoveryMode
									? "Recover & Unlock"
									: "Unlock"}
					</button>

					<div className="text-center">
						<button
							type="button"
							onClick={() => {
								setRecoveryMode(!recoveryMode);
								setError(null);
								setPassword("");
								setRecoveryMnemonic("");
								setNewPassword("");
								setNewPasswordConfirm("");
							}}
							className="text-xs text-stork-600 dark:text-stork-400 hover:text-stork-700 dark:hover:text-stork-300 transition-colors"
						>
							{recoveryMode ? "← Back to password unlock" : "Forgot password? Use recovery phrase"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
