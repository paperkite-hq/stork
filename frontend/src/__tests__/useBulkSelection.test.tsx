import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSummary } from "../api";
import { useBulkSelection } from "../hooks";

// Mock the API module
const mockBulk = vi.fn().mockResolvedValue({ ok: true, count: 0 });
vi.mock("../api", () => ({
	api: {
		messages: {
			bulk: (...args: unknown[]) => mockBulk(...args),
		},
	},
}));

// Mock the toast function
const mockToast = vi.fn();
vi.mock("../components/Toast", () => ({
	toast: (...args: unknown[]) => mockToast(...args),
}));

function makeMessage(id: number): MessageSummary {
	return {
		id,
		uid: id * 10,
		message_id: `<msg-${id}@test>`,
		subject: `Subject ${id}`,
		from_address: `sender${id}@test.com`,
		from_name: `Sender ${id}`,
		to_addresses: "me@test.com",
		date: "2026-03-21T00:00:00Z",
		flags: "",
		size: 1024,
		has_attachments: 0,
		preview: `Preview ${id}`,
	};
}

describe("useBulkSelection", () => {
	const messages = [makeMessage(1), makeMessage(2), makeMessage(3)];
	let setSelectedMessageId: (id: number | null) => void;
	let refetchMessages: () => void;
	let refetchLabels: () => void;

	beforeEach(() => {
		vi.clearAllMocks();
		setSelectedMessageId = vi.fn();
		refetchMessages = vi.fn();
		refetchLabels = vi.fn();
	});

	function renderBulk(overrides: Partial<Parameters<typeof useBulkSelection>[0]> = {}) {
		return renderHook(() =>
			useBulkSelection({
				messages,
				selectedMessageId: null,
				setSelectedMessageId,
				refetchMessages,
				refetchLabels,
				...overrides,
			}),
		);
	}

	// ---- Selection state ----

	it("starts with empty selection", () => {
		const { result } = renderBulk();
		expect(result.current.selectedIds.size).toBe(0);
	});

	it("toggle adds an id to selection", () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		expect(result.current.selectedIds.has(1)).toBe(true);
		expect(result.current.selectedIds.size).toBe(1);
	});

	it("toggle removes an already-selected id", () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(1));
		expect(result.current.selectedIds.has(1)).toBe(false);
		expect(result.current.selectedIds.size).toBe(0);
	});

	it("toggle can select multiple ids independently", () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(3));
		expect(result.current.selectedIds.has(1)).toBe(true);
		expect(result.current.selectedIds.has(2)).toBe(false);
		expect(result.current.selectedIds.has(3)).toBe(true);
		expect(result.current.selectedIds.size).toBe(2);
	});

	it("selectAll selects all message ids", () => {
		const { result } = renderBulk();
		act(() => result.current.selectAll());
		expect(result.current.selectedIds.size).toBe(3);
		expect(result.current.selectedIds.has(1)).toBe(true);
		expect(result.current.selectedIds.has(2)).toBe(true);
		expect(result.current.selectedIds.has(3)).toBe(true);
	});

	it("clear empties the selection", () => {
		const { result } = renderBulk();
		act(() => result.current.selectAll());
		expect(result.current.selectedIds.size).toBe(3);
		act(() => result.current.clear());
		expect(result.current.selectedIds.size).toBe(0);
	});

	// ---- bulkDelete ----

	it("bulkDelete does nothing when selection is empty", async () => {
		const { result } = renderBulk();
		await act(async () => result.current.bulkDelete());
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it("bulkDelete calls api.messages.bulk with delete action", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(2));
		await act(async () => result.current.bulkDelete());

		expect(mockBulk).toHaveBeenCalledWith([1, 2], "delete");
	});

	it("bulkDelete clears selection after success", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(result.current.selectedIds.size).toBe(0);
	});

	it("bulkDelete refetches messages and labels on success", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(refetchMessages).toHaveBeenCalledOnce();
		expect(refetchLabels).toHaveBeenCalledOnce();
	});

	it("bulkDelete shows success toast", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(mockToast).toHaveBeenCalledWith("Deleted 1 message", "success");
	});

	it("bulkDelete pluralizes toast for multiple messages", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(2));
		await act(async () => result.current.bulkDelete());
		expect(mockToast).toHaveBeenCalledWith("Deleted 2 messages", "success");
	});

	it("bulkDelete clears selectedMessageId when deleted message was selected", async () => {
		const { result } = renderBulk({ selectedMessageId: 2 });
		act(() => result.current.toggle(2));
		await act(async () => result.current.bulkDelete());
		expect(setSelectedMessageId).toHaveBeenCalledWith(null);
	});

	it("bulkDelete does not clear selectedMessageId when it is not in deleted set", async () => {
		const { result } = renderBulk({ selectedMessageId: 3 });
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(setSelectedMessageId).not.toHaveBeenCalled();
	});

	it("bulkDelete shows error toast on API failure", async () => {
		mockBulk.mockRejectedValueOnce(new Error("Server error"));
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(mockToast).toHaveBeenCalledWith("Failed to delete: Server error", "error");
	});

	// ---- markRead ----

	it("markRead does nothing when selection is empty", async () => {
		const { result } = renderBulk();
		await act(async () => result.current.markRead());
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it("markRead calls api with flag action and \\Seen flag", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(2));
		await act(async () => result.current.markRead());
		expect(mockBulk).toHaveBeenCalledWith([2], "flag", { add: ["\\Seen"] });
	});

	it("markRead clears selection and refetches messages on success", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markRead());
		expect(result.current.selectedIds.size).toBe(0);
		expect(refetchMessages).toHaveBeenCalledOnce();
	});

	it("markRead shows success toast", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(3));
		await act(async () => result.current.markRead());
		expect(mockToast).toHaveBeenCalledWith("Marked 2 messages as read", "success");
	});

	it("markRead shows error toast on failure", async () => {
		mockBulk.mockRejectedValueOnce(new Error("Timeout"));
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markRead());
		expect(mockToast).toHaveBeenCalledWith("Failed to mark read: Timeout", "error");
	});

	// ---- markUnread ----

	it("markUnread does nothing when selection is empty", async () => {
		const { result } = renderBulk();
		await act(async () => result.current.markUnread());
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it("markUnread calls api with flag action and removes \\Seen", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(3));
		await act(async () => result.current.markUnread());
		expect(mockBulk).toHaveBeenCalledWith([3], "flag", { remove: ["\\Seen"] });
	});

	it("markUnread clears selection and refetches on success", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markUnread());
		expect(result.current.selectedIds.size).toBe(0);
		expect(refetchMessages).toHaveBeenCalledOnce();
	});

	it("markUnread shows error toast on failure", async () => {
		mockBulk.mockRejectedValueOnce(new Error("Network error"));
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markUnread());
		expect(mockToast).toHaveBeenCalledWith("Failed to mark unread: Network error", "error");
	});

	// ---- move ----

	it("move does nothing when selection is empty", async () => {
		const { result } = renderBulk();
		await act(async () => result.current.move(5));
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it("move calls api with move action and folder_id", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		act(() => result.current.toggle(2));
		await act(async () => result.current.move(42));
		expect(mockBulk).toHaveBeenCalledWith([1, 2], "move", { folder_id: 42 });
	});

	it("move clears selection and refetches messages + labels", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.move(5));
		expect(result.current.selectedIds.size).toBe(0);
		expect(refetchMessages).toHaveBeenCalledOnce();
		expect(refetchLabels).toHaveBeenCalledOnce();
	});

	it("move clears selectedMessageId when moved message was selected", async () => {
		const { result } = renderBulk({ selectedMessageId: 1 });
		act(() => result.current.toggle(1));
		await act(async () => result.current.move(5));
		expect(setSelectedMessageId).toHaveBeenCalledWith(null);
	});

	it("move does not clear selectedMessageId for non-moved messages", async () => {
		const { result } = renderBulk({ selectedMessageId: 2 });
		act(() => result.current.toggle(3));
		await act(async () => result.current.move(5));
		expect(setSelectedMessageId).not.toHaveBeenCalled();
	});

	it("move shows success toast", async () => {
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.move(5));
		expect(mockToast).toHaveBeenCalledWith("Moved 1 message", "success");
	});

	it("move shows error toast on failure", async () => {
		mockBulk.mockRejectedValueOnce(new Error("Permission denied"));
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.move(5));
		expect(mockToast).toHaveBeenCalledWith("Failed to move: Permission denied", "error");
	});

	// ---- Error handling edge cases ----

	it("bulkDelete handles non-Error thrown values", async () => {
		mockBulk.mockRejectedValueOnce("string error");
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.bulkDelete());
		expect(mockToast).toHaveBeenCalledWith("Failed to delete: Unknown error", "error");
	});

	it("markRead handles non-Error thrown values", async () => {
		mockBulk.mockRejectedValueOnce(42);
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markRead());
		expect(mockToast).toHaveBeenCalledWith("Failed to mark read: Unknown error", "error");
	});

	it("markUnread handles non-Error thrown values", async () => {
		mockBulk.mockRejectedValueOnce(null);
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.markUnread());
		expect(mockToast).toHaveBeenCalledWith("Failed to mark unread: Unknown error", "error");
	});

	it("move handles non-Error thrown values", async () => {
		mockBulk.mockRejectedValueOnce(undefined);
		const { result } = renderBulk();
		act(() => result.current.toggle(1));
		await act(async () => result.current.move(5));
		expect(mockToast).toHaveBeenCalledWith("Failed to move: Unknown error", "error");
	});

	// ---- setSelectedIds ----

	it("exposes setSelectedIds for direct manipulation", () => {
		const { result } = renderBulk();
		act(() => result.current.setSelectedIds(new Set([1, 3])));
		expect(result.current.selectedIds.size).toBe(2);
		expect(result.current.selectedIds.has(1)).toBe(true);
		expect(result.current.selectedIds.has(3)).toBe(true);
	});
});
