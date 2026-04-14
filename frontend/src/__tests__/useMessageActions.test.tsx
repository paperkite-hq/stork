import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, Label, MessageSummary } from "../api";
import { useMessageActions } from "../hooks";

// Mock the API module
const mockUpdateFlags = vi.fn().mockResolvedValue({ ok: true, flags: "" });
const mockDelete = vi.fn().mockResolvedValue({ ok: true });
const mockMove = vi.fn().mockResolvedValue({ ok: true });
const mockRemoveLabel = vi.fn().mockResolvedValue({ ok: true });
const mockAddLabels = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../api", () => ({
	api: {
		messages: {
			updateFlags: (...args: unknown[]) => mockUpdateFlags(...args),
			delete: (...args: unknown[]) => mockDelete(...args),
			move: (...args: unknown[]) => mockMove(...args),
			removeLabel: (...args: unknown[]) => mockRemoveLabel(...args),
			addLabels: (...args: unknown[]) => mockAddLabels(...args),
		},
	},
}));

// Mock the toast function
const mockToast = vi.fn();
vi.mock("../components/Toast", () => ({
	toast: (...args: unknown[]) => mockToast(...args),
}));

function makeMessage(id: number, flags = ""): MessageSummary {
	return {
		id,
		uid: id * 10,
		message_id: `<msg-${id}@test>`,
		subject: `Subject ${id}`,
		from_address: `sender${id}@test.com`,
		from_name: `Sender ${id}`,
		to_addresses: "me@test.com",
		date: "2026-03-21T00:00:00Z",
		flags,
		size: 1024,
		has_attachments: 0,
		preview: `Preview ${id}`,
	};
}

function makeLabel(overrides: Partial<Label> = {}): Label {
	return {
		id: 1,
		name: "Inbox",
		color: null,
		icon: null,
		source: "imap",
		created_at: "2026-01-01",
		message_count: 10,
		unread_count: 3,
		...overrides,
	};
}

function makeFolder(overrides: Partial<Folder> = {}): Folder {
	return {
		id: 1,
		path: "INBOX",
		name: "Inbox",
		special_use: null,
		message_count: 10,
		unread_count: 3,
		last_synced_at: null,
		...overrides,
	};
}

