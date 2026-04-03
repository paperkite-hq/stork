import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Welcome } from "../Welcome";

vi.mock("../../api", () => ({
	api: {
		connectors: {
			inbound: {
				create: vi.fn().mockResolvedValue({ id: 1 }),
			},
		},
		identities: {
			create: vi.fn().mockResolvedValue({ id: 1 }),
		},
	},
}));

describe("Welcome", () => {
	const defaultProps = {
		onSetupComplete: vi.fn(),
		dark: false,
		onToggleDark: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders intro screen with welcome message", () => {
		render(<Welcome {...defaultProps} />);
		expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
		expect(screen.getByText(/encrypted/i)).toBeInTheDocument();
	});

	it("shows Get Started button on intro", () => {
		render(<Welcome {...defaultProps} />);
		expect(screen.getByText("Get Started")).toBeInTheDocument();
	});

	it("shows dark mode toggle", () => {
		render(<Welcome {...defaultProps} />);
		expect(screen.getByTitle("Toggle dark mode")).toBeInTheDocument();
	});

	it("shows light mode label when dark is true", () => {
		render(<Welcome {...defaultProps} dark={true} />);
		expect(screen.getByTitle("Toggle dark mode")).toHaveTextContent(/Light/);
	});

	it("shows dark mode label when dark is false", () => {
		render(<Welcome {...defaultProps} dark={false} />);
		expect(screen.getByTitle("Toggle dark mode")).toHaveTextContent(/Dark/);
	});

	it("calls onToggleDark when toggle is clicked", async () => {
		const onToggleDark = vi.fn();
		render(<Welcome {...defaultProps} onToggleDark={onToggleDark} />);
		await userEvent.click(screen.getByTitle("Toggle dark mode"));
		expect(onToggleDark).toHaveBeenCalledOnce();
	});

	it("navigates to form when Get Started is clicked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText("Connect Your Email")).toBeInTheDocument();
	});

	it("shows IMAP form fields by default on form step", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText("Email Address")).toBeInTheDocument();
		expect(screen.getByText("Incoming Mail (IMAP)")).toBeInTheDocument();
	});

	it("shows connector type selector with IMAP and Cloudflare R2 options", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText("IMAP")).toBeInTheDocument();
		expect(screen.getByText("Cloudflare R2")).toBeInTheDocument();
	});

	it("shows Cloudflare R2 form when that type is selected", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		await userEvent.click(screen.getByText("Cloudflare R2"));
		expect(screen.getByText("Cloudflare R2 queue/poll model")).toBeInTheDocument();
		expect(screen.getByText("Account ID")).toBeInTheDocument();
	});

	it("shows back button on form step", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText("Back")).toBeInTheDocument();
	});

	it("goes back to intro when Back is clicked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		await userEvent.click(screen.getByText("Back"));
		expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
	});

	it("does not show SMTP section on form", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.queryByText(/Outgoing Mail \(SMTP\)/)).not.toBeInTheDocument();
	});

	it("shows privacy note on form", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText(/stored encrypted/)).toBeInTheDocument();
	});

	it("shows note about outgoing mail in settings", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText(/Outgoing mail can be configured in Settings/)).toBeInTheDocument();
	});

	it("shows Connect Email submit button", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.getByText("Connect Email")).toBeInTheDocument();
	});

	it("does not show Display Name field", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		expect(screen.queryByText("Display Name")).not.toBeInTheDocument();
		expect(screen.queryByPlaceholderText("Your Name")).not.toBeInTheDocument();
	});

	describe("auto-fill for known providers", () => {
		const getEmailInput = () =>
			screen
				.getAllByPlaceholderText("you@example.com")
				.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;

		const getServerInput = () =>
			screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;

		it("auto-fills Gmail IMAP server when gmail.com email is entered", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Get Started"));
			await userEvent.type(getEmailInput(), "user@gmail.com");
			expect(getServerInput().value).toBe("imap.gmail.com");
		});

		it("auto-fills IMAP username from email address", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Get Started"));
			await userEvent.type(getEmailInput(), "user@fastmail.com");
			const usernameInputs = screen.getAllByPlaceholderText("you@example.com");
			const imap = usernameInputs.find(
				(el) => (el as HTMLInputElement).type === "text",
			) as HTMLInputElement;
			expect(imap.value).toBe("user@fastmail.com");
		});

		it("auto-fills Fastmail IMAP server", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Get Started"));
			await userEvent.type(getEmailInput(), "user@fastmail.com");
			expect(getServerInput().value).toBe("imap.fastmail.com");
		});

		it("auto-fills Outlook server for hotmail.com", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Get Started"));
			await userEvent.type(getEmailInput(), "user@hotmail.com");
			expect(getServerInput().value).toBe("outlook.office365.com");
		});

		it("does not auto-fill for unknown domain", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Get Started"));
			await userEvent.type(getEmailInput(), "user@unknown-corp.com");
			expect(getServerInput().value).toBe("");
		});
	});

	it("submits form and calls onSetupComplete", async () => {
		const onSetupComplete = vi.fn();
		render(<Welcome {...defaultProps} onSetupComplete={onSetupComplete} />);
		await userEvent.click(screen.getByText("Get Started"));

		// Fill email (auto-fills IMAP username)
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");

		// IMAP server auto-filled; password still needed
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "secret123");

		await userEvent.click(screen.getByText("Connect Email"));

		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.connectors.inbound.create).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(api.identities.create).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(onSetupComplete).toHaveBeenCalled();
		});
	});

	it("shows loading state during submission", async () => {
		const { api } = await import("../../api");
		let resolveCreate: (v: unknown) => void = () => {};
		(api.connectors.inbound.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((r) => {
				resolveCreate = r;
			}),
		);

		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "secret");

		await userEvent.click(screen.getByText("Connect Email"));
		expect(screen.getByText("Connecting...")).toBeInTheDocument();

		resolveCreate?.({ id: 1 });
	});

	it("shows error message when submission fails", async () => {
		const { api } = await import("../../api");
		(api.connectors.inbound.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Authentication failed"),
		);

		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "wrong");

		await userEvent.click(screen.getByText("Connect Email"));
		await waitFor(() => {
			expect(screen.getByText("Authentication failed")).toBeInTheDocument();
		});
	});

	it("TLS checkbox toggles IMAP TLS setting", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const tlsCheckbox = screen.getByLabelText(/Use TLS \(recommended\)/);
		expect(tlsCheckbox).toBeChecked();
		await userEvent.click(tlsCheckbox);
		expect(tlsCheckbox).not.toBeChecked();
	});

	it("IMAP TLS checkbox can be re-enabled after being unchecked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const tlsCheckbox = screen.getByLabelText(/Use TLS \(recommended\)/);
		await userEvent.click(tlsCheckbox);
		expect(tlsCheckbox).not.toBeChecked();
		await userEvent.click(tlsCheckbox);
		expect(tlsCheckbox).toBeChecked();
	});

	it("port field has correct default value", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const portInput = screen.getByDisplayValue("993") as HTMLInputElement;
		expect(portInput.type).toBe("number");
	});

	it("IMAP port onChange updates form value", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const imapPort = screen.getByDisplayValue("993") as HTMLInputElement;
		fireEvent.change(imapPort, { target: { value: "143" } });
		expect(imapPort.value).toBe("143");
	});

	it("IMAP port onChange falls back to 993 for non-numeric input", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const imapPort = screen.getByDisplayValue("993") as HTMLInputElement;
		fireEvent.change(imapPort, { target: { value: "" } });
		expect(imapPort.value).toBe("993");
	});

	it("auto-fills known providers: icloud.com", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@icloud.com");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("imap.mail.me.com");
	});

	it("auto-fills known providers: zoho.com", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@zoho.com");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("imap.zoho.com");
	});

	it("does not overwrite manually-edited IMAP host", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		await userEvent.type(serverInput, "custom.server.com");
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@gmail.com");
		expect(serverInput.value).toBe("custom.server.com");
	});

	it("does not overwrite manually edited IMAP username", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@gmail.com");

		const usernameInputs = screen.getAllByPlaceholderText("you@example.com");
		const imapUser = usernameInputs.find(
			(el) => (el as HTMLInputElement).type === "text",
		) as HTMLInputElement;
		await userEvent.clear(imapUser);
		await userEvent.type(imapUser, "custom-user");

		await userEvent.clear(emailInput);
		await userEvent.type(emailInput, "other@gmail.com");
		expect(imapUser.value).toBe("custom-user");
	});

	it("auto-fills ProtonMail Bridge settings for pm.me", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@pm.me");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("127.0.0.1");
	});

	it("IMAP server field is manually editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Get Started"));
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		await userEvent.type(serverInput, "my.custom.server.com");
		expect(serverInput.value).toBe("my.custom.server.com");
	});
});
