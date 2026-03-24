import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockScreen } from "../UnlockScreen";

vi.mock("../../api", () => ({
	api: {
		encryption: {
			unlock: vi.fn().mockResolvedValue({ ok: true }),
		},
	},
}));

describe("UnlockScreen", () => {
	const defaultProps = {
		onUnlocked: vi.fn(),
		dark: false,
		onToggleDark: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders unlock form with password input", () => {
		render(<UnlockScreen {...defaultProps} />);
		expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Your encryption password")).toBeInTheDocument();
	});

	it("shows dark mode toggle in light mode", () => {
		render(<UnlockScreen {...defaultProps} dark={false} />);
		expect(screen.getByTitle("Toggle dark mode")).toBeInTheDocument();
		expect(screen.getByText("Dark")).toBeInTheDocument();
	});

	it("shows light mode toggle when dark mode is active", () => {
		render(<UnlockScreen {...defaultProps} dark={true} />);
		expect(screen.getByText("Light")).toBeInTheDocument();
	});

	it("calls onToggleDark when toggle button clicked", async () => {
		const onToggleDark = vi.fn();
		render(<UnlockScreen {...defaultProps} onToggleDark={onToggleDark} />);
		await userEvent.click(screen.getByTitle("Toggle dark mode"));
		expect(onToggleDark).toHaveBeenCalledOnce();
	});

	it("calls unlock API with password and triggers onUnlocked", async () => {
		const { api } = await import("../../api");
		const onUnlocked = vi.fn();
		render(<UnlockScreen {...defaultProps} onUnlocked={onUnlocked} />);
		await userEvent.type(screen.getByPlaceholderText("Your encryption password"), "mypassword123!");
		await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
		await waitFor(() =>
			expect(api.encryption.unlock).toHaveBeenCalledWith({ password: "mypassword123!" }),
		);
		expect(onUnlocked).toHaveBeenCalledOnce();
	});

	it("shows error on unlock failure", async () => {
		const { api } = await import("../../api");
		(api.encryption.unlock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("bad"));
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.type(screen.getByPlaceholderText("Your encryption password"), "wrong");
		await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
		await waitFor(() => expect(screen.getByText("Incorrect password.")).toBeInTheDocument());
	});

	it("switches to recovery mode", async () => {
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		expect(screen.getByText("Recover Access")).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/24 words/)).toBeInTheDocument();
		expect(screen.getByPlaceholderText("At least 12 characters")).toBeInTheDocument();
	});

	it("switches back from recovery mode", async () => {
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		expect(screen.getByText("Recover Access")).toBeInTheDocument();
		await userEvent.click(screen.getByText("← Back to password unlock"));
		expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
	});

	it("shows error when recovery passwords don't match", async () => {
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		await userEvent.type(screen.getByPlaceholderText(/24 words/), "word ".repeat(24).trim());
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"different12345!",
		);
		await userEvent.click(screen.getByRole("button", { name: "Recover & Unlock" }));
		expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
	});

	it("shows error when recovery new password is too short", async () => {
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		await userEvent.type(screen.getByPlaceholderText(/24 words/), "word ".repeat(24).trim());
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "short");
		await userEvent.type(screen.getByPlaceholderText("Repeat your new password"), "short");
		await userEvent.click(screen.getByRole("button", { name: "Recover & Unlock" }));
		expect(screen.getByText("New password must be at least 12 characters.")).toBeInTheDocument();
	});

	it("calls unlock API with recovery mnemonic and new password", async () => {
		const { api } = await import("../../api");
		const onUnlocked = vi.fn();
		render(<UnlockScreen {...defaultProps} onUnlocked={onUnlocked} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		const mnemonic = "word ".repeat(24).trim();
		await userEvent.type(screen.getByPlaceholderText(/24 words/), mnemonic);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"newpassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: "Recover & Unlock" }));
		await waitFor(() =>
			expect(api.encryption.unlock).toHaveBeenCalledWith({
				recoveryMnemonic: mnemonic,
				newPassword: "newpassword123!",
			}),
		);
		expect(onUnlocked).toHaveBeenCalledOnce();
	});

	it("shows recovery mode error on API failure", async () => {
		const { api } = await import("../../api");
		(api.encryption.unlock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("bad"));
		render(<UnlockScreen {...defaultProps} />);
		await userEvent.click(screen.getByText("Forgot password? Use recovery phrase"));
		await userEvent.type(screen.getByPlaceholderText(/24 words/), "word ".repeat(24).trim());
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"newpassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: "Recover & Unlock" }));
		await waitFor(() =>
			expect(screen.getByText("Invalid recovery phrase or password.")).toBeInTheDocument(),
		);
	});

	it("shows countdown after multiple failed attempts", async () => {
		const { api } = await import("../../api");
		(api.encryption.unlock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bad"));
		render(<UnlockScreen {...defaultProps} />);

		const getForm = () => {
			const input = screen.getByPlaceholderText("Your encryption password");
			const form = input.closest("form");
			if (!form) throw new Error("Form not found");
			return { input, form };
		};

		// First failed attempt — sets failedAttempts to 1 (delay = 1s)
		const { input, form } = getForm();
		fireEvent.change(input, { target: { value: "wrong" } });
		fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText("Incorrect password.")).toBeInTheDocument());

		// Second failed attempt — delay = 2s, countdown shown
		fireEvent.submit(form);
		await waitFor(() => {
			const countdown = screen.queryByTestId("rate-limit-countdown");
			expect(countdown).not.toBeNull();
		});
	});

	it("countdown timer decrements each second", async () => {
		const { api } = await import("../../api");
		(api.encryption.unlock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bad"));
		render(<UnlockScreen {...defaultProps} />);

		const input = screen.getByPlaceholderText("Your encryption password");
		const form = input.closest("form");
		if (!form) throw new Error("Form not found");

		// Two failures to trigger a 2s countdown
		fireEvent.change(input, { target: { value: "wrong" } });
		fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText("Incorrect password.")).toBeInTheDocument());
		fireEvent.submit(form);
		await waitFor(() => expect(screen.queryByTestId("rate-limit-countdown")).not.toBeNull());

		const countdownEl = screen.getByTestId("rate-limit-countdown");
		// The countdown value should start at 2
		expect(countdownEl.textContent).toMatch(/2/);

		// Wait for the timer to actually decrement (real timers)
		await waitFor(
			() => {
				expect(countdownEl.textContent).toMatch(/[01]/);
			},
			{ timeout: 2500 },
		);
	});
});
