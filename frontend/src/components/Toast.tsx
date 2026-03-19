import { useCallback, useEffect, useState } from "react";

export interface ToastMessage {
	id: number;
	text: string;
	type: "success" | "error" | "info";
}

let nextId = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

export function toast(text: string, type: ToastMessage["type"] = "success") {
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
		<div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
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
		<div
			className={`${bg} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg pointer-events-auto animate-slideUp max-w-xs`}
		>
			{t.text}
		</div>
	);
}
