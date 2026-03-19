import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
		await user.click(screen.getByTitle("#ef4444"));
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
});

describe("MessageLabelPicker", () => {
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
});
