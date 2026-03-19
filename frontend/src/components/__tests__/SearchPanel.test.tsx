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
		expect(screen.getByText(/Use AND, OR, NOT/)).toBeInTheDocument();
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
