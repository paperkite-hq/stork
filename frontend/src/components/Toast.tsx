import { useCallback, useEffect, useState } from "react";

export interface ToastMessage {
	id: number;
	text: string;
	type: "success" | "error" | "info";
}

let nextId = 0;
const listeners = new Set<(msg: ToastMessage) => void>();
// Track recent toasts to deduplicate rapid identical messages
const recentToasts: { text: string; type: string; time: number }[] = [];
const DEDUP_WINDOW_MS = 2000;

/** Reset dedup state — exposed for testing only */
export function _resetToastDedup() {
	recentToasts.length = 0;
}

export function toast(text: string, type: ToastMessage["type"] = "success") {
	const now = Date.now();
	// Prune expired entries
	while (
		recentToasts.length > 0 &&
		recentToasts[0] &&
		now - recentToasts[0].time > DEDUP_WINDOW_MS
	) {
		recentToasts.shift();
	}
	// Skip if an identical toast was shown recently
	if (recentToasts.some((t) => t.text === text && t.type === type)) return;
	recentToasts.push({ text, type, time: now });

	const msg: ToastMessage = { id: nextId++, text, type };
	for (const fn of listeners) fn(msg);
}

export function ToastContainer() {
	const [toasts, setToasts] = useState<ToastMessage[]>([]);

	useEffect(() => {
		const handler = (msg: ToastMessage) => {
			setToasts((prev) => [...prev, msg]);
		};
		listeners.add(handler);
		return () => {
			listeners.delete(handler);
		};
	}, []);

	const dismiss = useCallback((id: number) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	return (
		<div
			className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
			role="status"
			aria-live="polite"
			aria-atomic="false"
		>
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} onDismiss={dismiss} />
			))}
		</div>
	);
}

function ToastItem({
	toast: t,
	onDismiss,
}: { toast: ToastMessage; onDismiss: (id: number) => void }) {
	useEffect(() => {
		const timer = setTimeout(() => onDismiss(t.id), 3000);
		return () => clearTimeout(timer);
	}, [t.id, onDismiss]);

	const bg =
		t.type === "error"
			? "bg-red-600 dark:bg-red-700"
			: t.type === "info"
				? "bg-gray-700 dark:bg-gray-600"
				: "bg-stork-600 dark:bg-stork-700";

	return (
		<button
			type="button"
			onClick={() => onDismiss(t.id)}
			className={`${bg} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg pointer-events-auto animate-slideUp max-w-xs cursor-pointer text-left`}
		>
			{t.text}
		</button>
	);
}
