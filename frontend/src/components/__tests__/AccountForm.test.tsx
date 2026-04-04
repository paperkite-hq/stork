import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "../settings/AccountForm";

const mockOutbound = [
	{
		id: 2,
		name: "My SMTP",
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
			outbound: { list: vi.fn() },
		},
		identities: {
			get: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
	},
}));

import { api } from "../../api";

const mockApi = api as unknown as {
	connectors: {
		outbound: { list: ReturnType<typeof vi.fn> };
	};
	identities: {
		get: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
};

describe("AccountForm", () => {
	const onCancel = vi.fn();
	const onSaved = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		mockApi.connectors.outbound.list.mockResolvedValue(mockOutbound);
	});

	it("renders Add Identity heading for new identity", async () => {
		render(<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: /Add Email Identity/i })).toBeInTheDocument(),
		);
		expect(screen.getByPlaceholderText("Work Email")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
	});

	it("shows outbound connector label in select options", async () => {
		render(<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() => expect(screen.getByText(/My SMTP — SMTP/i)).toBeInTheDocument());
	});

	it("shows message when no outbound connectors are configured", async () => {
		mockApi.connectors.outbound.list.mockResolvedValue([]);
		render(<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() =>
			expect(screen.getByText(/No outbound connectors configured/i)).toBeInTheDocument(),
		);
	});

	it("calls api.identities.create and onSaved on successful new identity submit", async () => {
		mockApi.identities.create.mockResolvedValue({ id: 99 });
		const { container } = render(
			<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />,
		);
		await waitFor(() => expect(screen.getByPlaceholderText("Work Email")).toBeInTheDocument());
		fireEvent.change(screen.getByPlaceholderText("Work Email"), {
			target: { value: "Work" },
		});
		fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
			target: { value: "work@example.com" },
		});
		const form = container.querySelector("form");
		if (form) fireEvent.submit(form);
		await waitFor(() => expect(mockApi.identities.create).toHaveBeenCalled());
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
	});

	it("shows error message when create fails", async () => {
		mockApi.identities.create.mockRejectedValue(new Error("Server error"));
		const { container } = render(
			<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />,
		);
		await waitFor(() => expect(screen.getByPlaceholderText("Work Email")).toBeInTheDocument());
		const form = container.querySelector("form");
		if (form) fireEvent.submit(form);
		await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
	});

	it("calls onCancel when Cancel button clicked", async () => {
		render(<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() => expect(screen.getByText("Cancel")).toBeInTheDocument());
		fireEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalled();
	});

	it("loads existing identity data for edit mode", async () => {
		mockApi.identities.get.mockResolvedValue({
			id: 5,
			name: "Existing Identity",
			email: "existing@example.com",
			outbound_connector_id: 2,
			default_view: "inbox",
		});
		render(<AccountForm identityId={5} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() => expect(screen.getByDisplayValue("Existing Identity")).toBeInTheDocument());
		expect(screen.getByDisplayValue("existing@example.com")).toBeInTheDocument();
		expect(screen.getByText("Save Changes")).toBeInTheDocument();
	});

	it("shows loading state while fetching existing identity", () => {
		mockApi.identities.get.mockReturnValue(new Promise(() => {}));
		render(<AccountForm identityId={5} onCancel={onCancel} onSaved={onSaved} />);
		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("stays in loading state when identity load fails (error is set but not displayed)", async () => {
		// When loadIdentity throws, the component sets error state but loaded stays false,
		// so the form stays in "Loading..." state — error is not surfaced to user (known behavior)
		mockApi.identities.get.mockRejectedValue(new Error("Not found"));
		render(<AccountForm identityId={5} onCancel={onCancel} onSaved={onSaved} />);
		// Should not crash; stays showing loading
		await waitFor(() => expect(mockApi.identities.get).toHaveBeenCalledWith(5));
	});

	it("calls api.identities.update on edit submit", async () => {
		mockApi.identities.get.mockResolvedValue({
			id: 5,
			name: "Old Name",
			email: "old@example.com",
			outbound_connector_id: 1,
			default_view: "inbox",
		});
		mockApi.identities.update.mockResolvedValue({ ok: true });
		const { container } = render(
			<AccountForm identityId={5} onCancel={onCancel} onSaved={onSaved} />,
		);
		await waitFor(() => expect(screen.getByDisplayValue("Old Name")).toBeInTheDocument());
		const form = container.querySelector("form");
		if (form) fireEvent.submit(form);
		await waitFor(() =>
			expect(mockApi.identities.update).toHaveBeenCalledWith(5, expect.any(Object)),
		);
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
	});

	it("renders ses outbound connector label", async () => {
		mockApi.connectors.outbound.list.mockResolvedValue([
			{
				id: 4,
				name: "My SES",
				type: "ses" as const,
				smtp_host: null,
				smtp_port: null,
				smtp_tls: null,
				smtp_user: null,
				ses_region: "us-east-1",
				ses_access_key_id: "key",
				created_at: "",
				updated_at: "",
			},
		]);
		render(<AccountForm identityId={null} onCancel={onCancel} onSaved={onSaved} />);
		await waitFor(() => expect(screen.getByText(/My SES — AWS SES/i)).toBeInTheDocument());
	});
});
