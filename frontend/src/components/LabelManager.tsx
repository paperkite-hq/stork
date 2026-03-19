import { useCallback, useEffect, useRef, useState } from "react";
import { type Label, type LabelSummary, api } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { XIcon } from "./Icons";
import { toast } from "./Toast";

const PRESET_COLORS = [
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#06b6d4", // cyan
	"#3b82f6", // blue
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#6b7280", // gray
];

interface ColorPickerProps {
	value: string | null;
	onChange: (color: string | null) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
	return (
		<div className="flex items-center gap-1.5">
			{PRESET_COLORS.map((c) => (
				<button
					key={c}
					type="button"
					onClick={() => onChange(value === c ? null : c)}
					className={`w-5 h-5 rounded-full border-2 transition-all ${
						value === c ? "border-gray-800 dark:border-white scale-110" : "border-transparent"
					}`}
					style={{ backgroundColor: c }}
					title={c}
				/>
			))}
		</div>
	);
}

interface CreateLabelFormProps {
	accountId: number;
	onCreated: () => void;
	onClose: () => void;
}

function CreateLabelForm({ accountId, onCreated, onClose }: CreateLabelFormProps) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!name.trim()) return;
			setSaving(true);
			try {
				await api.labels.create(accountId, { name: name.trim(), color: color ?? undefined });
				toast(`Label "${name.trim()}" created`);
				onCreated();
				onClose();
			} catch (err) {
				toast(err instanceof Error ? err.message : "Failed to create label", "error");
			} finally {
				setSaving(false);
			}
		},
		[accountId, name, color, onCreated, onClose],
	);

	return (
		<form onSubmit={handleSubmit} className="p-3 space-y-2">
			<div className="flex items-center gap-2">
				<input
					ref={inputRef}
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Label name"
					className="flex-1 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 outline-none focus:border-stork-500"
				/>
				<button
					type="button"
					onClick={onClose}
					className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					title="Cancel"
				>
					<XIcon className="w-3.5 h-3.5" />
				</button>
			</div>
			<ColorPicker value={color} onChange={setColor} />
			<button
				type="submit"
				disabled={!name.trim() || saving}
				className="w-full text-xs py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded font-medium transition-colors"
			>
				{saving ? "Creating…" : "Create label"}
			</button>
		</form>
	);
}

interface EditLabelFormProps {
	label: Label;
	onUpdated: () => void;
	onClose: () => void;
}

function EditLabelForm({ label, onUpdated, onClose }: EditLabelFormProps) {
	const [name, setName] = useState(label.name);
	const [color, setColor] = useState<string | null>(label.color);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!name.trim()) return;
			setSaving(true);
			try {
				await api.labels.update(label.id, {
					name: name.trim(),
					color: color ?? undefined,
				});
				toast("Label updated");
				onUpdated();
				onClose();
			} catch (err) {
				toast(err instanceof Error ? err.message : "Failed to update label", "error");
			} finally {
				setSaving(false);
			}
		},
		[label.id, name, color, onUpdated, onClose],
	);

	return (
		<form onSubmit={handleSubmit} className="p-3 space-y-2">
			<div className="flex items-center gap-2">
				<input
					ref={inputRef}
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Label name"
					className="flex-1 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 outline-none focus:border-stork-500"
				/>
				<button
					type="button"
					onClick={onClose}
					className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					title="Cancel"
				>
					<XIcon className="w-3.5 h-3.5" />
				</button>
			</div>
			<ColorPicker value={color} onChange={setColor} />
			<button
				type="submit"
				disabled={!name.trim() || saving}
				className="w-full text-xs py-1.5 bg-stork-600 hover:bg-stork-700 disabled:opacity-50 text-white rounded font-medium transition-colors"
			>
				{saving ? "Saving…" : "Save"}
			</button>
		</form>
	);
}

interface LabelContextMenuProps {
	label: Label;
	position: { x: number; y: number };
	onEdit: () => void;
	onDelete: () => void;
	onClose: () => void;
}

export function LabelContextMenu({ position, onEdit, onDelete, onClose }: LabelContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			className="fixed z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[140px]"
			style={{ top: position.y, left: position.x }}
		>
			<button
				type="button"
				onClick={onEdit}
				className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
			>
				Edit label
			</button>
			<button
				type="button"
				onClick={onDelete}
				className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
			>
				Delete label
			</button>
		</div>
	);
}

interface LabelManagerProps {
	accountId: number;
	onLabelsChanged: () => void;
	contextMenu: { label: Label; position: { x: number; y: number } } | null;
	onContextMenuClose: () => void;
}

