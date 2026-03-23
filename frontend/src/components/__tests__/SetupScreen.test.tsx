import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupScreen } from "../SetupScreen";

vi.mock("../../api", () => ({
	api: {
		encryption: {
			setup: vi.fn().mockResolvedValue({ recoveryMnemonic: "word ".repeat(24).trim() }),
		},
	},
}));

describe("SetupScreen", () => {
	const defaultProps = {
		onUnlocked: vi.fn(),
		dark: false,
		onToggleDark: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders password form with encryption heading", () => {
		render(<SetupScreen {...defaultProps} />);
		expect(screen.getByText("Set Up Encryption")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("At least 12 characters")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Repeat your password")).toBeInTheDocument();
	});

	it("shows dark mode toggle in light mode", () => {
		render(<SetupScreen {...defaultProps} dark={false} />);
		expect(screen.getByTitle("Toggle dark mode")).toBeInTheDocument();
		expect(screen.getByText("Dark")).toBeInTheDocument();
	});

	it("shows light mode toggle when dark mode is active", () => {
		render(<SetupScreen {...defaultProps} dark={true} />);
		expect(screen.getByText("Light")).toBeInTheDocument();
	});

	it("calls onToggleDark when toggle button clicked", async () => {
		const onToggleDark = vi.fn();
		render(<SetupScreen {...defaultProps} onToggleDark={onToggleDark} />);
		await userEvent.click(screen.getByTitle("Toggle dark mode"));
		expect(onToggleDark).toHaveBeenCalledOnce();
	});

	it("shows error when passwords do not match", async () => {
		render(<SetupScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "differentpass1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
	});

	it("shows error when password is too short", async () => {
		render(<SetupScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "short");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "short");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		expect(screen.getByText("Password must be at least 12 characters.")).toBeInTheDocument();
	});

	it("calls setup API and shows mnemonic on success", async () => {
		const { api } = await import("../../api");
		render(<SetupScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "validpassword1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		await waitFor(() => expect(api.encryption.setup).toHaveBeenCalledWith("validpassword1!"));
		expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument();
		expect(screen.getByText("Recovery Phrase")).toBeInTheDocument();
		// Should show 24 words
		expect(screen.getByText("1.")).toBeInTheDocument();
		expect(screen.getByText("24.")).toBeInTheDocument();
	});

	it("shows API error on setup failure", async () => {
		const { api } = await import("../../api");
		(api.encryption.setup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Server error"),
		);
		render(<SetupScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "validpassword1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
	});

	it("disables Continue button until acknowledgement checkbox is checked", async () => {
		const { api } = await import("../../api");
		(api.encryption.setup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			recoveryMnemonic:
				"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray",
		});
		const onUnlocked = vi.fn();
		render(<SetupScreen {...defaultProps} onUnlocked={onUnlocked} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "validpassword1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());

		// Continue button should be disabled
		const continueBtn = screen.getByRole("button", { name: "Continue to Stork" });
		expect(continueBtn).toBeDisabled();

		// Check acknowledgement
		await userEvent.click(screen.getByRole("checkbox"));
		expect(continueBtn).toBeEnabled();

		// Click Continue
		await userEvent.click(continueBtn);
		expect(onUnlocked).toHaveBeenCalledOnce();
	});

	it("shows loading state during setup", async () => {
		const { api } = await import("../../api");
		let resolveSetup: ((value: { recoveryMnemonic: string }) => void) | undefined;
		(api.encryption.setup as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSetup = resolve;
			}),
		);
		render(<SetupScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "validpassword1!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "validpassword1!");
		await userEvent.click(screen.getByRole("button", { name: "Create Encrypted Vault" }));

		expect(screen.getByText("Setting up…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Setting up…" })).toBeDisabled();

		// Resolve
		resolveSetup?.({ recoveryMnemonic: "word ".repeat(24).trim() });
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());
	});

	// Password strength meter tests (entropy-based scoring)
	describe("password strength indicator", () => {
		it("shows no strength indicator when password is empty", () => {
			render(<SetupScreen {...defaultProps} />);
			expect(screen.queryByTestId("password-strength")).not.toBeInTheDocument();
		});

		it("shows Weak for short password", async () => {
			render(<SetupScreen {...defaultProps} />);
			await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "abc");
			expect(screen.getByTestId("password-strength")).toHaveTextContent("Weak");
		});

		it("shows Fair for 12-char lowercase password", async () => {
			render(<SetupScreen {...defaultProps} />);
			// 12 * log2(26) ≈ 56 bits → Fair
			await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "abcdefghijkl");
			expect(screen.getByTestId("password-strength")).toHaveTextContent("Fair");
		});

		it("shows Good for 16-char lowercase password", async () => {
			render(<SetupScreen {...defaultProps} />);
			// 16 * log2(26) ≈ 75 bits → Good
			await userEvent.type(
				screen.getByPlaceholderText("At least 12 characters"),
				"abcdefghijklmnop",
			);
			expect(screen.getByTestId("password-strength")).toHaveTextContent("Good");
		});

		it("shows Strong for long passphrase", async () => {
			render(<SetupScreen {...defaultProps} />);
			// 28 chars with spaces → pool 59, 28 * log2(59) ≈ 164 bits → Strong
			await userEvent.type(
				screen.getByPlaceholderText("At least 12 characters"),
				"correct horse battery staple",
			);
			expect(screen.getByTestId("password-strength")).toHaveTextContent("Strong");
		});
	});
});
