import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../SearchPanel";

const mockSearch = vi.fn();

vi.mock("../../api", () => ({
	api: {
		search: (...args: unknown[]) => mockSearch(...args),
	},
}));

describe("SearchPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSearch.mockResolvedValue([]);
	});

	it("renders search input with placeholder", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByPlaceholderText("Search messages…")).toBeInTheDocument();
	});

	it("renders close button", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByTitle("Close")).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", async () => {
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={vi.fn()} accountId={null} />);
		await userEvent.click(screen.getByTitle("Close"));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("calls onClose when Escape is pressed in input", async () => {
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "{Escape}");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("shows search tip with operator hints", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByText(/to navigate/)).toBeInTheDocument();
	});

	it("shows no results message after search", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "nonexistent");
		await waitFor(() => {
			expect(screen.getByText(/No results for/)).toBeInTheDocument();
		});
	});

	it("shows search results", async () => {
		mockSearch.mockResolvedValue([
			{
				id: 1,
				subject: "Found Email",
				from_address: "alice@test.com",
				from_name: "Alice",
				date: "2026-01-15T10:00:00Z",
				snippet: "This is a <b>match</b>",
			},
		]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "found");
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeInTheDocument();
		});
		expect(screen.getByText("Found Email")).toBeInTheDocument();
	});

	it("calls onSelectMessage and onClose when result is clicked", async () => {
		mockSearch.mockResolvedValue([
			{
				id: 42,
				subject: "Clickable Email",
				from_address: "bob@test.com",
				from_name: "Bob",
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
		]);
		const onSelectMessage = vi.fn();
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={onSelectMessage} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "clickable");
		await waitFor(() => {
			expect(screen.getByText("Clickable Email")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Clickable Email"));
		expect(onSelectMessage).toHaveBeenCalledWith(42);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("passes accountId to search API", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={5} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith("test", { accountId: 5, limit: 30 });
		});
	});

	it("navigates results with arrow keys and selects with Enter", async () => {
		mockSearch.mockResolvedValue([
			{
				id: 10,
				subject: "First Result",
				from_address: "a@test.com",
				from_name: "Alice",
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
			{
				id: 20,
				subject: "Second Result",
				from_address: "b@test.com",
				from_name: "Bob",
				date: "2026-01-15T11:00:00Z",
				snippet: "",
			},
			{
				id: 30,
				subject: "Third Result",
				from_address: "c@test.com",
				from_name: "Carol",
				date: "2026-01-15T12:00:00Z",
				snippet: "",
			},
		]);
		const onSelectMessage = vi.fn();
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={onSelectMessage} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(screen.getByText("First Result")).toBeInTheDocument();
		});
		// First result should be auto-focused (aria-selected)
		const firstBtn = screen.getByText("First Result").closest("button");
		expect(firstBtn).toHaveAttribute("aria-selected", "true");
		// Arrow down to second result
		await userEvent.keyboard("{ArrowDown}");
		const secondBtn = screen.getByText("Second Result").closest("button");
		expect(secondBtn).toHaveAttribute("aria-selected", "true");
		expect(firstBtn).toHaveAttribute("aria-selected", "false");
		// Arrow down to third
		await userEvent.keyboard("{ArrowDown}");
		const thirdBtn = screen.getByText("Third Result").closest("button");
		expect(thirdBtn).toHaveAttribute("aria-selected", "true");
		// Arrow down at bottom should stay on last
		await userEvent.keyboard("{ArrowDown}");
		expect(thirdBtn).toHaveAttribute("aria-selected", "true");
		// Arrow up to second
		await userEvent.keyboard("{ArrowUp}");
		expect(secondBtn).toHaveAttribute("aria-selected", "true");
		// Enter selects the focused result
		await userEvent.keyboard("{Enter}");
		expect(onSelectMessage).toHaveBeenCalledWith(20);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("highlights result on mouse hover", async () => {
		mockSearch.mockResolvedValue([
			{
				id: 10,
				subject: "Hoverable",
				from_address: "a@test.com",
				from_name: "Alice",
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
			{
				id: 20,
				subject: "Another",
				from_address: "b@test.com",
				from_name: "Bob",
				date: "2026-01-15T11:00:00Z",
				snippet: "",
			},
		]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(screen.getByText("Hoverable")).toBeInTheDocument();
		});
		// Hover over second result
		const secondBtn = screen.getByText("Another").closest("button");
		expect(secondBtn).toBeTruthy();
		await userEvent.hover(secondBtn as HTMLElement);
		expect(secondBtn).toHaveAttribute("aria-selected", "true");
	});

	it("shows keyboard navigation hint", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByText(/to navigate/)).toBeInTheDocument();
	});

	it("shows Load more button when results fill a page", async () => {
		// Return exactly 30 results to trigger hasMore
		const results = Array.from({ length: 30 }, (_, i) => ({
			id: i + 1,
			subject: `Result ${i + 1}`,
			from_address: `user${i}@test.com`,
			from_name: `User ${i}`,
			date: "2026-01-15T10:00:00Z",
			snippet: "",
		}));
		mockSearch.mockResolvedValueOnce(results);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(screen.getByText("Result 1")).toBeInTheDocument();
		});
		expect(screen.getByText(/Load more results/)).toBeInTheDocument();
		expect(screen.getByText(/30 shown/)).toBeInTheDocument();
	});

	it("does not show Load more when results are fewer than page size", async () => {
		mockSearch.mockResolvedValueOnce([
			{
				id: 1,
				subject: "Only Result",
				from_address: "a@test.com",
				from_name: "Alice",
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
		]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(screen.getByText("Only Result")).toBeInTheDocument();
		});
		expect(screen.queryByText(/Load more/)).not.toBeInTheDocument();
	});

	it("loads more results when Load more is clicked", async () => {
		const firstPage = Array.from({ length: 30 }, (_, i) => ({
			id: i + 1,
			subject: `Result ${i + 1}`,
			from_address: `user${i}@test.com`,
			from_name: `User ${i}`,
			date: "2026-01-15T10:00:00Z",
			snippet: "",
		}));
		const secondPage = [
			{
				id: 31,
				subject: "Extra Result",
				from_address: "extra@test.com",
				from_name: "Extra",
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
		];
		mockSearch.mockResolvedValueOnce(firstPage);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={3} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "query");
		await waitFor(() => {
			expect(screen.getByText("Result 1")).toBeInTheDocument();
		});
		// Click Load more
		mockSearch.mockResolvedValueOnce(secondPage);
		await userEvent.click(screen.getByText(/Load more results/));
		await waitFor(() => {
			expect(screen.getByText("Extra Result")).toBeInTheDocument();
		});
		// Should have called search with offset=30
		expect(mockSearch).toHaveBeenCalledWith("query", { accountId: 3, limit: 30, offset: 30 });
		// Load more should be gone (secondPage < 30 results)
		expect(screen.queryByText(/Load more/)).not.toBeInTheDocument();
	});

	it("calls onClose when backdrop is clicked", async () => {
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={vi.fn()} accountId={null} />);
		// Click the backdrop (the outer dialog overlay)
		const backdrop = screen.getByRole("dialog");
		await userEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("does not close when clicking inside the modal content", async () => {
		const onClose = vi.fn();
		render(<SearchPanel onClose={onClose} onSelectMessage={vi.fn()} accountId={null} />);
		// Click on the search input (inside the modal)
		await userEvent.click(screen.getByPlaceholderText("Search messages…"));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("shows (no subject) for messages without subject", async () => {
		mockSearch.mockResolvedValue([
			{
				id: 1,
				subject: null,
				from_address: "test@test.com",
				from_name: null,
				date: "2026-01-15T10:00:00Z",
				snippet: "",
			},
		]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "test");
		await waitFor(() => {
			expect(screen.getByText("(no subject)")).toBeInTheDocument();
		});
	});

	it("renders quick filter buttons", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByText("Unread")).toBeInTheDocument();
		expect(screen.getByText("Starred")).toBeInTheDocument();
		expect(screen.getByText("Has attachment")).toBeInTheDocument();
		expect(screen.getByText("Date range")).toBeInTheDocument();
	});

	it("toggles quick filter and triggers search", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={1} />);
		// Click "Unread" filter
		await userEvent.click(screen.getByText("Unread"));
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith("is:unread", { accountId: 1, limit: 30 });
		});
	});

	it("shows active filter chips and allows removal", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		await userEvent.click(screen.getByText("Starred"));
		await waitFor(() => {
			// Should show the active filter chip
			expect(screen.getByLabelText("Remove Starred filter")).toBeInTheDocument();
		});
		// Remove the filter
		await userEvent.click(screen.getByLabelText("Remove Starred filter"));
		await waitFor(() => {
			expect(screen.queryByLabelText("Remove Starred filter")).not.toBeInTheDocument();
		});
	});

	it("combines text query with filter chips", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		// Click a filter first
		await userEvent.click(screen.getByText("Has attachment"));
		// Then type a query
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "invoice");
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith(
				"invoice has:attachment",
				expect.objectContaining({ limit: 30 }),
			);
		});
	});

	it("shows date range picker when Date range is clicked", async () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		await userEvent.click(screen.getByText("Date range"));
		expect(screen.getByText("After:")).toBeInTheDocument();
		expect(screen.getByText("Before:")).toBeInTheDocument();
		expect(screen.getByText("Apply")).toBeInTheDocument();
	});

	it("shows filter-specific empty state when only filters are active", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		// Activate filter without typing any text
		await userEvent.click(screen.getByText("Unread"));
		await waitFor(() => {
			expect(screen.getByText("No messages match the selected filters")).toBeInTheDocument();
		});
	});

	it("clears all filters with Clear all button", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		// Activate two filters
		await userEvent.click(screen.getByText("Unread"));
		await userEvent.click(screen.getByText("Starred"));
		await waitFor(() => {
			expect(screen.getByText("Clear all")).toBeInTheDocument();
		});
		await userEvent.click(screen.getByText("Clear all"));
		await waitFor(() => {
			expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
		});
	});

	it("applies date range filter with after and before dates", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={1} />);
		// Open date range picker
		await userEvent.click(screen.getByText("Date range"));
		expect(screen.getByText("Apply")).toBeInTheDocument();
		// Fill in date inputs
		const afterInput = screen.getByLabelText("After:");
		const beforeInput = screen.getByLabelText("Before:");
		await userEvent.type(afterInput, "2026-01-01");
		await userEvent.type(beforeInput, "2026-02-01");
		// Apply
		await userEvent.click(screen.getByText("Apply"));
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith(
				"after:2026-01-01 before:2026-02-01",
				expect.objectContaining({ accountId: 1, limit: 30 }),
			);
		});
		// Date filter chips should appear
		expect(screen.getByLabelText("Remove After 2026-01-01 filter")).toBeInTheDocument();
		expect(screen.getByLabelText("Remove Before 2026-02-01 filter")).toBeInTheDocument();
		// Date picker should be closed
		expect(screen.queryByText("Apply")).not.toBeInTheDocument();
	});

	it("applies date filter with only after date", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		await userEvent.click(screen.getByText("Date range"));
		const afterInput = screen.getByLabelText("After:");
		await userEvent.type(afterInput, "2026-03-15");
		await userEvent.click(screen.getByText("Apply"));
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith(
				"after:2026-03-15",
				expect.objectContaining({ limit: 30 }),
			);
		});
	});

	it("combines date filters with text query and other filters", async () => {
		mockSearch.mockResolvedValue([]);
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		// Type a query first
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "invoice");
		// Add a filter chip
		await userEvent.click(screen.getByText("Has attachment"));
		// Add date filter
		await userEvent.click(screen.getByText("Date range"));
		const afterInput = screen.getByLabelText("After:");
		await userEvent.type(afterInput, "2026-01-01");
		await userEvent.click(screen.getByText("Apply"));
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalledWith(
				"invoice has:attachment after:2026-01-01",
				expect.objectContaining({ limit: 30 }),
			);
		});
	});

	it("shows search error toast on API failure", async () => {
		mockSearch.mockRejectedValueOnce(new Error("Search failed"));
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		const input = screen.getByPlaceholderText("Search messages…");
		await userEvent.type(input, "broken");
		// Wait for the search to be called and fail
		await waitFor(() => {
			expect(mockSearch).toHaveBeenCalled();
		});
	});
});
