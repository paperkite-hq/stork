import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import type { Label, LabelSummary } from "../../api";
import { LabelManager, MessageLabelPicker } from "../LabelManager";

vi.mock("../../api", () => ({
	api: {
		labels: {
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			list: vi.fn(),
		},
		messages: {
			labels: vi.fn(),
			addLabels: vi.fn(),
			removeLabel: vi.fn(),
		},
	},
}));

function makeLabel(overrides: Partial<Label> = {}): Label {
	return {
		id: 1,
		name: "Work",
		color: "#3b82f6",
		source: "user",
		created_at: new Date().toISOString(),
		message_count: 5,
		unread_count: 2,
		...overrides,
	};
}

describe("LabelManager", () => {
	const defaultProps = {
		accountId: 1,
		onLabelsChanged: vi.fn(),
		contextMenu: null,
		onContextMenuClose: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders create label button", () => {
		render(<LabelManager {...defaultProps} />);
		expect(screen.getByText("+ Create label")).toBeInTheDocument();
	});

	it("shows create form when button is clicked", async () => {
		const user = userEvent.setup();
		render(<LabelManager {...defaultProps} />);
		await user.click(screen.getByText("+ Create label"));
		expect(screen.getByPlaceholderText("Label name")).toBeInTheDocument();
		expect(
			screen.getByText("Create label", { selector: "button[type='submit']" }),
		).toBeInTheDocument();
	});

	it("creates a label on form submit", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.create).mockResolvedValue({ id: 99 });
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		await user.type(screen.getByPlaceholderText("Label name"), "Important");
		await user.click(screen.getByText("Create label", { selector: "button[type='submit']" }));

		await waitFor(() => {
			expect(api.labels.create).toHaveBeenCalledWith(1, { name: "Important" });
		});
		expect(defaultProps.onLabelsChanged).toHaveBeenCalled();
	});

	it("creates a label with color", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.create).mockResolvedValue({ id: 99 });
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		await user.type(screen.getByPlaceholderText("Label name"), "Urgent");
		// Click the red color preset
		await user.click(screen.getByTitle("Red"));
		await user.click(screen.getByText("Create label", { selector: "button[type='submit']" }));

		await waitFor(() => {
			expect(api.labels.create).toHaveBeenCalledWith(1, { name: "Urgent", color: "#ef4444" });
		});
	});

	it("closes create form on cancel", async () => {
		const user = userEvent.setup();
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		expect(screen.getByPlaceholderText("Label name")).toBeInTheDocument();

		await user.click(screen.getByTitle("Cancel"));
		expect(screen.queryByPlaceholderText("Label name")).not.toBeInTheDocument();
	});

	it("shows context menu when provided", () => {
		const label = makeLabel();
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);
		expect(screen.getByText("Edit label")).toBeInTheDocument();
		expect(screen.getByText("Delete label")).toBeInTheDocument();
	});

	it("closes context menu on outside click", async () => {
		const label = makeLabel();
		const onContextMenuClose = vi.fn();
		render(
			<div>
				<button type="button">Outside</button>
				<LabelManager
					{...defaultProps}
					onContextMenuClose={onContextMenuClose}
					contextMenu={{ label, position: { x: 100, y: 200 } }}
				/>
			</div>,
		);
		expect(screen.getByText("Edit label")).toBeInTheDocument();
		fireEvent.mouseDown(screen.getByText("Outside"));
		expect(onContextMenuClose).toHaveBeenCalled();
	});

	it("opens edit form from context menu", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ name: "Projects" });
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Edit label"));
		expect(screen.getByDisplayValue("Projects")).toBeInTheDocument();
	});

	it("shows delete confirmation from context menu", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ name: "Old Stuff" });
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Delete label"));
		expect(screen.getByText(/Delete "Old Stuff"/)).toBeInTheDocument();
	});

	it("deletes a label after confirmation", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ id: 42, name: "Temp" });
		vi.mocked(api.labels.delete).mockResolvedValue({ ok: true });

		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Delete label"));
		await user.click(screen.getByText("Delete", { selector: "button" }));

		await waitFor(() => {
			expect(api.labels.delete).toHaveBeenCalledWith(42);
		});
		expect(defaultProps.onLabelsChanged).toHaveBeenCalled();
	});

	it("shows error toast when label creation fails", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.create).mockRejectedValue(new Error("Server error"));
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		await user.type(screen.getByPlaceholderText("Label name"), "Failing Label");
		await user.click(screen.getByText("Create label", { selector: "button[type='submit']" }));

		await waitFor(() => {
			expect(api.labels.create).toHaveBeenCalled();
		});
		// Create form should still be visible (not closed on error)
		expect(screen.getByPlaceholderText("Label name")).toBeInTheDocument();
	});

	it("shows error toast when label creation fails with non-Error", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.create).mockRejectedValue("string error");
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		await user.type(screen.getByPlaceholderText("Label name"), "Failing Label");
		await user.click(screen.getByText("Create label", { selector: "button[type='submit']" }));

		await waitFor(() => {
			expect(api.labels.create).toHaveBeenCalled();
		});
	});

	it("shows error toast when label deletion fails", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ id: 42, name: "Temp" });
		vi.mocked(api.labels.delete).mockRejectedValue(new Error("Network error"));

		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Delete label"));
		await user.click(screen.getByText("Delete", { selector: "button" }));

		await waitFor(() => {
			expect(api.labels.delete).toHaveBeenCalledWith(42);
		});
	});

	it("cancels delete confirmation dialog", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ name: "Keep" });
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Delete label"));
		expect(screen.getByText(/Delete "Keep"/)).toBeInTheDocument();
		await user.click(screen.getByText("Cancel"));
		expect(screen.queryByText(/Delete "Keep"/)).not.toBeInTheDocument();
	});

	it("does not submit create form with empty name", async () => {
		const user = userEvent.setup();
		render(<LabelManager {...defaultProps} />);
		await user.click(screen.getByText("+ Create label"));
		// Submit button should be disabled when name is empty
		const submitBtn = screen.getByText("Create label", { selector: "button[type='submit']" });
		expect(submitBtn).toBeDisabled();
	});

	it("updates label via edit form", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ id: 5, name: "Projects" });
		vi.mocked(api.labels.update).mockResolvedValue({ ok: true });
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Edit label"));
		const input = screen.getByDisplayValue("Projects");
		await user.clear(input);
		await user.type(input, "Work Projects");
		await user.click(screen.getByText("Save"));

		await waitFor(() => {
			expect(api.labels.update).toHaveBeenCalledWith(5, {
				name: "Work Projects",
				color: "#3b82f6",
			});
		});
	});

	it("shows error toast when label update fails", async () => {
		const user = userEvent.setup();
		const label = makeLabel({ id: 5, name: "Projects" });
		vi.mocked(api.labels.update).mockRejectedValue(new Error("Update failed"));
		render(
			<LabelManager {...defaultProps} contextMenu={{ label, position: { x: 100, y: 200 } }} />,
		);

		await user.click(screen.getByText("Edit label"));
		await user.click(screen.getByText("Save"));

		await waitFor(() => {
			expect(api.labels.update).toHaveBeenCalled();
		});
	});

	it("deselects color by clicking same color again", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.create).mockResolvedValue({ id: 99 });
		render(<LabelManager {...defaultProps} />);

		await user.click(screen.getByText("+ Create label"));
		await user.type(screen.getByPlaceholderText("Label name"), "No Color");
		// Click red to select, then click red again to deselect
		await user.click(screen.getByTitle("Red"));
		await user.click(screen.getByTitle("Red"));
		await user.click(screen.getByText("Create label", { selector: "button[type='submit']" }));

		await waitFor(() => {
			expect(api.labels.create).toHaveBeenCalledWith(1, { name: "No Color" });
		});
	});
});

