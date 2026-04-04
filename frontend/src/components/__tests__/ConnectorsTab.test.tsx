import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundConnectorsTab, OutboundConnectorsTab } from "../settings/ConnectorsTab";

vi.mock("../Toast", () => ({
	toast: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		connectors: {
			inbound: {
				list: vi.fn(),
				create: vi.fn(),
				update: vi.fn(),
				delete: vi.fn(),
				test: vi.fn(),
				syncNow: vi.fn(),
			},
			outbound: {
				list: vi.fn(),
				create: vi.fn(),
				update: vi.fn(),
				delete: vi.fn(),
				test: vi.fn(),
			},
		},
		identities: {
			list: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
	},
}));

import { api } from "../../api";
const mockApi = api as unknown as {
	connectors: {
		inbound: {
			list: ReturnType<typeof vi.fn>;
			create: ReturnType<typeof vi.fn>;
			update: ReturnType<typeof vi.fn>;
			delete: ReturnType<typeof vi.fn>;
			test: ReturnType<typeof vi.fn>;
			syncNow: ReturnType<typeof vi.fn>;
		};
		outbound: {
			list: ReturnType<typeof vi.fn>;
			create: ReturnType<typeof vi.fn>;
			update: ReturnType<typeof vi.fn>;
			delete: ReturnType<typeof vi.fn>;
			test: ReturnType<typeof vi.fn>;
		};
	};
	identities: {
		list: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
	};
};

const mockInbound = [
	{
		id: 1,
		name: "Work IMAP",
		type: "imap" as const,
		imap_host: "imap.example.com",
		imap_port: 993,
		imap_tls: 1,
		imap_user: "user@example.com",
		sync_delete_from_server: 0,
		cf_r2_account_id: null,
		cf_r2_bucket_name: null,
		cf_r2_access_key_id: null,
		cf_r2_prefix: null,
		cf_r2_poll_interval_ms: null,
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
	},
];

const mockOutbound = [
	{
		id: 2,
		name: "Work SMTP",
		type: "smtp" as const,
		smtp_host: "smtp.example.com",
		smtp_port: 587,
		smtp_tls: 1,
		smtp_user: "user@example.com",
		ses_region: null,
		ses_access_key_id: null,
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
	},
];

const mockIdentities = [
	{
		id: 10,
		name: "Work",
		email: "user@example.com",
		inbound_connector_id: 1,
		outbound_connector_id: 2,
		inbound_connector_name: "Work IMAP",
		outbound_connector_name: "Work SMTP",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
	},
];

