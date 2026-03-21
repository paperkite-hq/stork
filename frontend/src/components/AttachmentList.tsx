import type { Attachment } from "../api";
import { api } from "../api";
import { formatFileSize } from "../email-sanitizer";
import { useAsync } from "../hooks";
import { PaperclipIcon } from "./Icons";

export function AttachmentList({ messageId }: { messageId: number }) {
	const { data: attachments, loading } = useAsync(
		() => api.messages.attachments(messageId),
		[messageId],
	);

	if (loading || !attachments || attachments.length === 0) return null;

	return (
		<div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
			<p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
				<PaperclipIcon className="w-3.5 h-3.5" />
				{attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
			</p>
			<div className="flex flex-wrap gap-2">
				{attachments.map((att: Attachment) => (
					<a
						key={att.id}
						href={`/api/attachments/${att.id}`}
						download={att.filename ?? "attachment"}
						className="flex items-center gap-2 px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-md transition-colors"
					>
						<span className="truncate max-w-[200px]">{att.filename ?? "attachment"}</span>
						{att.size != null && att.size > 0 && (
							<span className="text-gray-400 flex-shrink-0">{formatFileSize(att.size)}</span>
						)}
					</a>
				))}
			</div>
		</div>
	);
}