describe("MessageLabelPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the label toggle button", () => {
		render(<MessageLabelPicker messageId={1} accountId={1} />);
		expect(screen.getByTitle("Manage labels")).toBeInTheDocument();
	});

	it("opens dropdown and loads labels on click", async () => {
		const user = userEvent.setup();
		const allLabels: Label[] = [
			makeLabel({ id: 1, name: "Inbox", source: "imap" }),
			makeLabel({ id: 2, name: "Work", source: "user" }),
		];
		const msgLabels: LabelSummary[] = [{ id: 1, name: "Inbox", color: null, source: "imap" }];

		vi.mocked(api.labels.list).mockResolvedValue(allLabels);
		vi.mocked(api.messages.labels).mockResolvedValue(msgLabels);

		render(<MessageLabelPicker messageId={10} accountId={1} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(screen.getByText("Inbox")).toBeInTheDocument();
			expect(screen.getByText("Work")).toBeInTheDocument();
		});
	});

	it("toggles a label on a message", async () => {
		const user = userEvent.setup();
		const allLabels: Label[] = [
			makeLabel({ id: 1, name: "Inbox", source: "imap" }),
			makeLabel({ id: 2, name: "Work", source: "user", color: "#3b82f6" }),
		];
		const msgLabels: LabelSummary[] = [{ id: 1, name: "Inbox", color: null, source: "imap" }];
		const onLabelsChanged = vi.fn();

		vi.mocked(api.labels.list).mockResolvedValue(allLabels);
		vi.mocked(api.messages.labels).mockResolvedValue(msgLabels);
		vi.mocked(api.messages.addLabels).mockResolvedValue({ ok: true });

		render(<MessageLabelPicker messageId={10} accountId={1} onLabelsChanged={onLabelsChanged} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(screen.getByText("Work")).toBeInTheDocument();
		});

		// Click "Work" to add it
		await user.click(screen.getByText("Work"));

		await waitFor(() => {
			expect(api.messages.addLabels).toHaveBeenCalledWith(10, [2]);
		});
		expect(onLabelsChanged).toHaveBeenCalled();
	});

	it("removes a label from a message", async () => {
		const user = userEvent.setup();
		const allLabels: Label[] = [makeLabel({ id: 1, name: "Inbox", source: "imap" })];
		const msgLabels: LabelSummary[] = [{ id: 1, name: "Inbox", color: null, source: "imap" }];
		const onLabelsChanged = vi.fn();

		vi.mocked(api.labels.list).mockResolvedValue(allLabels);
		vi.mocked(api.messages.labels).mockResolvedValue(msgLabels);
		vi.mocked(api.messages.removeLabel).mockResolvedValue({ ok: true });

		render(<MessageLabelPicker messageId={10} accountId={1} onLabelsChanged={onLabelsChanged} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(screen.getByText("Inbox")).toBeInTheDocument();
		});

		// Click "Inbox" to remove it (already assigned)
		await user.click(screen.getByText("Inbox"));

		await waitFor(() => {
			expect(api.messages.removeLabel).toHaveBeenCalledWith(10, 1);
		});
		expect(onLabelsChanged).toHaveBeenCalled();
	});

	it("shows error toast when label loading fails", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.list).mockRejectedValue(new Error("Network error"));
		vi.mocked(api.messages.labels).mockRejectedValue(new Error("Network error"));

		render(<MessageLabelPicker messageId={10} accountId={1} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(api.labels.list).toHaveBeenCalled();
		});
	});

	it("shows error toast when toggle fails", async () => {
		const user = userEvent.setup();
		const allLabels: Label[] = [makeLabel({ id: 2, name: "Work", source: "user" })];
		const msgLabels: LabelSummary[] = [];

		vi.mocked(api.labels.list).mockResolvedValue(allLabels);
		vi.mocked(api.messages.labels).mockResolvedValue(msgLabels);
		vi.mocked(api.messages.addLabels).mockRejectedValue(new Error("Failed"));

		render(<MessageLabelPicker messageId={10} accountId={1} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(screen.getByText("Work")).toBeInTheDocument();
		});

		await user.click(screen.getByText("Work"));

		await waitFor(() => {
			expect(api.messages.addLabels).toHaveBeenCalled();
		});
	});

	it("shows empty state when no labels available", async () => {
		const user = userEvent.setup();
		vi.mocked(api.labels.list).mockResolvedValue([]);
		vi.mocked(api.messages.labels).mockResolvedValue([]);

		render(<MessageLabelPicker messageId={10} accountId={1} />);
		await user.click(screen.getByTitle("Manage labels"));

		await waitFor(() => {
			expect(screen.getByText("No labels available")).toBeInTheDocument();
		});
	});

	it("does not fetch labels when accountId is null", async () => {
		const user = userEvent.setup();
		render(<MessageLabelPicker messageId={10} accountId={null} />);
		await user.click(screen.getByTitle("Manage labels"));
		// Give time for any async operations
		await new Promise((r) => setTimeout(r, 50));
		expect(api.labels.list).not.toHaveBeenCalled();
	});

	it("shows loading state while fetching labels", async () => {
		let resolve: (v: Label[]) => void = () => {};
		vi.mocked(api.labels.list).mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		vi.mocked(api.messages.labels).mockResolvedValue([]);

		const user = userEvent.setup();
		render(<MessageLabelPicker messageId={10} accountId={1} />);
		await user.click(screen.getByTitle("Manage labels"));

		expect(screen.getByText("Loading…")).toBeInTheDocument();
		resolve([]);
	});
});
