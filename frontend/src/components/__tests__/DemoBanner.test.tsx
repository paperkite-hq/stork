import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemoBanner } from "../DemoBanner";

vi.mock("../../api", () => ({
	api: {
		demo: vi.fn(),
	},
}));

import { api } from "../../api";

const mockDemo = vi.mocked(api.demo);

describe("DemoBanner", () => {
	it("renders nothing when not in demo mode", async () => {
		mockDemo.mockResolvedValue({ demo: false });
		const { container } = render(<DemoBanner />);
		await waitFor(() => expect(mockDemo).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});

	it("renders banner when in demo mode", async () => {
		mockDemo.mockResolvedValue({ demo: true });
		render(<DemoBanner />);
		await waitFor(() => expect(screen.getByText(/Read-only demo/)).toBeInTheDocument());
		expect(screen.getByText("Get Stork")).toBeInTheDocument();
	});

	it("renders nothing when API call fails", async () => {
		mockDemo.mockRejectedValue(new Error("Network error"));
		const { container } = render(<DemoBanner />);
		await waitFor(() => expect(mockDemo).toHaveBeenCalled());
		expect(container.textContent).toBe("");
	});
});
