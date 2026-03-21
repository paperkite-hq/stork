import { useState } from "react";
import { api } from "../../api";
import { FormField } from "./FormField";

export function SecurityTab() {
	// Change password state
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [changePwLoading, setChangePwLoading] = useState(false);
	const [changePwError, setChangePwError] = useState<string | null>(null);
	const [changePwSuccess, setChangePwSuccess] = useState(false);

	// Rotate recovery key state
	const [rotatePassword, setRotatePassword] = useState("");
	const [rotateLoading, setRotateLoading] = useState(false);
	const [rotateError, setRotateError] = useState<string | null>(null);
	const [newMnemonic, setNewMnemonic] = useState<string | null>(null);
	const [rotateAcknowledged, setRotateAcknowledged] = useState(false);

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			setChangePwError("New passwords do not match.");
			return;
		}
		if (newPassword.length < 12) {
			setChangePwError("New password must be at least 12 characters.");
			return;
		}
		setChangePwLoading(true);
		setChangePwError(null);
		setChangePwSuccess(false);
		try {
			await api.encryption.changePassword(currentPassword, newPassword);
			setChangePwSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err) {
			setChangePwError((err as Error).message);
		} finally {
			setChangePwLoading(false);
		}
	};

	const handleRotateRecoveryKey = async (e: React.FormEvent) => {
		e.preventDefault();
		setRotateLoading(true);
		setRotateError(null);
		try {
			const { recoveryMnemonic } = await api.encryption.rotateRecoveryKey(rotatePassword);
			setNewMnemonic(recoveryMnemonic);
			setRotatePassword("");
		} catch (err) {
			setRotateError((err as Error).message);
		} finally {
			setRotateLoading(false);
		}
	};

	const handleRotateDone = () => {
		setNewMnemonic(null);
		setRotateAcknowledged(false);
	};

	return (
		<div className="space-y-8">
			<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Security</h3>

			{/* Change Password */}
			<form onSubmit={handleChangePassword} className="space-y-4">
				<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Change Password</h4>

				{changePwError && (
					<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
						{changePwError}
					</div>
				)}
				{changePwSuccess && (
					<div className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-md">
						Password changed successfully.
					</div>
				)}

				<FormField
					label="Current Password"
					value={currentPassword}
					onChange={setCurrentPassword}
					type="password"
					placeholder="Your current encryption password"
					required
				/>
				<FormField
					label="New Password"
					value={newPassword}
					onChange={setNewPassword}
					type="password"
					placeholder="At least 12 characters"
					required
				/>
				<FormField
					label="Confirm New Password"
					value={confirmPassword}
					onChange={setConfirmPassword}
					type="password"
					placeholder="Repeat your new password"
					required
				/>

				<button
					type="submit"
					disabled={changePwLoading}
					className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
				>
					{changePwLoading ? "Changing…" : "Change Password"}
				</button>
			</form>

			<hr className="border-gray-200 dark:border-gray-700" />

			{/* Rotate Recovery Key */}
			{newMnemonic ? (
				<div className="space-y-4">
					<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
						New Recovery Phrase
					</h4>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Your old recovery phrase is no longer valid. Write down this new phrase and store it
						safely.
					</p>

					<div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
						<p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-3">
							Recovery Phrase
						</p>
						<div className="grid grid-cols-4 gap-2">
							{newMnemonic.split(/\s+/).map((word, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: order-dependent list
								<div key={i} className="flex items-center gap-1.5">
									<span className="text-xs text-amber-500 dark:text-amber-600 w-5 text-right flex-shrink-0">
										{i + 1}.
									</span>
									<span className="text-sm font-mono text-gray-800 dark:text-gray-200">{word}</span>
								</div>
							))}
						</div>
					</div>

					<label className="flex items-start gap-3 cursor-pointer">
						<input
							type="checkbox"
							checked={rotateAcknowledged}
							onChange={(e) => setRotateAcknowledged(e.target.checked)}
							className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
						/>
						<span className="text-sm text-gray-600 dark:text-gray-400">
							I've written down my new recovery phrase and stored it safely.
						</span>
					</label>

					<button
						type="button"
						disabled={!rotateAcknowledged}
						onClick={handleRotateDone}
						className="px-4 py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
					>
						Done
					</button>
				</div>
			) : (
				<form onSubmit={handleRotateRecoveryKey} className="space-y-4">
					<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
						Rotate Recovery Key
					</h4>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Generate a new 24-word recovery phrase. Your old phrase will stop working.
					</p>

					{rotateError && (
						<div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
							{rotateError}
						</div>
					)}

					<FormField
						label="Current Password"
						value={rotatePassword}
						onChange={setRotatePassword}
						type="password"
						placeholder="Confirm your encryption password"
						required
					/>

					<button
						type="submit"
						disabled={rotateLoading}
						className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
					>
						{rotateLoading ? "Generating…" : "Rotate Recovery Key"}
					</button>
				</form>
			)}
		</div>
	);
}