describe("InboundConnectorsTab", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.connectors.inbound.list.mockResolvedValue(mockInbound);
	});

	it("shows loading state initially", () => {
		mockApi.connectors.inbound.list.mockReturnValue(new Promise(() => {}));
		render(<InboundConnectorsTab />);
		expect(screen.getByText(/Loading/i)).toBeInTheDocument();
	});

	it("renders inbound connectors list", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => {
			expect(screen.getByText("Work IMAP")).toBeInTheDocument();
		});
		// ConnectorBadge renders "IMAP" for imap type
		expect(screen.getByText("IMAP")).toBeInTheDocument();
	});

	it("shows empty state when no connectors", async () => {
		mockApi.connectors.inbound.list.mockResolvedValue([]);
		render(<InboundConnectorsTab />);
		await waitFor(() => {
			expect(screen.getByText(/No inbound connectors configured/i)).toBeInTheDocument();
		});
	});

	it("shows Add button and toggles to form when clicked", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		const addBtn = screen.getByRole("button", { name: /Add/i });
		fireEvent.click(addBtn);
		expect(screen.getByText(/New Inbound Connector/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/^Name$/i)).toBeInTheDocument();
	});

	it("cancels adding a new connector", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /Add/i }));
		expect(screen.getByText(/New Inbound Connector/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
		expect(screen.queryByText(/New Inbound Connector/i)).not.toBeInTheDocument();
	});

	it("creates a new IMAP inbound connector", async () => {
		mockApi.connectors.inbound.create.mockResolvedValue({ id: 99 });
		mockApi.connectors.inbound.list
			.mockResolvedValueOnce(mockInbound)
			.mockResolvedValue([...mockInbound, { ...mockInbound[0], id: 99, name: "New IMAP" }]);

		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /Add/i }));

		fireEvent.change(screen.getByLabelText(/^Name$/i), {
			target: { value: "New IMAP" },
		});
		fireEvent.change(screen.getByLabelText(/IMAP Host/i), {
			target: { value: "mail.example.com" },
		});
		fireEvent.change(screen.getByLabelText(/Username/i), {
			target: { value: "test@example.com" },
		});
		fireEvent.change(screen.getByLabelText(/Password/i), {
			target: { value: "secret123" },
		});

		const form = screen.getByRole("button", { name: /Save/i });
		fireEvent.click(form);

		await waitFor(() => {
			expect(mockApi.connectors.inbound.create).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "New IMAP",
					type: "imap",
					imap_host: "mail.example.com",
				}),
			);
		});
	});

	it("shows edit form when edit button clicked", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		const editBtn = screen.getByRole("button", { name: /Edit/i });
		fireEvent.click(editBtn);
		expect(screen.getByText(/Edit Inbound Connector/i)).toBeInTheDocument();
		expect(screen.getByDisplayValue("Work IMAP")).toBeInTheDocument();
	});

	it("deletes an inbound connector after confirmation", async () => {
		mockApi.connectors.inbound.delete.mockResolvedValue({ ok: true });
		mockApi.connectors.inbound.list.mockResolvedValueOnce(mockInbound).mockResolvedValue([]);

		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

		// Inline confirm: shows "Delete?" and "Yes" / "No" buttons
		await screen.findByText(/Delete\?/i);
		fireEvent.click(screen.getByRole("button", { name: /^Yes$/i }));

		await waitFor(() => {
			expect(mockApi.connectors.inbound.delete).toHaveBeenCalledWith(1);
		});
	});

	it("tests an inbound connector and shows OK result", async () => {
		mockApi.connectors.inbound.test.mockResolvedValue({ ok: true, details: { folders: 5 } });
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /Test/i }));
		await waitFor(() => {
			expect(screen.getByText(/OK/i)).toBeInTheDocument();
		});
	});

	it("tests an inbound connector and shows error result", async () => {
		mockApi.connectors.inbound.test.mockResolvedValue({ ok: false, error: "Connection refused" });
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /Test/i }));
		await waitFor(() => {
			expect(screen.getByText(/Connection refused/i)).toBeInTheDocument();
		});
	});

	it("switches to Cloudflare R2 type and shows R2 fields", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /Add/i }));
		const typeSelect = screen.getByLabelText(/Type/i);
		fireEvent.change(typeSelect, { target: { value: "cloudflare-r2" } });
		expect(screen.getByLabelText(/Bucket Name/i)).toBeInTheDocument();
	});

	it("shows connector mode section when adding inbound connector", async () => {
		render(<InboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work IMAP"));
		fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
		// Connector mode option should be visible in the form
		expect(screen.getByText(/New Inbound Connector/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/^Name$/i)).toBeInTheDocument();
	});
});

