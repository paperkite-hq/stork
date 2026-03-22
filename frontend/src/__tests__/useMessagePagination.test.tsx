import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSummary } from "../api";
import { useMessagePagination } from "../hooks";

// Mock the API module
const mockLabelMessages = vi.fn();
const mockAllMessagesList = vi.fn();
vi.mock("../api", () => ({
	api: {
		labels: {
			messages: (...args: unknown[]) => mockLabelMessages(...args),
		},
		allMessages: {
			list: (...args: unknown[]) => mockAllMessagesList(...args),
		},
	},
}));

// Mock toast
const mockToast = vi.fn();
vi.mock("../components/Toast", () => ({
	toast: (...args: unknown[]) => mockToast(...args),
}));

// Mock getPageSize
vi.mock("../utils", async (importOriginal) => {
	const original = await importOriginal<typeof import("../utils")>();
	return {
		...original,
		getPageSize: () => 50,
	};
});

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

describe("useMessagePagination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches messages for a label", async () => {
		const msgs = [makeMessage(1), makeMessage(2)];
		mockLabelMessages.mockResolvedValue(msgs);

		const { result } = renderHook(() =>
			useMessagePagination({ effectiveLabelId: 1, effectiveAccountId: 1, isAllMail: false }),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(result.current.allMessages).toEqual(msgs);
		expect(result.current.hasMore).toBe(false); // < 50 messages
		expect(mockLabelMessages).toHaveBeenCalledWith(1, { limit: 50 });
	});

	it("sets hasMore when full page returned", async () => {
		const msgs = Array.from({ length: 50 }, (_, i) => makeMessage(i + 1));
		mockLabelMessages.mockResolvedValue(msgs);

		const { result } = renderHook(() =>
			useMessagePagination({ effectiveLabelId: 1, effectiveAccountId: 1, isAllMail: false }),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(result.current.hasMore).toBe(true);
	});

	it("returns empty when no label selected", async () => {
		const { result } = renderHook(() =>
			useMessagePagination({
				effectiveLabelId: null,
				effectiveAccountId: 1,
				isAllMail: false,
			}),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(result.current.allMessages).toEqual([]);
	});

	it("uses allMessages API for All Mail view", async () => {
		const msgs = [makeMessage(1)];
		mockAllMessagesList.mockResolvedValue(msgs);

		const { result } = renderHook(() =>
			useMessagePagination({ effectiveLabelId: -1, effectiveAccountId: 5, isAllMail: true }),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(mockAllMessagesList).toHaveBeenCalledWith(5, { limit: 50 });
		expect(result.current.allMessages).toEqual(msgs);
	});

	it("returns empty for All Mail without account", async () => {
		const { result } = renderHook(() =>
			useMessagePagination({
				effectiveLabelId: -1,
				effectiveAccountId: null,
				isAllMail: true,
			}),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(result.current.allMessages).toEqual([]);
	});

	it("handleLoadMore appends next page", async () => {
		const page1 = Array.from({ length: 50 }, (_, i) => makeMessage(i + 1));
		const page2 = [makeMessage(51), makeMessage(52)];
		mockLabelMessages.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

		const { result } = renderHook(() =>
			useMessagePagination({ effectiveLabelId: 1, effectiveAccountId: 1, isAllMail: false }),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});
		expect(result.current.hasMore).toBe(true);

		await act(() => result.current.handleLoadMore());
		expect(result.current.allMessages).toHaveLength(52);
		expect(result.current.hasMore).toBe(false);
		expect(mockLabelMessages).toHaveBeenLastCalledWith(1, { limit: 50, offset: 50 });
	});

	it("handleLoadMore shows error toast on failure", async () => {
		const page1 = Array.from({ length: 50 }, (_, i) => makeMessage(i + 1));
		mockLabelMessages.mockResolvedValueOnce(page1).mockRejectedValueOnce(new Error("fail"));

		const { result } = renderHook(() =>
			useMessagePagination({ effectiveLabelId: 1, effectiveAccountId: 1, isAllMail: false }),
		);

		await waitFor(() => {
			expect(result.current.hasMore).toBe(true);
		});

		await act(() => result.current.handleLoadMore());
		expect(mockToast).toHaveBeenCalledWith("Failed to load more messages", "error");
	});

	it("handleLoadMore is a no-op without a label", async () => {
		mockLabelMessages.mockResolvedValue([]);
		const { result } = renderHook(() =>
			useMessagePagination({
				effectiveLabelId: null,
				effectiveAccountId: 1,
				isAllMail: false,
			}),
		);

		await waitFor(() => {
			expect(result.current.messagesLoading).toBe(false);
		});

		await act(() => result.current.handleLoadMore());
		// Should not have made any additional API calls beyond initial
		expect(mockLabelMessages).not.toHaveBeenCalled();
	});
});
