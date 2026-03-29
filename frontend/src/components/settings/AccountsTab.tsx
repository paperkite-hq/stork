import { useState } from "react";
import { api } from "../../api";
import { ConfirmDialog } from "../ConfirmDialog";
import { toast } from "../Toast";
import { AccountForm } from "./AccountForm";
import { TrustedSendersPanel } from "./TrustedSendersPanel";

export function AccountsTab({
	identities,
	editingIdentityId,
	onEdit,
	onRefetch,
}: {
	identities: { id: number; name: string; email: string }[];
	editingIdentityId: number | "new" | null;
	onEdit: (id: number | "new" | null) => void;
	onRefetch: () => void;
}) {
	const [deleteTarget, setDeleteTarget] = useState<{
		id: number;
		name: string;
		email: string;
	} | null>(null);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Email Identities</h3>
				<button
					type="button"
					onClick={() => onEdit("new")}
					className="px-3 py-1.5 bg-stork-600 hover:bg-stork-700 text-white rounded-md text-sm font-medium transition-colors"
				>
					+ Add Email Identity
				</button>
			</div>

			{/* Identity list */}
			{identities.length === 0 && editingIdentityId !== "new" && (
				<p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
					No email identities configured. Add one to get started.
				</p>
			)}

			{identities.map((identity) => (
				<div key={identity.id}>
					{editingIdentityId === identity.id ? (
						<AccountForm
							identityId={identity.id}
							onCancel={() => onEdit(null)}
							onSaved={() => {
								onEdit(null);
								onRefetch();
							}}
						/>
					) : (
						<IdentityCard
							identity={identity}
							onEdit={() => onEdit(identity.id)}
							onDelete={() => setDeleteTarget(identity)}
						/>
					)}
				</div>
			))}

			{editingIdentityId === "new" && (
				<AccountForm
					identityId={null}
					onCancel={() => onEdit(null)}
					onSaved={() => {
						onEdit(null);
						onRefetch();
					}}
				/>
			)}

			{deleteTarget && (
				<ConfirmDialog
					title="Delete email identity"
					message={`Delete "${deleteTarget.name}" (${deleteTarget.email})? This removes all synced messages and cannot be undone.`}
					confirmLabel="Delete"
					variant="danger"
					onConfirm={() => {
						api.identities
							.delete(deleteTarget.id)
							.then(() => {
								toast("Email identity deleted", "success");
								onRefetch();
							})
							.catch(() => {
								toast("Failed to delete email identity", "error");
							});
						setDeleteTarget(null);
					}}
					onCancel={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
}

function IdentityCard({
	identity,
	onEdit,
	onDelete,
}: {
	identity: { id: number; name: string; email: string };
	onEdit: () => void;
	onDelete: () => void;
}) {
	const [showTrustedSenders, setShowTrustedSenders] = useState(false);

	return (
		<div className="border border-gray-200 dark:border-gray-700 rounded-lg">
			<div className="flex items-center justify-between px-4 py-3">
				<div>
					<p className="text-sm font-medium text-gray-900 dark:text-gray-100">{identity.name}</p>
					<p className="text-xs text-gray-500 dark:text-gray-400">{identity.email}</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowTrustedSenders((v) => !v)}
						className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
						title="Manage senders whose remote images are always loaded"
					>
						Trusted Senders
					</button>
					<button
						type="button"
						onClick={onEdit}
						className="text-xs text-stork-600 hover:text-stork-700 dark:text-stork-400 dark:hover:text-stork-300 px-2 py-1 rounded transition-colors"
					>
						Edit
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded transition-colors"
					>
						Delete
					</button>
				</div>
			</div>
			{showTrustedSenders && <TrustedSendersPanel onClose={() => setShowTrustedSenders(false)} />}
		</div>
	);
}
