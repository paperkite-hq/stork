import { useEffect, useState } from "react";
import { type TrustedSender, api } from "../../api";
import { ConfirmDialog } from "../ConfirmDialog";
import { toast } from "../Toast";

export function TrustedSendersPanel({
	onClose,
}: {
	onClose: () => void;
}) {
	const [senders, setSenders] = useState<TrustedSender[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleteConfirm, setDeleteConfirm] = useState<TrustedSender | null>(null);

	useEffect(() => {
		setLoading(true);
		api.trustedSenders
			.list()
			.then(setSenders)
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const handleRemove = (sender: TrustedSender) => {
		api.trustedSenders
			.remove(sender.sender_address)
			.then(() => {
				setSenders((prev) => prev.filter((s) => s.id !== sender.id));
				toast(`Removed ${sender.sender_address} from trusted senders`, "success");
			})
			.catch(() => {
				toast("Failed to remove trusted sender", "error");
			});
		setDeleteConfirm(null);
	};

	return (
		<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
			<div className="flex items-center justify-between mb-2">
				<h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
					Trusted Senders
				</h4>
				<button
					type="button"
					onClick={onClose}
					className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					aria-label="Close trusted senders"
				>
					Close
				</button>
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
				Remote images from these senders are always loaded. Tracking pixels are still blocked.
			</p>
			{loading ? (
				<p className="text-xs text-gray-400 py-2">Loading…</p>
			) : senders.length === 0 ? (
				<p className="text-xs text-gray-400 py-2 text-center">
					No trusted senders yet. Use "Always show from this sender" when viewing a message.
				</p>
			) : (
				<ul className="space-y-1">
					{senders.map((sender) => (
						<li
							key={sender.id}
							className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
						>
							<span className="text-xs text-gray-700 dark:text-gray-300">
								{sender.sender_address}
							</span>
							<button
								type="button"
								onClick={() => setDeleteConfirm(sender)}
								className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
								aria-label={`Remove ${sender.sender_address} from trusted senders`}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
			{deleteConfirm && (
				<ConfirmDialog
					title="Remove trusted sender"
					message={`Remote images from "${deleteConfirm.sender_address}" will be hidden again. You can re-trust them from the message view.`}
					confirmLabel="Remove"
					variant="danger"
					onConfirm={() => handleRemove(deleteConfirm)}
					onCancel={() => setDeleteConfirm(null)}
				/>
			)}
		</div>
	);
}
