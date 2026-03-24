import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";

// Component that throws on render
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
	if (shouldThrow) throw new Error("Test render error");
	return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
	// Suppress console.error from React error boundary logging
	const originalError = console.error;
	beforeAll(() => {
		console.error = vi.fn();
	});
	afterAll(() => {
		console.error = originalError;
	});

	it("renders children when no error occurs", () => {
		render(
			<ErrorBoundary>
				<div>Normal content</div>
			</ErrorBoundary>,
		);
		expect(screen.getByText("Normal content")).toBeInTheDocument();
	});

	it("renders fallback UI when a child throws", () => {
		render(
			<ErrorBoundary>
				<ThrowingComponent shouldThrow={true} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();
		expect(screen.getByText("Test render error")).toBeInTheDocument();
		expect(screen.getByText("Try Again")).toBeInTheDocument();
	});

	it("renders custom fallback when provided", () => {
		render(
			<ErrorBoundary fallback={<div>Custom error view</div>}>
				<ThrowingComponent shouldThrow={true} />
			</ErrorBoundary>,
		);
		expect(screen.getByText("Custom error view")).toBeInTheDocument();
		expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
	});

	it("recovers when Try Again is clicked", async () => {
		// Use a mutable ref to control throwing
		let shouldThrow = true;
		function ConditionalThrower() {
			if (shouldThrow) throw new Error("Temporary error");
			return <div>Recovered content</div>;
		}

		const { rerender } = render(
			<ErrorBoundary>
				<ConditionalThrower />
			</ErrorBoundary>,
		);

		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		// Stop throwing and click Try Again
		shouldThrow = false;
		await userEvent.click(screen.getByText("Try Again"));

		// Re-render is needed since ErrorBoundary resets state
		rerender(
			<ErrorBoundary>
				<ConditionalThrower />
			</ErrorBoundary>,
		);

		expect(screen.getByText("Recovered content")).toBeInTheDocument();
	});

	it("shows default message when error has no message property", () => {
		function ThrowNoMessage(): React.ReactElement {
			throw new Error("");
		}
		render(
			<ErrorBoundary>
				<ThrowNoMessage />
			</ErrorBoundary>,
		);
		expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
	});
});
