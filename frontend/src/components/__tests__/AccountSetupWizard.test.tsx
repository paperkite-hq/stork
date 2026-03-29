import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSetupWizard } from "../settings/AccountSetupWizard";

const mockInbound = [
	{
		id: 1,
		name: "Existing IMAP",
		type: "imap" as const,
		imap_host: "imap.example.com",
		imap_port: 993,
		imap_tls: 1,
		imap_user: "user@example.com",
		cf_email_webhook_secret: null,
		sync_delete_from_server: 0,
		created_at: "",
		updated_at: "",
	},
];

const mockOutbound = [
	{
		id: 2,
		name: "Existing SMTP",
		type: "smtp" as const,
		smtp_host: "smtp.example.com",
		smtp_port: 587,
		smtp_tls: 1,
		smtp_user: "user@example.com",
		ses_region: null,
		ses_access_key_id: null,
		created_at: "",
		updated_at: "",
	},
];

vi.mock("../../api", () => ({
	api: {
		connectors: {
			inbound: {
				create: vi.fn().mockResolvedValue({ id: 10 }),
			},
			outbound: {
				create: vi.fn().mockResolvedValue({ id: 20 }),
			},
		},
		accounts: {
			create: vi.fn().mockResolvedValue({ id: 99 }),
		},
	},
}));

describe("AccountSetupWizard", () => {
	const onDone = vi.fn();
	const onCancel = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders step 1 initially", () => {
		render(
			<AccountSetupWizard
				existingInbound={[]}
				existingOutbound={[]}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);
		expect(screen.getByText("Add Account")).toBeInTheDocument();
		expect(screen.getByLabelText(/Display Name/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
	});

	it("advances to step 2 after filling account basics", async () => {
		render(
			<AccountSetupWizard
				existingInbound={[]}
				existingOutbound={[]}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: "Work" } });
		fireEvent.change(screen.getByLabelText(/Email Address/i), {
			target: { value: "work@example.com" },
		});
		fireEvent.click(screen.getByText(/Next: Inbound/i));
		await waitFor(() => expect(screen.getByText(/Create new connector/i)).toBeInTheDocument());
	});

	it("shows existing connector option when connectors are available", () => {
		render(
			<AccountSetupWizard
				existingInbound={mockInbound}
				existingOutbound={mockOutbound}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);
		// Fill step 1 and advance
		fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: "Work" } });
		fireEvent.change(screen.getByLabelText(/Email Address/i), {
			target: { value: "work@example.com" },
		});
		fireEvent.click(screen.getByText(/Next: Inbound/i));
		expect(screen.getByText(/Use existing connector/i)).toBeInTheDocument();
	});

	it("calls onCancel when cancel button is clicked on step 1", () => {
		render(
			<AccountSetupWizard
				existingInbound={[]}
				existingOutbound={[]}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);
		fireEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("completes full wizard flow with existing connectors and calls onDone", async () => {
		const { api } = await import("../../api");
		render(
			<AccountSetupWizard
				existingInbound={mockInbound}
				existingOutbound={mockOutbound}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);

		// Step 1: account basics
		fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: "Work" } });
		fireEvent.change(screen.getByLabelText(/Email Address/i), {
			target: { value: "work@example.com" },
		});
		fireEvent.click(screen.getByText(/Next: Inbound/i));

		// Step 2: inbound — use existing (pre-selected)
		await waitFor(() => expect(screen.getByText(/Use existing connector/i)).toBeInTheDocument());
		fireEvent.click(screen.getByText(/Next: Outbound/i));

		// Step 3: outbound — use existing (pre-selected)
		await waitFor(() => expect(screen.getByText(/Review →/i)).toBeInTheDocument());
		fireEvent.click(screen.getByText(/Review →/i));

		// Step 4: review
		await waitFor(() => expect(screen.getByText(/Create Account/i)).toBeInTheDocument());
		expect(screen.getByText(/Work <work@example.com>/i)).toBeInTheDocument();
		fireEvent.click(screen.getByText("Create Account"));

		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
		// No new connectors created — existing ones used
		expect(api.connectors.inbound.create).not.toHaveBeenCalled();
		expect(api.connectors.outbound.create).not.toHaveBeenCalled();
		expect(api.accounts.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Work",
				email: "work@example.com",
				inbound_connector_id: 1,
				outbound_connector_id: 2,
			}),
		);
	});

	it("creates new connectors when new mode selected", async () => {
		const { api } = await import("../../api");
		render(
			<AccountSetupWizard
				existingInbound={[]}
				existingOutbound={[]}
				onDone={onDone}
				onCancel={onCancel}
			/>,
		);

		// Step 1
		fireEvent.change(screen.getByLabelText(/Display Name/i), { target: { value: "Personal" } });
		fireEvent.change(screen.getByLabelText(/Email Address/i), {
			target: { value: "me@example.com" },
		});
		fireEvent.click(screen.getByText(/Next: Inbound/i));

		// Step 2: fill new IMAP connector
		await waitFor(() => expect(screen.getByLabelText(/Connector Name/i)).toBeInTheDocument());
		fireEvent.change(screen.getByLabelText(/Connector Name/i), { target: { value: "My IMAP" } });
		fireEvent.change(screen.getByLabelText(/IMAP Host/i), {
			target: { value: "imap.example.com" },
		});
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "me@example.com" } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "secret" } });
		fireEvent.click(screen.getByText(/Next: Outbound/i));

		// Step 3: skip outbound
		await waitFor(() => expect(screen.getByText(/Skip .receive only./i)).toBeInTheDocument());
		fireEvent.click(screen.getByText(/Review →/i));

		// Step 4
		await waitFor(() => expect(screen.getByText("Create Account")).toBeInTheDocument());
		fireEvent.click(screen.getByText("Create Account"));

		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
		expect(api.connectors.inbound.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: "My IMAP", imap_host: "imap.example.com" }),
		);
		expect(api.connectors.outbound.create).not.toHaveBeenCalled();
		expect(api.accounts.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Personal",
				email: "me@example.com",
				inbound_connector_id: 10,
			}),
		);
	});
});