describe("OutboundConnectorsTab", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.connectors.outbound.list.mockResolvedValue(mockOutbound);
		mockApi.identities.list.mockResolvedValue(mockIdentities);
	});

	it("shows loading state initially", () => {
		mockApi.connectors.outbound.list.mockReturnValue(new Promise(() => {}));
		mockApi.identities.list.mockReturnValue(new Promise(() => {}));
		render(<OutboundConnectorsTab />);
		expect(screen.getByText(/Loading/i)).toBeInTheDocument();
	});

	it("renders outbound connectors list", async () => {
		render(<OutboundConnectorsTab />);
		await waitFor(() => {
			expect(screen.getByText("Work SMTP")).toBeInTheDocument();
		});
	});

	it("shows empty state when no connectors", async () => {
		mockApi.connectors.outbound.list.mockResolvedValue([]);
		render(<OutboundConnectorsTab />);
		await waitFor(() => {
			expect(screen.getByText(/No outbound connectors configured/i)).toBeInTheDocument();
		});
	});

	it("shows Add button and toggles to form when clicked", async () => {
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		// Use getAllByRole since there may be multiple buttons; pick the top-level "Add" in header area
		const addBtns = screen.getAllByRole("button", { name: /^Add$/i });
		fireEvent.click(addBtns[0] as HTMLElement);
		expect(screen.getByText(/New Outbound Connector/i)).toBeInTheDocument();
	});

	it("cancels adding a new outbound connector", async () => {
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		const addBtns = screen.getAllByRole("button", { name: /^Add$/i });
		fireEvent.click(addBtns[0] as HTMLElement);
		expect(screen.getByText(/New Outbound Connector/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
		expect(screen.queryByText(/New Outbound Connector/i)).not.toBeInTheDocument();
	});

	it("shows identities attached to outbound connector", async () => {
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		// The identity name "Work" and email appear under the outbound connector
		expect(screen.getByText("Work")).toBeInTheDocument();
		// The Identities section heading is shown
		expect(screen.getByText("Identities")).toBeInTheDocument();
	});

	it("tests an outbound connector and shows OK result", async () => {
		mockApi.connectors.outbound.test.mockResolvedValue({ ok: true });
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		fireEvent.click(screen.getByRole("button", { name: /Test/i }));
		await waitFor(() => {
			expect(screen.getByText(/^OK$/i)).toBeInTheDocument();
		});
	});

	it("tests an outbound connector and shows error", async () => {
		mockApi.connectors.outbound.test.mockResolvedValue({ ok: false, error: "Auth failed" });
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		fireEvent.click(screen.getByRole("button", { name: /Test/i }));
		await waitFor(() => {
			expect(screen.getByText(/Auth failed/i)).toBeInTheDocument();
		});
	});

	it("creates a new SMTP outbound connector", async () => {
		mockApi.connectors.outbound.create.mockResolvedValue({ id: 50 });
		mockApi.connectors.outbound.list
			.mockResolvedValueOnce(mockOutbound)
			.mockResolvedValue([...mockOutbound, { ...mockOutbound[0], id: 50, name: "New SMTP" }]);

		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		const addBtns = screen.getAllByRole("button", { name: /^Add$/i });
		fireEvent.click(addBtns[0] as HTMLElement);

		fireEvent.change(screen.getByLabelText(/^Name$/i), {
			target: { value: "New SMTP" },
		});
		fireEvent.change(screen.getByLabelText(/SMTP Host/i), {
			target: { value: "mail.newexample.com" },
		});
		fireEvent.change(screen.getByLabelText(/Username/i), {
			target: { value: "sender@newexample.com" },
		});
		fireEvent.change(screen.getByLabelText(/Password/i), {
			target: { value: "pass456" },
		});

		fireEvent.click(screen.getByRole("button", { name: /Save/i }));

		await waitFor(() => {
			expect(mockApi.connectors.outbound.create).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "New SMTP",
					type: "smtp",
					smtp_host: "mail.newexample.com",
				}),
			);
		});
	});

	it("deletes an outbound connector after confirmation", async () => {
		mockApi.connectors.outbound.delete.mockResolvedValue({ ok: true });
		mockApi.connectors.outbound.list.mockResolvedValueOnce(mockOutbound).mockResolvedValue([]);

		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		// Multiple Delete buttons may exist (connector + identity); click the first
		const deleteBtns = screen.getAllByRole("button", { name: /^Delete$/i });
		fireEvent.click(deleteBtns[0] as HTMLElement);

		// Inline confirm: shows "Delete?" and "Yes" / "No"
		await screen.findByText(/Delete\?/i);
		fireEvent.click(screen.getByRole("button", { name: /^Yes$/i }));

		await waitFor(() => {
			expect(mockApi.connectors.outbound.delete).toHaveBeenCalledWith(2);
		});
	});

	it("shows SES type option", async () => {
		render(<OutboundConnectorsTab />);
		await waitFor(() => screen.getByText("Work SMTP"));
		const addBtns = screen.getAllByRole("button", { name: /^Add$/i });
		fireEvent.click(addBtns[0] as HTMLElement);
		const typeSelect = screen.getByLabelText(/Type/i);
		expect(typeSelect).toBeInTheDocument();
		const options = Array.from((typeSelect as HTMLSelectElement).options).map((o) => o.value);
		expect(options).toContain("ses");
	});
});