export function LabelManager({
	accountId,
	onLabelsChanged,
	contextMenu,
	onContextMenuClose,
}: LabelManagerProps) {
	const [showCreate, setShowCreate] = useState(false);
	const [editLabel, setEditLabel] = useState<Label | null>(null);
	const [deleteLabel, setDeleteLabel] = useState<Label | null>(null);

	const handleDeleteConfirmed = useCallback(
		async (label: Label) => {
			try {
				await api.labels.delete(label.id);
				toast(`Label "${label.name}" deleted`, "info");
				onLabelsChanged();
			} catch {
				toast("Failed to delete label", "error");
			}
			setDeleteLabel(null);
		},
		[onLabelsChanged],
	);

	return (
		<>
			{/* Create label section */}
			{showCreate ? (
				<div className="mt-1 border-t border-gray-200 dark:border-gray-800">
					<CreateLabelForm
						accountId={accountId}
						onCreated={onLabelsChanged}
						onClose={() => setShowCreate(false)}
					/>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="w-full text-left px-5 py-1.5 mt-1 text-xs text-gray-400 hover:text-stork-600 dark:hover:text-stork-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
				>
					+ Create label
				</button>
			)}

			{/* Edit label modal */}
			{editLabel && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
					<div
						className="w-72 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700"
						role="dialog"
						aria-modal="true"
						aria-label="Edit label"
					>
						<EditLabelForm
							label={editLabel}
							onUpdated={onLabelsChanged}
							onClose={() => setEditLabel(null)}
						/>
					</div>
				</div>
			)}

			{/* Context menu */}
			{contextMenu && (
				<LabelContextMenu
					label={contextMenu.label}
					position={contextMenu.position}
					onEdit={() => {
						setEditLabel(contextMenu.label);
						onContextMenuClose();
					}}
					onDelete={() => {
						setDeleteLabel(contextMenu.label);
						onContextMenuClose();
					}}
					onClose={onContextMenuClose}
				/>
			)}

			{/* Delete confirmation */}
			{deleteLabel && (
				<ConfirmDialog
					title="Delete label"
					message={`Delete "${deleteLabel.name}"? Messages with this label won't be deleted, but they'll lose this label.`}
					confirmLabel="Delete"
					variant="danger"
					onConfirm={() => handleDeleteConfirmed(deleteLabel)}
					onCancel={() => setDeleteLabel(null)}
				/>
			)}
		</>
	);
}

/**
 * Label picker for assigning/removing labels on a message.
 * Used in MessageDetail.
 */
interface MessageLabelPickerProps {
	messageId: number;
	accountId: number | null;
	onLabelsChanged?: () => void;
}

export function MessageLabelPicker({
	messageId,
	accountId,
	onLabelsChanged,
}: MessageLabelPickerProps) {
	const [open, setOpen] = useState(false);
	const [allLabels, setAllLabels] = useState<Label[]>([]);
	const [messageLabels, setMessageLabels] = useState<LabelSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const loadLabels = useCallback(async () => {
		if (!accountId) return;
		setLoading(true);
		try {
			const [all, current] = await Promise.all([
				api.labels.list(accountId),
				api.messages.labels(messageId),
			]);
			setAllLabels(all);
			setMessageLabels(current);
		} catch {
			toast("Failed to load labels", "error");
		} finally {
			setLoading(false);
		}
	}, [accountId, messageId]);

	const handleOpen = useCallback(() => {
		setOpen(true);
		loadLabels();
	}, [loadLabels]);

	const handleToggle = useCallback(
		async (labelId: number) => {
			const isAssigned = messageLabels.some((l) => l.id === labelId);
			try {
				if (isAssigned) {
					await api.messages.removeLabel(messageId, labelId);
					setMessageLabels((prev) => prev.filter((l) => l.id !== labelId));
				} else {
					await api.messages.addLabels(messageId, [labelId]);
					const label = allLabels.find((l) => l.id === labelId);
					if (label) {
						setMessageLabels((prev) => [
							...prev,
							{ id: label.id, name: label.name, color: label.color, source: label.source },
						]);
					}
				}
				onLabelsChanged?.();
			} catch {
				toast("Failed to update label", "error");
			}
		},
		[messageId, messageLabels, allLabels, onLabelsChanged],
	);

	return (
		<div className="relative" ref={menuRef}>
			<button
				type="button"
				onClick={handleOpen}
				className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
				title="Manage labels"
			>
				<svg
					className="w-4 h-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Labels</title>
					<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
					<line x1="7" y1="7" x2="7.01" y2="7" />
				</svg>
			</button>
			{open && (
				<div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 z-10 max-h-64 overflow-y-auto">
					<p className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide">
						Labels
					</p>
					{loading && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
					{!loading && allLabels.length === 0 && (
						<p className="px-3 py-2 text-xs text-gray-400">No labels available</p>
					)}
					{!loading &&
						allLabels.map((label) => {
							const isAssigned = messageLabels.some((l) => l.id === label.id);
							return (
								<button
									key={label.id}
									type="button"
									onClick={() => handleToggle(label.id)}
									className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
								>
									<span
										className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
											isAssigned
												? "bg-stork-600 border-stork-600 text-white"
												: "border-gray-300 dark:border-gray-600"
										}`}
									>
										{isAssigned && "✓"}
									</span>
									{label.color && (
										<span
											className="w-2.5 h-2.5 rounded-full flex-shrink-0"
											style={{ backgroundColor: label.color }}
										/>
									)}
									<span className="truncate text-gray-700 dark:text-gray-300">{label.name}</span>
								</button>
							);
						})}
				</div>
			)}
		</div>
	);
}
