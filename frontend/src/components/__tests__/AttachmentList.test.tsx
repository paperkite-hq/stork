import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentList } from "../AttachmentList";

// Mock useAsync from hooks
vi.mock("../../hooks", () => ({
	useAsync: vi.fn(),
}));

// Mock api
vi.mock("../../api", () => ({
	api: {
		messages: {
			attachments: vi.fn(),
		},
	},
}));

describe("AttachmentList", () => {
	it("returns null when loading", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: null,
			loading: true,
			error: null,
		});
		const { container } = render(<AttachmentList messageId={1} />);
		expect(container.innerHTML).toBe("");
	});

	it("returns null when no attachments", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [],
			loading: false,
			error: null,
		});
		const { container } = render(<AttachmentList messageId={1} />);
		expect(container.innerHTML).toBe("");
	});

	it("renders attachment count (singular)", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [
				{
					id: 1,
					filename: "report.pdf",
					content_type: "application/pdf",
					size: 1024,
					content_id: null,
				},
			],
			loading: false,
			error: null,
		});
		render(<AttachmentList messageId={1} />);
		expect(screen.getByText("1 attachment")).toBeInTheDocument();
	});

	it("renders attachment count (plural)", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [
				{
					id: 1,
					filename: "report.pdf",
					content_type: "application/pdf",
					size: 1024,
					content_id: null,
				},
				{ id: 2, filename: "image.png", content_type: "image/png", size: 2048, content_id: null },
			],
			loading: false,
			error: null,
		});
		render(<AttachmentList messageId={1} />);
		expect(screen.getByText("2 attachments")).toBeInTheDocument();
	});

	it("renders attachment filename and download link", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [
				{
					id: 42,
					filename: "report.pdf",
					content_type: "application/pdf",
					size: 1024,
					content_id: null,
				},
			],
			loading: false,
			error: null,
		});
		render(<AttachmentList messageId={1} />);
		const link = screen.getByText("report.pdf").closest("a");
		expect(link).toHaveAttribute("href", "/api/attachments/42");
		expect(link).toHaveAttribute("download", "report.pdf");
	});

	it("shows file size when available", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [
				{
					id: 1,
					filename: "big.zip",
					content_type: "application/zip",
					size: 1048576,
					content_id: null,
				},
			],
			loading: false,
			error: null,
		});
		render(<AttachmentList messageId={1} />);
		expect(screen.getByText("1.0 MB")).toBeInTheDocument();
	});

	it("falls back to 'attachment' for null filename", async () => {
		const { useAsync } = await import("../../hooks");
		(useAsync as ReturnType<typeof vi.fn>).mockReturnValue({
			data: [{ id: 1, filename: null, content_type: null, size: 0, content_id: null }],
			loading: false,
			error: null,
		});
		render(<AttachmentList messageId={1} />);
		const links = screen.getAllByText("attachment");
		expect(links.length).toBeGreaterThan(0);
	});
});