describe("useMessageActions", () => {
	const messages = [makeMessage(1), makeMessage(2, "\\Flagged"), makeMessage(3, "\\Seen")];
	let setSelectedMessageId: ReturnType<typeof vi.fn>;
	let setAllMessages: ReturnType<typeof vi.fn>;
	let refetchMessages: ReturnType<typeof vi.fn>;
	let refetchLabels: ReturnType<typeof vi.fn>;
	let refetchAllMailCount: ReturnType<typeof vi.fn>;
	let refetchUnreadCount: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		setSelectedMessageId = vi.fn();
		setAllMessages = vi.fn((updater: (prev: MessageSummary[]) => MessageSummary[]) => {
			if (typeof updater === "function") updater(messages);
		});
		refetchMessages = vi.fn();
		refetchLabels = vi.fn();
		refetchAllMailCount = vi.fn();
		refetchUnreadCount = vi.fn();
	});

	function renderActions(overrides: Partial<Parameters<typeof useMessageActions>[0]> = {}) {
		return renderHook(() =>
			useMessageActions({
				messages,
				messageListIndex: 0,
				selectedMessageId: null,
				setSelectedMessageId,
				setAllMessages,
				labels: [makeLabel()],
				folders: [makeFolder()],
				effectiveLabelId: 1,
				isAllMail: false,
				refetchMessages,
				refetchLabels,
				refetchAllMailCount,
				refetchUnreadCount,
				...overrides,
			}),
		);
	}

	it("star toggles \\Flagged flag on unflagged message", async () => {
		const { result } = renderActions();
		await act(() => result.current.star());
		expect(mockUpdateFlags).toHaveBeenCalledWith(1, { add: ["\\Flagged"] });
		expect(mockToast).toHaveBeenCalledWith("Starred", "success");
	});

	it("star removes \\Flagged flag on flagged message", async () => {
		const { result } = renderActions({ messageListIndex: 1 });
		await act(() => result.current.star());
		expect(mockUpdateFlags).toHaveBeenCalledWith(2, { remove: ["\\Flagged"] });
		expect(mockToast).toHaveBeenCalledWith("Removed star", "success");
	});

	it("star reverts on API failure", async () => {
		mockUpdateFlags.mockRejectedValueOnce(new Error("Network error"));
		const { result } = renderActions();
		await act(() => result.current.star());
		expect(refetchMessages).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Failed to star: Network error", "error");
	});

	it("toggleRead marks unread message as read", async () => {
		const msgsWithUnread = [makeMessage(1, ""), makeMessage(2)];
		const { result } = renderActions({ messages: msgsWithUnread });
		await act(() => result.current.toggleRead());
		expect(mockUpdateFlags).toHaveBeenCalledWith(1, { add: ["\\Seen"] });
		expect(mockToast).toHaveBeenCalledWith("Marked as read", "success");
		expect(refetchLabels).toHaveBeenCalled();
		expect(refetchUnreadCount).toHaveBeenCalled();
	});

	it("toggleRead marks read message as unread", async () => {
		const msgsWithRead = [makeMessage(1, "\\Seen")];
		const { result } = renderActions({ messages: msgsWithRead });
		await act(() => result.current.toggleRead());
		expect(mockUpdateFlags).toHaveBeenCalledWith(1, { remove: ["\\Seen"] });
		expect(mockToast).toHaveBeenCalledWith("Marked as unread", "success");
	});

	it("toggleRead reverts on API failure", async () => {
		mockUpdateFlags.mockRejectedValueOnce(new Error("Server error"));
		const { result } = renderActions();
		await act(() => result.current.toggleRead());
		expect(refetchMessages).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Failed to update: Server error", "error");
	});

	it("archive uses label removal when viewing a label", async () => {
		const { result } = renderActions({ effectiveLabelId: 1, isAllMail: false });
		await act(() => result.current.archive());
		expect(mockRemoveLabel).toHaveBeenCalledWith(1, 1);
		expect(refetchLabels).toHaveBeenCalled();
		expect(refetchAllMailCount).toHaveBeenCalled();
		expect(refetchUnreadCount).toHaveBeenCalled();
	});

	it("archive shows error in All Mail view", async () => {
		const { result } = renderActions({
			isAllMail: true,
			effectiveLabelId: -1,
			folders: [],
			labels: [],
		});
		await act(() => result.current.archive());
		expect(mockMove).not.toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Archive is only available from Inbox", "error");
	});

	it("archive reverts on label removal failure", async () => {
		mockRemoveLabel.mockRejectedValueOnce(new Error("Failed"));
		const { result } = renderActions({ effectiveLabelId: 1 });
		await act(() => result.current.archive());
		expect(refetchMessages).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Failed to archive: Failed", "error");
	});

	it("archive shows error when no label context", async () => {
		const { result } = renderActions({
			isAllMail: false,
			effectiveLabelId: null,
			folders: [],
			labels: [],
		});
		await act(() => result.current.archive());
		expect(mockMove).not.toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Archive is only available from Inbox", "error");
	});

	it("confirmDelete does nothing when pendingDelete is null", async () => {
		const { result } = renderActions();
		await act(() => result.current.confirmDelete());
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it("confirmDelete deletes the message and shows toast", async () => {
		const { result } = renderActions();
		// Set pending delete
		act(() => result.current.setPendingDelete(1));
		await act(() => result.current.confirmDelete());
		expect(mockDelete).toHaveBeenCalledWith(1);
		expect(refetchMessages).toHaveBeenCalled();
		expect(refetchUnreadCount).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith("Message deleted", "success");
	});

	it("confirmDelete shows error toast on failure", async () => {
		mockDelete.mockRejectedValueOnce(new Error("Delete failed"));
		const { result } = renderActions();
		act(() => result.current.setPendingDelete(1));
		await act(() => result.current.confirmDelete());
		expect(mockToast).toHaveBeenCalledWith("Failed to delete: Delete failed", "error");
	});

	it("focusedMessage returns the message at messageListIndex", () => {
		const { result } = renderActions({ messageListIndex: 1 });
		expect(result.current.focusedMessage).toEqual(messages[1]);
	});

	it("focusedMessage returns null for out-of-bounds index", () => {
		const { result } = renderActions({ messageListIndex: 99 });
		expect(result.current.focusedMessage).toBeNull();
	});

	it("star does nothing when no focused message", async () => {
		const { result } = renderActions({ messageListIndex: 99 });
		await act(() => result.current.star());
		expect(mockUpdateFlags).not.toHaveBeenCalled();
	});

	it("archive undo callback re-adds the label", async () => {
		// Verify that the undo button passed to toast actually calls addLabels
		const { result } = renderActions({ effectiveLabelId: 1, isAllMail: false });
		await act(() => result.current.archive());

		// Archive should pass an action object with label: "Undo" and onClick callback
		expect(mockToast).toHaveBeenCalledWith(
			"Archived",
			"success",
			expect.objectContaining({ label: "Undo", onClick: expect.any(Function) }),
		);

		// Extract and invoke the undo callback
		const toastCall = mockToast.mock.calls.find(
			(c) => c[0] === "Archived" && c[2]?.label === "Undo",
		);
		expect(toastCall).toBeTruthy();
		const undoCallback = toastCall?.[2]?.onClick;

		await act(async () => {
			await undoCallback?.();
		});

		expect(mockAddLabels).toHaveBeenCalledWith(1, [1]);
		expect(refetchMessages).toHaveBeenCalled();
		expect(refetchLabels).toHaveBeenCalledTimes(2); // once for archive, once for undo
	});

	it("archive undo callback shows error toast on addLabels failure", async () => {
		mockAddLabels.mockRejectedValueOnce(new Error("Network error"));
		const { result } = renderActions({ effectiveLabelId: 1, isAllMail: false });
		await act(() => result.current.archive());

		const toastCall = mockToast.mock.calls.find(
			(c) => c[0] === "Archived" && c[2]?.label === "Undo",
		);
		const undoCallback = toastCall?.[2]?.onClick;

		await act(async () => {
			await undoCallback?.();
		});

		expect(mockToast).toHaveBeenCalledWith("Failed to undo", "error");
	});
});
