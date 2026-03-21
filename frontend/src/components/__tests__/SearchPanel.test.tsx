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

	it("shows search tip", () => {
		render(<SearchPanel onClose={vi.fn()} onSelectMessage={vi.fn()} accountId={null} />);
		expect(screen.getByText(/AND, OR, NOT/)).toBeInTheDocument();
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
});
