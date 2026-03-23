import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordStrengthMeter } from "../PasswordStrengthMeter";

describe("PasswordStrengthMeter", () => {
	it("returns null for empty password", () => {
		const { container } = render(<PasswordStrengthMeter password="" />);
		expect(container.innerHTML).toBe("");
	});

	it("shows Weak for short lowercase password", () => {
		render(<PasswordStrengthMeter password="abc" />);
		expect(screen.getByTestId("password-strength")).toHaveTextContent("Weak");
	});

	it("shows Fair for medium-length mixed-case password", () => {
		// ~9 chars × log2(52) ≈ 51 bits → Fair (40–59)
		render(<PasswordStrengthMeter password="AbCdEfGhI" />);
		expect(screen.getByTestId("password-strength")).toHaveTextContent("Fair");
	});

	it("shows Good for longer mixed password with digits", () => {
		// ~12 chars × log2(62) ≈ 71 bits → Good (60–79)
		render(<PasswordStrengthMeter password="AbCdEf123456" />);
		expect(screen.getByTestId("password-strength")).toHaveTextContent("Good");
	});

	it("shows Strong for long complex password", () => {
		// 16+ chars with all classes → 80+ bits → Strong
		render(<PasswordStrengthMeter password="Str0ng!Pass#2024" />);
		expect(screen.getByTestId("password-strength")).toHaveTextContent("Strong");
	});

	it("renders correct number of filled bars for each strength level", () => {
		// Weak = 1 bar filled
		const { container, rerender } = render(<PasswordStrengthMeter password="ab" />);
		const bars = container.querySelectorAll(".rounded-full");
		expect(bars).toHaveLength(4);
		// First bar should have the strength color, rest should be gray
		const filledBars = container.querySelectorAll(".bg-red-500");
		expect(filledBars.length).toBe(1);

		// Strong = 4 bars filled
		rerender(<PasswordStrengthMeter password="Str0ng!Pass#2024" />);
		const greenBars = container.querySelectorAll(".bg-green-500");
		expect(greenBars.length).toBe(4);
	});

	it("applies correct text color for each level", () => {
		// Weak → red
		const { rerender } = render(<PasswordStrengthMeter password="ab" />);
		expect(screen.getByTestId("password-strength")).toHaveClass("text-red-500");

		// Strong → green
		rerender(<PasswordStrengthMeter password="Str0ng!Pass#2024" />);
		expect(screen.getByTestId("password-strength")).toHaveClass("text-green-500");
	});
});
