import { useState } from "react";
import { api } from "../../api";
import { ConfirmDialog } from "../ConfirmDialog";
import { toast } from "../Toast";
import { AccountForm } from "./AccountForm";
import { SyncStatusPanel } from "./SyncStatusPanel";
import { TrustedSendersPanel } from "./TrustedSendersPanel";

export function AccountsTab({
	accounts,
	editingAccountId,
	onEdit,
	onRefetch,
	syncStatusAccountId,
	onShowSync,
}: {
	accounts: { id: number; name: string; email: string; imap_host: string }[];
	editingAccountId: number | "new" | null;
	onEdit: (id: number | "new" | null) => void;
	onRefetch: () => void;
	syncStatusAccountId: number | null;
	onShowSync: (id: number | null) => void;
}) {
	const [deleteTarget, setDeleteTarget] = useState<{
		id: number;
		name: string;
		email: string;
	} | null>(null);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Email Accounts</h3>
				<button
					type="button"
					onClick={() => onEdit("new")}
					className="px-3 py-1.5 bg-stork-600 hover:bg-stork-700 text-white rounded-md text-sm font-medium transition-colors"
				>
					+ Add Account
				</button>
			</div>

			{/* Account list */}
			{accounts.length === 0 && editingAccountId !== "new" && (
				<p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
					No accounts configured. Add one to get started.
				</p>
			)}

			{accounts.map((account) => (
				<div key={account.id}>
					{editingAccountId === account.id ? (
						<AccountForm
							accountId={account.id}
							onCancel={() => onEdit(null)}
							onSaved={() => {
								onEdit(null);
								onRefetch();
							}}
						/>
					) : (
						<AccountCard
							account={account}
							onEdit={() => onEdit(account.id)}
							onDelete={() => setDeleteTarget(account)}
							showSync={syncStatusAccountId === account.id}
							onToggleSync={() =>
								onShowSync(syncStatusAccountId === account.id ? null : account.id)
							}
						/>
					)}
				</div>
			))}

			{editingAccountId === "new" && (
				<AccountForm
					accountId={null}
					onCancel={() => onEdit(null)}
					onSaved={() => {
						onEdit(null);
						onRefetch();
					}}
				/>
			)}

			{deleteTarget && (
				<ConfirmDialog
					title="Delete account"
					message={`Delete "${deleteTarget.name}" (${deleteTarget.email})? This removes all synced messages and cannot be undone.`}
					confirmLabel="Delete Account"
					variant="danger"
					onConfirm={() => {
						api.accounts
							.delete(deleteTarget.id)
							.then(() => {
								toast("Account deleted", "success");
								onRefetch();
							})
							.catch(() => {
								toast("Failed to delete account", "error");
							});
						setDeleteTarget(null);
					}}
					onCancel={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
}

function AccountCard({
	account,
	onEdit,
	onDelete,
	showSync,
	onToggleSync,
}: {
	account: { id: number; name: string; email: string; imap_host: string };
	onEdit: () => void;
	onDelete: () => void;
	showSync: boolean;
	onToggleSync: () => void;
}) {
	const [showTrustedSenders, setShowTrustedSenders] = useState(false);

	return (
		<div className="border border-gray-200 dark:border-gray-700 rounded-lg">
			<div className="flex items-center justify-between px-4 py-3">
				<div>
					<p className="text-sm font-medium text-gray-900 dark:text-gray-100">{account.name}</p>
					<p className="text-xs text-gray-500 dark:text-gray-400">
						{account.email} &middot; {account.imap_host}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onToggleSync}
						className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded transition-colors"
						title="View sync status"
					>
						Sync Status
					</button>
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
			{showSync && <SyncStatusPanel accountId={account.id} />}
			{showTrustedSenders && (
				<TrustedSendersPanel accountId={account.id} onClose={() => setShowTrustedSenders(false)} />
			)}
		</div>
	);
}
