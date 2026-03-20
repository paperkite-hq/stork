import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockScreen } from "../components/UnlockScreen";

vi.mock("../api", () => ({
	api: {
		encryption: {
			unlock: vi.fn(),
		},
	},
}));

import { api } from "../api";

const mockUnlock = api.encryption.unlock as ReturnType<typeof vi.fn>;

const noop = () => {};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("UnlockScreen — password mode", () => {
	it("renders unlock form", () => {
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Your encryption password")).toBeInTheDocument();
	});

	it("calls api.encryption.unlock with password on submit", async () => {
		mockUnlock.mockResolvedValue({ ok: true });
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("Your encryption password"), "mypassword123!");
		await userEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
		await waitFor(() => expect(mockUnlock).toHaveBeenCalledWith({ password: "mypassword123!" }));
	});

	it("calls onUnlocked after successful unlock", async () => {
		mockUnlock.mockResolvedValue({ ok: true });
		const onUnlocked = vi.fn();
		render(<UnlockScreen onUnlocked={onUnlocked} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("Your encryption password"), "mypassword123!");
		await userEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
		await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
	});

	it("shows error on wrong password", async () => {
		mockUnlock.mockRejectedValue(new Error("Invalid password or recovery key"));
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("Your encryption password"), "wrongpassword!");
		await userEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
		await waitFor(() => expect(screen.getByText("Incorrect password.")).toBeInTheDocument());
	});
});

describe("UnlockScreen — recovery mode", () => {
	it("switches to recovery mode when link is clicked", async () => {
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.click(screen.getByText(/forgot password/i));
		expect(screen.getByText("Recover Access")).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/word1 word2/i)).toBeInTheDocument();
	});

	it("shows password mismatch error in recovery mode", async () => {
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.click(screen.getByText(/forgot password/i));
		await userEvent.type(
			screen.getByPlaceholderText(/word1 word2/i),
			Array(24).fill("word").join(" "),
		);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your new password"), "different123!");
		await userEvent.click(screen.getByRole("button", { name: /recover & unlock/i }));
		expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
		expect(mockUnlock).not.toHaveBeenCalled();
	});

	it("calls api.encryption.unlock with recoveryMnemonic and newPassword", async () => {
		mockUnlock.mockResolvedValue({ ok: true });
		const MNEMONIC = Array(24).fill("word").join(" ");
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.click(screen.getByText(/forgot password/i));
		await userEvent.type(screen.getByPlaceholderText(/word1 word2/i), MNEMONIC);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "newpassword123!");
		await userEvent.type(
			screen.getByPlaceholderText("Repeat your new password"),
			"newpassword123!",
		);
		await userEvent.click(screen.getByRole("button", { name: /recover & unlock/i }));
		await waitFor(() =>
			expect(mockUnlock).toHaveBeenCalledWith({
				recoveryMnemonic: MNEMONIC,
				newPassword: "newpassword123!",
			}),
		);
	});

	it("switches back to password mode with back link", async () => {
		render(<UnlockScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.click(screen.getByText(/forgot password/i));
		expect(screen.getByText("Recover Access")).toBeInTheDocument();
		await userEvent.click(screen.getByText(/back to password unlock/i));
		expect(screen.getByText("Unlock Stork")).toBeInTheDocument();
	});
});
