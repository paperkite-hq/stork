import { useCallback, useEffect, useRef } from "react";

interface ConfirmDialogProps {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: "danger" | "default";
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	variant = "default",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		},
		[onCancel],
	);

	const confirmClass =
		variant === "danger"
			? "bg-red-600 hover:bg-red-700 text-white"
			: "bg-stork-600 hover:bg-stork-700 text-white";

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onKeyDown={handleKeyDown}
		>
			<div
				className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6"
				aria-labelledby="confirm-title"
			>
				<h3
					id="confirm-title"
					className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2"
				>
					{title}
				</h3>
				<p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{message}</p>
				<div className="flex items-center justify-end gap-2">
					<button
						ref={cancelRef}
						type="button"
						onClick={onCancel}
						className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${confirmClass}`}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
