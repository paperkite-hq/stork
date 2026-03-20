import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupScreen } from "../components/SetupScreen";

vi.mock("../api", () => ({
	api: {
		encryption: {
			setup: vi.fn(),
		},
	},
}));

import { api } from "../api";

const mockSetup = api.encryption.setup as ReturnType<typeof vi.fn>;

const noop = () => {};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("SetupScreen — password step", () => {
	it("renders password creation form", () => {
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		expect(screen.getByText("Set Up Encryption")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("At least 12 characters")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Repeat your password")).toBeInTheDocument();
	});

	it("shows error when passwords do not match", async () => {
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "password123456");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "different123456");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
		expect(mockSetup).not.toHaveBeenCalled();
	});

	it("shows error when password is too short", async () => {
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "short");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "short");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		expect(screen.getByText("Password must be at least 12 characters.")).toBeInTheDocument();
		expect(mockSetup).not.toHaveBeenCalled();
	});

	it("calls api.encryption.setup with the password on valid submit", async () => {
		mockSetup.mockResolvedValue({ recoveryMnemonic: Array(24).fill("word").join(" ") });
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "correctpassword!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "correctpassword!");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		await waitFor(() => expect(mockSetup).toHaveBeenCalledWith("correctpassword!"));
	});

	it("shows error from API on setup failure", async () => {
		mockSetup.mockRejectedValue(new Error("Setup failed"));
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "correctpassword!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "correctpassword!");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		await waitFor(() => expect(screen.getByText("Setup failed")).toBeInTheDocument());
	});
});

describe("SetupScreen — mnemonic step", () => {
	const MNEMONIC = Array(24)
		.fill(null)
		.map((_, i) => `word${i + 1}`)
		.join(" ");

	it("shows recovery phrase after successful setup", async () => {
		mockSetup.mockResolvedValue({ recoveryMnemonic: MNEMONIC });
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "correctpassword!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "correctpassword!");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());
		// First word should be visible
		expect(screen.getByText("word1")).toBeInTheDocument();
	});

	it("continue button is disabled until acknowledgement checkbox is checked", async () => {
		mockSetup.mockResolvedValue({ recoveryMnemonic: MNEMONIC });
		render(<SetupScreen onUnlocked={noop} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "correctpassword!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "correctpassword!");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());
		const continueBtn = screen.getByRole("button", { name: /continue to stork/i });
		expect(continueBtn).toBeDisabled();
	});

	it("calls onUnlocked when acknowledged and continue is clicked", async () => {
		mockSetup.mockResolvedValue({ recoveryMnemonic: MNEMONIC });
		const onUnlocked = vi.fn();
		render(<SetupScreen onUnlocked={onUnlocked} dark={false} onToggleDark={noop} />);
		await userEvent.type(screen.getByPlaceholderText("At least 12 characters"), "correctpassword!");
		await userEvent.type(screen.getByPlaceholderText("Repeat your password"), "correctpassword!");
		await userEvent.click(screen.getByRole("button", { name: /create encrypted vault/i }));
		await waitFor(() => expect(screen.getByText("Save Your Recovery Phrase")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: /continue to stork/i }));
		expect(onUnlocked).toHaveBeenCalledOnce();
	});
});
