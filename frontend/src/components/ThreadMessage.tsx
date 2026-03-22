import type { Message } from "../api";
import { formatFullDate, hasRemoteImages, sanitizeEmailHtml } from "../email-sanitizer";
import { formatAddressList } from "../utils";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	ForwardIcon,
	ImageIcon,
	ReplyAllIcon,
	ReplyIcon,
} from "./Icons";

import { AttachmentList } from "./AttachmentList";
import { SandboxedEmail } from "./SandboxedEmail";

interface ThreadMessageProps {
	msg: Message;
	isThread: boolean;
	isLast: boolean;
	expanded: boolean;
	showHtml: boolean;
	imagesAllowed: boolean;
	onToggleExpanded: (id: number) => void;
	onToggleShowHtml: () => void;
	onAllowImages: (id: number) => void;
	onReply: (msg: Message) => void;
	onReplyAll: (msg: Message) => void;
	onForward: (msg: Message) => void;
}

/** Renders a single message within a thread or standalone view.
 *  Handles the collapsible header, HTML/plain text body toggle,
 *  remote image blocking banner, attachments, and reply/forward actions. */
export function ThreadMessage({
	msg,
	isThread,
	isLast,
	expanded,
	showHtml,
	imagesAllowed,
	onToggleExpanded,
	onToggleShowHtml,
	onAllowImages,
	onReply,
	onReplyAll,
	onForward,
}: ThreadMessageProps) {
	return (
		<div className="border-b border-gray-100 dark:border-gray-800">
			{/* Message header — clickable to expand/collapse in threads */}
			<button
				type="button"
				onClick={() => (!isLast ? onToggleExpanded(msg.id) : undefined)}
				aria-expanded={isThread && !isLast ? expanded : undefined}
				aria-label={
					isThread && !isLast
						? `${expanded ? "Collapse" : "Expand"} message from ${msg.from_name || msg.from_address}`
						: undefined
				}
				className={`w-full text-left px-6 py-3 ${
					isThread && !isLast ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900" : ""
				}`}
			>
				<div className="flex items-center gap-3">
					{/* Thread expand/collapse chevron */}
					{isThread && !isLast && (
						<div className="flex-shrink-0 text-gray-400">
							{expanded ? (
								<ChevronDownIcon className="w-3.5 h-3.5" />
							) : (
								<ChevronRightIcon className="w-3.5 h-3.5" />
							)}
						</div>
					)}
					{/* Avatar */}
					<div className="w-8 h-8 rounded-full bg-stork-100 dark:bg-stork-900 flex items-center justify-center text-sm font-medium text-stork-700 dark:text-stork-300 flex-shrink-0">
						{(msg.from_name || msg.from_address || "?")[0]?.toUpperCase()}
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-baseline gap-2">
							<span className="font-medium text-sm">{msg.from_name || msg.from_address}</span>
							<span className="text-xs text-gray-400 truncate">&lt;{msg.from_address}&gt;</span>
						</div>
						{expanded && (
							<div className="text-xs text-gray-500 mt-0.5">
								To: {formatAddressList(msg.to_addresses)}
								{msg.cc_addresses && <span> · CC: {formatAddressList(msg.cc_addresses)}</span>}
							</div>
						)}
					</div>
					<div className="text-xs text-gray-400 flex-shrink-0">
						{expanded ? formatFullDate(msg.date) : new Date(msg.date).toLocaleDateString()}
					</div>
				</div>
			</button>

			{/* Message body */}
			{expanded && (
				<div className="px-6 pb-4">
					{/* Toggle HTML/Plain text */}
					{msg.html_body && msg.text_body && (
						<div className="mb-2">
							<button
								type="button"
								onClick={onToggleShowHtml}
								className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
							>
								{showHtml ? "Show plain text" : "Show formatted"}
							</button>
						</div>
					)}

					{/* Remote images banner */}
					{showHtml && msg.html_body && !imagesAllowed && hasRemoteImages(msg.html_body) && (
						<div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-sm text-amber-700 dark:text-amber-400">
							<ImageIcon className="w-4 h-4 flex-shrink-0" />
							<span>Images are hidden to protect your privacy.</span>
							<button
								type="button"
								onClick={() => onAllowImages(msg.id)}
								className="ml-auto text-xs font-medium text-amber-600 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 whitespace-nowrap"
							>
								Show images
							</button>
						</div>
					)}

					{showHtml && msg.html_body ? (
						<SandboxedEmail
							html={sanitizeEmailHtml(msg.html_body, {
								blockRemoteImages: !imagesAllowed,
							})}
							className="email-content"
						/>
					) : (
						<pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans">
							{msg.text_body || "(empty message)"}
						</pre>
					)}

					{/* Attachments */}
					{msg.has_attachments > 0 && <AttachmentList messageId={msg.id} />}

					{/* Actions — available on every thread message */}
					<div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
						<button
							type="button"
							onClick={() => onReply(msg)}
							className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
						>
							<ReplyIcon className="w-3.5 h-3.5" /> Reply
						</button>
						<button
							type="button"
							onClick={() => onReplyAll(msg)}
							className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
						>
							<ReplyAllIcon className="w-3.5 h-3.5" /> Reply All
						</button>
						<button
							type="button"
							onClick={() => onForward(msg)}
							className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center gap-1.5"
						>
							<ForwardIcon className="w-3.5 h-3.5" /> Forward
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
