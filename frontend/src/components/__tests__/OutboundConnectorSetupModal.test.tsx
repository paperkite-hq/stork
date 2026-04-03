import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboundConnectorSetupModal } from "../OutboundConnectorSetupModal";

// ── Mock API ──────────────────────────────────────────────────────────────

vi.mock("../../api", () => ({
	api: {
		connectors: {
			outbound: {
				create: vi.fn().mockResolvedValue({ id: 42 }),
			},
		},
	},
}));

async function importApi() {
	const mod = await import("../../api");
	return mod.api;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("OutboundConnectorSetupModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── Connector form ─────────────────────────────────────────────────────

	it("renders the connector creation form", () => {
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("Set up outbound email")).toBeInTheDocument();
		expect(screen.getByLabelText("Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Type")).toBeInTheDocument();
	});

	it("shows SMTP fields by default", () => {
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);
		expect(screen.getByLabelText("SMTP Host")).toBeInTheDocument();
		expect(screen.getByLabelText("Username")).toBeInTheDocument();
		expect(screen.getByLabelText("Password")).toBeInTheDocument();
	});

	it("switches to SES fields when type is changed", async () => {
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);
		await userEvent.selectOptions(screen.getByLabelText("Type"), "ses");
		expect(screen.getByLabelText("AWS Region")).toBeInTheDocument();
		expect(screen.queryByLabelText("SMTP Host")).not.toBeInTheDocument();
	});

	it("calls onCancel when Cancel is clicked", async () => {
		const onCancel = vi.fn();
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={onCancel} />);
		await userEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	// ── Connector creation → done ──────────────────────────────────────────

	it("advances directly to done step after connector is saved", async () => {
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);

		await userEvent.type(screen.getByLabelText("Name"), "My SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "user@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "secret");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(screen.getByText("All set!")).toBeInTheDocument();
		});
		// No identity-link step
		expect(screen.queryByText("Link your sending identities")).not.toBeInTheDocument();
	});

	it("calls api.connectors.outbound.create with correct payload for SMTP", async () => {
		const api = await importApi();
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);

		await userEvent.type(screen.getByLabelText("Name"), "Work SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "mail.work.com");
		await userEvent.clear(screen.getByLabelText("Port"));
		await userEvent.type(screen.getByLabelText("Port"), "465");
		await userEvent.type(screen.getByLabelText("Username"), "me@work.com");
		await userEvent.type(screen.getByLabelText("Password"), "hunter2");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(api.connectors.outbound.create).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Work SMTP",
					type: "smtp",
					smtp_host: "mail.work.com",
					smtp_user: "me@work.com",
					smtp_pass: "hunter2",
				}),
			);
		});
	});

	it("calls api.connectors.outbound.create with correct payload for SES", async () => {
		const api = await importApi();
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);

		await userEvent.selectOptions(screen.getByLabelText("Type"), "ses");
		await userEvent.type(screen.getByLabelText("Name"), "My SES");
		await userEvent.type(screen.getByLabelText("AWS Region"), "us-west-2");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(api.connectors.outbound.create).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "My SES",
					type: "ses",
					ses_region: "us-west-2",
				}),
			);
		});
	});

	// ── Done step ──────────────────────────────────────────────────────────

	it("calls onDone when Open compose is clicked on done step", async () => {
		const onDone = vi.fn();
		render(<OutboundConnectorSetupModal onDone={onDone} onCancel={vi.fn()} />);

		await userEvent.type(screen.getByLabelText("Name"), "SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));
		await waitFor(() => screen.getByText("Open compose"));
		await userEvent.click(screen.getByText("Open compose"));

		expect(onDone).toHaveBeenCalledOnce();
	});

	it("calls onCancel when Close is clicked on done step", async () => {
		const onCancel = vi.fn();
		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={onCancel} />);

		await userEvent.type(screen.getByLabelText("Name"), "SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));
		await waitFor(() => screen.getByText("Close"));
		await userEvent.click(screen.getByText("Close"));

		expect(onCancel).toHaveBeenCalledOnce();
	});

	// ── Error handling ─────────────────────────────────────────────────────

	it("shows error message when connector creation fails", async () => {
		const api = await importApi();
		vi.mocked(api.connectors.outbound.create).mockRejectedValueOnce(
			new Error("Connection refused"),
		);

		render(<OutboundConnectorSetupModal onDone={vi.fn()} onCancel={vi.fn()} />);

		await userEvent.type(screen.getByLabelText("Name"), "Bad SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "bad.host");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(screen.getByText("Connection refused")).toBeInTheDocument();
		});
	});
});
