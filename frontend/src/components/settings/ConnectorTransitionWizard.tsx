import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFocusTrap } from "../../hooks";

type WizardStep = "explain" | "clean" | "confirm";

interface ConnectorTransitionWizardProps {
	connectorId: number;
	connectorName: string;
	onConfirm: (cleanServer: boolean) => void;
	onCancel: () => void;
}

export function ConnectorTransitionWizard({
	connectorId,
	connectorName,
	onConfirm,
	onCancel,
}: ConnectorTransitionWizardProps) {
	const [step, setStep] = useState<WizardStep>("explain");
	const [syncedCount, setSyncedCount] = useState<number | null>(null);
	const [cleanServer, setCleanServer] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);

	useEffect(() => {
		api.connectors.inbound.syncedCount(connectorId).then(
			(r) => setSyncedCount(r.count),
			() => setSyncedCount(0),
		);
	}, [connectorId]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		},
		[onCancel],
	);

	const steps: WizardStep[] =
		syncedCount && syncedCount > 0 ? ["explain", "clean", "confirm"] : ["explain", "confirm"];
	const currentIndex = steps.indexOf(step);

	function nextStep() {
		const next = steps[currentIndex + 1];
		if (next) setStep(next);
	}

	function prevStep() {
		const prev = steps[currentIndex - 1];
		if (prev) {
			setStep(prev);
		} else {
			onCancel();
		}
	}

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onKeyDown={handleKeyDown}
		>
			<div
				className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6"
				aria-labelledby="wizard-title"
			>
				{/* Step indicator */}
				<div className="flex items-center gap-2 mb-4">
					{steps.map((s, i) => (
						<div key={s} className="flex items-center gap-2">
							{i > 0 && (
								<div
									className={`h-px w-6 ${i <= currentIndex ? "bg-stork-500" : "bg-gray-300 dark:bg-gray-600"}`}
								/>
							)}
							<div
								className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
									i < currentIndex
										? "bg-stork-600 text-white"
										: i === currentIndex
											? "bg-stork-600 text-white ring-2 ring-stork-300"
											: "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
								}`}
							>
								{i < currentIndex ? "\u2713" : i + 1}
							</div>
						</div>
					))}
				</div>

				{/* Step content */}
				{step === "explain" && <StepExplain />}
				{step === "clean" && (
					<StepClean
						syncedCount={syncedCount ?? 0}
						cleanServer={cleanServer}
						onToggle={setCleanServer}
					/>
				)}
				{step === "confirm" && (
					<StepConfirm
						cleanServer={cleanServer}
						connectorName={connectorName}
						syncedCount={syncedCount ?? 0}
					/>
				)}

				{/* Navigation */}
				<div className="flex items-center justify-between mt-5 pt-3 border-t border-gray-200 dark:border-gray-700">
					<button
						type="button"
						onClick={prevStep}
						className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
					>
						{currentIndex === 0 ? "Cancel" : "Back"}
					</button>
					{step === "confirm" ? (
						<button
							type="button"
							onClick={() => onConfirm(cleanServer)}
							className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors bg-stork-600 hover:bg-stork-700 text-white"
						>
							Enable Connector Mode
						</button>
					) : (
						<button
							type="button"
							onClick={nextStep}
							className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors bg-stork-600 hover:bg-stork-700 text-white"
						>
							Next
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function StepExplain() {
	return (
		<div className="space-y-3">
			<h3 id="wizard-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
				Switch to Connector Mode
			</h3>
			<div className="rounded-lg border-2 border-stork-300 dark:border-stork-700 bg-stork-50 dark:bg-stork-950 px-4 py-3 space-y-2">
				<p className="text-sm font-bold text-stork-800 dark:text-stork-200">What changes?</p>
				<ul className="text-xs text-stork-700 dark:text-stork-300 space-y-1.5 list-disc pl-4">
					<li>
						<strong>New mail</strong> is downloaded, encrypted, and then{" "}
						<strong>deleted from your mail server</strong>. Stork becomes the single source of
						truth.
					</li>
					<li>
						<strong>Already-synced mail</strong> stays on your server unless you choose to clean it
						up (next step).
					</li>
					<li>
						<strong>Your provider becomes a delivery pipe</strong> — mail arrives, Stork grabs it,
						your server empties out over time.
					</li>
				</ul>
			</div>
			<p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
				Make sure you have Stork database backups configured before proceeding. Once messages are
				deleted from your server, Stork is the only copy.
			</p>
		</div>
	);
}

function StepClean({
	syncedCount,
	cleanServer,
	onToggle,
}: {
	syncedCount: number;
	cleanServer: boolean;
	onToggle: (v: boolean) => void;
}) {
	return (
		<div className="space-y-3">
			<h3 id="wizard-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
				Clean Your Server?
			</h3>
			<p className="text-sm text-gray-600 dark:text-gray-400">
				You have{" "}
				<strong className="text-gray-900 dark:text-gray-100">{syncedCount.toLocaleString()}</strong>{" "}
				message{syncedCount !== 1 ? "s" : ""} already synced that {syncedCount !== 1 ? "are" : "is"}{" "}
				still on your mail server.
			</p>
			<div className="space-y-2">
				<label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border px-3 py-2.5 transition-colors border-gray-200 dark:border-gray-700 hover:border-stork-300 dark:hover:border-stork-600">
					<input
						type="radio"
						name="clean-choice"
						checked={!cleanServer}
						onChange={() => onToggle(false)}
						className="mt-0.5 shrink-0"
					/>
					<span className="text-gray-700 dark:text-gray-300">
						<span className="font-medium">Keep them on the server</span>
						<span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Your existing mail stays as a safety net. Only new mail going forward will be deleted
							after sync.
						</span>
					</span>
				</label>
				<label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border px-3 py-2.5 transition-colors border-gray-200 dark:border-gray-700 hover:border-stork-300 dark:hover:border-stork-600">
					<input
						type="radio"
						name="clean-choice"
						checked={cleanServer}
						onChange={() => onToggle(true)}
						className="mt-0.5 shrink-0"
					/>
					<span className="text-gray-700 dark:text-gray-300">
						<span className="font-medium">Remove them from the server</span>
						<span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
							Stork already has encrypted copies. Bulk-delete the originals from your IMAP server.
							This cannot be undone.
						</span>
					</span>
				</label>
			</div>
		</div>
	);
}

function StepConfirm({
	cleanServer,
	connectorName,
	syncedCount,
}: {
	cleanServer: boolean;
	connectorName: string;
	syncedCount: number;
}) {
	return (
		<div className="space-y-3">
			<h3 id="wizard-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
				Confirm Transition
			</h3>
			<div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 space-y-2 text-sm">
				<div className="flex justify-between text-gray-700 dark:text-gray-300">
					<span>Connector</span>
					<span className="font-medium">{connectorName}</span>
				</div>
				<div className="flex justify-between text-gray-700 dark:text-gray-300">
					<span>Mode</span>
					<span className="font-medium text-stork-700 dark:text-stork-300">Mirror → Connector</span>
				</div>
				<div className="flex justify-between text-gray-700 dark:text-gray-300">
					<span>New mail</span>
					<span className="font-medium">Delete from server after sync</span>
				</div>
				{syncedCount > 0 && (
					<div className="flex justify-between text-gray-700 dark:text-gray-300">
						<span>
							Existing {syncedCount.toLocaleString()} message{syncedCount !== 1 ? "s" : ""}
						</span>
						<span className={`font-medium ${cleanServer ? "text-red-600 dark:text-red-400" : ""}`}>
							{cleanServer ? "Remove from server" : "Keep on server"}
						</span>
					</div>
				)}
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400">
				You can switch back to mirror mode at any time from connector settings. Messages already
				deleted from the server cannot be restored there, but they remain safe in Stork.
			</p>
		</div>
	);
}
