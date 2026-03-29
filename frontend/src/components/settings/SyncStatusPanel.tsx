import type { SyncStatus } from "../../api";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { formatRelative } from "./FormField";

export function SyncStatusPanel({ identityId }: { identityId: number }) {
	const { data: syncStatus, loading } = useAsync(
		() => api.identities.syncStatus(identityId),
		[identityId],
	);

	if (loading) {
		return (
			<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
				Loading sync status...
			</div>
		);
	}

	return (
		<div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
			<table className="w-full text-xs">
				<thead>
					<tr className="text-left text-gray-500 dark:text-gray-400">
						<th className="pb-1 font-medium">Folder</th>
						<th className="pb-1 font-medium text-right">Messages</th>
						<th className="pb-1 font-medium text-right">Unread</th>
						<th className="pb-1 font-medium text-right">Last Synced</th>
					</tr>
				</thead>
				<tbody>
					{(syncStatus ?? []).map((f: SyncStatus) => (
						<tr
							key={f.id}
							className="text-gray-700 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800"
						>
							<td className="py-1 truncate max-w-[180px]" title={f.path}>
								{f.name}
							</td>
							<td className="py-1 text-right">{f.message_count}</td>
							<td className="py-1 text-right">{f.unread_count}</td>
							<td className="py-1 text-right text-gray-400">
								{f.last_synced_at ? formatRelative(f.last_synced_at) : "Never"}
							</td>
						</tr>
					))}
					{(syncStatus ?? []).length === 0 && (
						<tr>
							<td colSpan={4} className="py-2 text-center text-gray-400">
								No folders synced yet
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
