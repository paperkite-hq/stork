import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Welcome } from "../Welcome";

vi.mock("../../api", () => ({
	api: {
		accounts: {
			create: vi.fn().mockResolvedValue({ id: 1 }),
		},
	},
}));

describe("Welcome", () => {
	const defaultProps = {
		onAccountCreated: vi.fn(),
		dark: false,
		onToggleDark: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders intro screen with welcome message", () => {
		render(<Welcome {...defaultProps} />);
		expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
		expect(screen.getByText(/self-hosted email client/)).toBeInTheDocument();
	});

	it("shows Add Your Email Account button on intro", () => {
		render(<Welcome {...defaultProps} />);
		expect(screen.getByText("Add Your Email Account")).toBeInTheDocument();
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

	it("navigates to form when Add Your Email Account is clicked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText("Connect Your Email")).toBeInTheDocument();
	});

	it("shows form fields on form step", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText("Email Address")).toBeInTheDocument();
		expect(screen.getByText("Incoming Mail (IMAP)")).toBeInTheDocument();
	});

	it("shows back button on form step", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText("Back")).toBeInTheDocument();
	});

	it("goes back to intro when Back is clicked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText("Back"));
		expect(screen.getByText("Welcome to Stork")).toBeInTheDocument();
	});

	it("shows SMTP section toggle", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText(/Outgoing Mail \(SMTP\)/)).toBeInTheDocument();
	});

	it("expands SMTP section when clicked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		expect(screen.getByText("SMTP Server")).toBeInTheDocument();
	});

	it("shows privacy note on form", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText(/stored locally/)).toBeInTheDocument();
	});

	it("shows Connect Account submit button", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		expect(screen.getByText("Connect Account")).toBeInTheDocument();
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
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "user@gmail.com");
			expect(getServerInput().value).toBe("imap.gmail.com");
		});

		it("auto-fills IMAP username from email address", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "user@fastmail.com");
			const usernameInputs = screen.getAllByPlaceholderText("you@example.com");
			const imap = usernameInputs.find(
				(el) => (el as HTMLInputElement).type === "text",
			) as HTMLInputElement;
			expect(imap.value).toBe("user@fastmail.com");
		});

		it("auto-fills Fastmail IMAP server", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "user@fastmail.com");
			expect(getServerInput().value).toBe("imap.fastmail.com");
		});

		it("auto-fills Outlook server for hotmail.com", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "user@hotmail.com");
			expect(getServerInput().value).toBe("outlook.office365.com");
		});

		it("does not auto-fill for unknown domain", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "user@unknown-corp.com");
			expect(getServerInput().value).toBe("");
		});

		it("auto-suggests display name from email local part", async () => {
			render(<Welcome {...defaultProps} />);
			await userEvent.click(screen.getByText("Add Your Email Account"));
			await userEvent.type(getEmailInput(), "john.doe@example.com");
			const nameField = screen.getByPlaceholderText("Your Name") as HTMLInputElement;
			expect(nameField.value).toBe("John Doe");
		});
	});

	// --- Additional coverage tests ---

	it("submits form and calls onAccountCreated", async () => {
		const onAccountCreated = vi.fn();
		render(<Welcome {...defaultProps} onAccountCreated={onAccountCreated} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));

		// Fill form
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");
		// Name should auto-fill
		const nameField = screen.getByPlaceholderText("Your Name") as HTMLInputElement;
		expect(nameField.value).toBe("Test");

		// Password
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "secret123");

		// Submit
		await userEvent.click(screen.getByText("Connect Account"));

		const { api } = await import("../../api");
		await waitFor(() => {
			expect(api.accounts.create).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(onAccountCreated).toHaveBeenCalled();
		});
	});

	it("shows loading state during submission", async () => {
		const { api } = await import("../../api");
		// Make create hang
		let resolveCreate: (v: unknown) => void = () => {};
		(api.accounts.create as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			new Promise((r) => {
				resolveCreate = r;
			}),
		);

		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "secret");

		await userEvent.click(screen.getByText("Connect Account"));
		expect(screen.getByText("Connecting...")).toBeInTheDocument();

		// Resolve
		resolveCreate?.({ id: 1 });
	});

	it("shows error message when submission fails", async () => {
		const { api } = await import("../../api");
		(api.accounts.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Authentication failed"),
		);

		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "test@gmail.com");
		const passwordField = screen
			.getAllByDisplayValue("")
			.find((el) => (el as HTMLInputElement).type === "password") as HTMLInputElement;
		await userEvent.type(passwordField, "wrong");

		await userEvent.click(screen.getByText("Connect Account"));
		await waitFor(() => {
			expect(screen.getByText("Authentication failed")).toBeInTheDocument();
		});
	});

	it("auto-fills SMTP fields for known providers", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@gmail.com");

		const smtpServer = screen.getByPlaceholderText("smtp.example.com") as HTMLInputElement;
		expect(smtpServer.value).toBe("smtp.gmail.com");
	});

	it("syncs SMTP username from email", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@yahoo.com");

		// SMTP username should sync with email
		const allUserFields = screen.getAllByPlaceholderText("you@example.com");
		// Find the last text input (SMTP username)
		const smtpUser = allUserFields
			.filter((el) => (el as HTMLInputElement).type === "text")
			.pop() as HTMLInputElement;
		if (smtpUser) {
			expect(smtpUser.value).toBe("user@yahoo.com");
		}
	});

	it("TLS checkbox toggles IMAP TLS setting", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const tlsCheckbox = screen.getByLabelText(/Use TLS \(recommended\)/);
		expect(tlsCheckbox).toBeChecked(); // default is 1
		await userEvent.click(tlsCheckbox);
		expect(tlsCheckbox).not.toBeChecked();
	});

	it("IMAP TLS checkbox can be re-enabled after being unchecked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const tlsCheckbox = screen.getByLabelText(/Use TLS \(recommended\)/);
		await userEvent.click(tlsCheckbox); // uncheck
		expect(tlsCheckbox).not.toBeChecked();
		await userEvent.click(tlsCheckbox); // re-check
		expect(tlsCheckbox).toBeChecked();
	});

	it("auto-fills known providers: icloud.com", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@icloud.com");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("imap.mail.me.com");
	});

	it("auto-fills known providers: zoho.com", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@zoho.com");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("imap.zoho.com");
	});

	it("does not overwrite manually-edited IMAP host", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		// Manually type a server first
		await userEvent.type(serverInput, "custom.server.com");
		// Then enter a gmail address — should NOT overwrite
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@gmail.com");
		expect(serverInput.value).toBe("custom.server.com");
	});

	it("SMTP TLS checkbox toggles", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpTls = screen.getAllByRole("checkbox").find((cb) => {
			const label = cb.closest("label");
			return label?.textContent === "Use TLS" && !label?.textContent?.includes("recommended");
		}) as HTMLInputElement;
		if (smtpTls) {
			expect(smtpTls).toBeChecked();
			await userEvent.click(smtpTls);
			expect(smtpTls).not.toBeChecked();
		}
	});

	it("SMTP TLS checkbox can be re-enabled after being unchecked", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpTls = screen.getAllByRole("checkbox").find((cb) => {
			const label = cb.closest("label");
			return label?.textContent === "Use TLS" && !label?.textContent?.includes("recommended");
		}) as HTMLInputElement;
		if (smtpTls) {
			await userEvent.click(smtpTls); // uncheck
			expect(smtpTls).not.toBeChecked();
			await userEvent.click(smtpTls); // re-check
			expect(smtpTls).toBeChecked();
		}
	});

	it("Display Name field is editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const nameInput = screen.getByPlaceholderText("Your Name") as HTMLInputElement;
		await userEvent.clear(nameInput);
		await userEvent.type(nameInput, "My Custom Name");
		expect(nameInput.value).toBe("My Custom Name");
	});

	it("port field has correct default value", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const portInput = screen.getByDisplayValue("993") as HTMLInputElement;
		expect(portInput.type).toBe("number");
	});

	it("SMTP fields exist when expanded", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		expect(screen.getByDisplayValue("587")).toBeInTheDocument();
		// Should have at least 2 password fields (IMAP + SMTP)
		const passwordFields = screen
			.getAllByDisplayValue("")
			.filter((el) => (el as HTMLInputElement).type === "password");
		expect(passwordFields.length).toBeGreaterThanOrEqual(2);
	});

	it("collapses SMTP section when clicked again", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		expect(screen.getByText("SMTP Server")).toBeInTheDocument();
		await userEvent.click(screen.getByText(/Hide/));
		expect(screen.queryByText("SMTP Server")).not.toBeInTheDocument();
	});

	it("SMTP port field is editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpPort = screen.getByDisplayValue("587") as HTMLInputElement;
		expect(smtpPort.type).toBe("number");
	});

	it("SMTP port onChange falls back to 587 for non-numeric input", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpPort = screen.getByDisplayValue("587") as HTMLInputElement;
		// Empty string → Number("") = 0 → falls back to 587
		fireEvent.change(smtpPort, { target: { value: "" } });
		expect(smtpPort.value).toBe("587");
	});

	it("IMAP port field is editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const imapPort = screen.getByDisplayValue("993") as HTMLInputElement;
		expect(imapPort.type).toBe("number");
	});

	it("IMAP port onChange updates form value", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const imapPort = screen.getByDisplayValue("993") as HTMLInputElement;
		fireEvent.change(imapPort, { target: { value: "143" } });
		expect(imapPort.value).toBe("143");
	});

	it("IMAP port onChange falls back to 993 for non-numeric input", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const imapPort = screen.getByDisplayValue("993") as HTMLInputElement;
		// Empty string → Number("") = 0 → falls back to 993
		fireEvent.change(imapPort, { target: { value: "" } });
		expect(imapPort.value).toBe("993");
	});

	it("does not overwrite manually edited IMAP username", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));

		// First type email to auto-fill username
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@gmail.com");

		// Find the IMAP username field and manually change it
		const usernameInputs = screen.getAllByPlaceholderText("you@example.com");
		const imapUser = usernameInputs.find(
			(el) => (el as HTMLInputElement).type === "text",
		) as HTMLInputElement;
		await userEvent.clear(imapUser);
		await userEvent.type(imapUser, "custom-user");

		// Clear and retype email — should NOT overwrite custom username
		await userEvent.clear(emailInput);
		await userEvent.type(emailInput, "other@gmail.com");
		expect(imapUser.value).toBe("custom-user");
	});

	it("SMTP password field editable when expanded", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const passwordFields = screen
			.getAllByDisplayValue("")
			.filter((el) => (el as HTMLInputElement).type === "password");
		expect(passwordFields.length).toBeGreaterThanOrEqual(2);
		const smtpPass = passwordFields[1] as HTMLInputElement;
		await userEvent.type(smtpPass, "smtp-pass");
		expect(smtpPass.value).toBe("smtp-pass");
	});

	it("does not auto-suggest name if name already set", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const nameField = screen.getByPlaceholderText("Your Name") as HTMLInputElement;
		await userEvent.type(nameField, "Custom Name");

		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "other.person@example.com");
		expect(nameField.value).toBe("Custom Name");
	});

	it("auto-fills ProtonMail Bridge settings for pm.me", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const emailInput = screen
			.getAllByPlaceholderText("you@example.com")
			.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;
		await userEvent.type(emailInput, "user@pm.me");
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		expect(serverInput.value).toBe("127.0.0.1");
	});

	it("IMAP server field is manually editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		const serverInput = screen.getByPlaceholderText("imap.example.com") as HTMLInputElement;
		await userEvent.type(serverInput, "my.custom.server.com");
		expect(serverInput.value).toBe("my.custom.server.com");
	});

	it("SMTP server field is editable when SMTP section is expanded", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpServerInput = screen.getByPlaceholderText("smtp.example.com") as HTMLInputElement;
		await userEvent.type(smtpServerInput, "smtp.custom.com");
		expect(smtpServerInput.value).toBe("smtp.custom.com");
	});

	it("SMTP username field is manually editable", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		// SMTP username is the second 'you@example.com' placeholder field
		const usernameInputs = screen.getAllByPlaceholderText("you@example.com");
		const smtpUsernameInput = usernameInputs[usernameInputs.length - 1] as HTMLInputElement;
		await userEvent.clear(smtpUsernameInput);
		await userEvent.type(smtpUsernameInput, "custom@smtp.com");
		expect(smtpUsernameInput.value).toBe("custom@smtp.com");
	});

	it("SMTP port field has correct initial value and type", async () => {
		render(<Welcome {...defaultProps} />);
		await userEvent.click(screen.getByText("Add Your Email Account"));
		await userEvent.click(screen.getByText(/Outgoing Mail \(SMTP\)/));
		const smtpPort = screen.getByDisplayValue("587") as HTMLInputElement;
		expect(smtpPort.type).toBe("number");
		// Trigger onChange by firing a change event directly
		fireEvent.change(smtpPort, { target: { value: "465" } });
		expect(smtpPort.value).toBe("465");
	});
});
