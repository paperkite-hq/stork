import { render, screen } from "@testing-library/react";
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
		// The toggle button contains <SunIcon /> (title="Light mode") + text " Light"
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
		// Email Address field has type="email"; IMAP Username has type="text" — same placeholder
		const getEmailInput = () =>
			screen
				.getAllByPlaceholderText("you@example.com")
				.find((el) => (el as HTMLInputElement).type === "email") as HTMLInputElement;

		// IMAP Server field has a unique placeholder "imap.example.com"
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
			// IMAP username field is the second input with this placeholder (type="text")
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
			// Name should be suggested as "John Doe" (dots/dashes → spaces, title-cased)
			const nameField = screen.getByPlaceholderText("Your Name") as HTMLInputElement;
			expect(nameField.value).toBe("John Doe");
		});
	});
});
