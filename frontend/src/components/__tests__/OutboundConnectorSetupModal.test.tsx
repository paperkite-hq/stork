import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../../api";
import { OutboundConnectorSetupModal } from "../OutboundConnectorSetupModal";

// ── Mock API ──────────────────────────────────────────────────────────────

vi.mock("../../api", () => ({
	api: {
		connectors: {
			outbound: {
				create: vi.fn().mockResolvedValue({ id: 42 }),
			},
		},
		identities: {
			update: vi.fn().mockResolvedValue({ ok: true }),
		},
	},
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
	return {
		id: 1,
		name: "Alice",
		email: "alice@example.com",
		outbound_connector_id: null,
		created_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

async function importApi() {
	const mod = await import("../../api");
	return mod.api;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("OutboundConnectorSetupModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── Step 1: connector form ──────────────────────────────────────────────

	it("renders the connector creation form on step 1", () => {
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("Set up outbound email")).toBeInTheDocument();
		expect(screen.getByLabelText("Name")).toBeInTheDocument();
		expect(screen.getByLabelText("Type")).toBeInTheDocument();
	});

	it("shows SMTP fields by default", () => {
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
		expect(screen.getByLabelText("SMTP Host")).toBeInTheDocument();
		expect(screen.getByLabelText("Username")).toBeInTheDocument();
		expect(screen.getByLabelText("Password")).toBeInTheDocument();
	});

	it("switches to SES fields when type is changed", async () => {
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
		await userEvent.selectOptions(screen.getByLabelText("Type"), "ses");
		expect(screen.getByLabelText("AWS Region")).toBeInTheDocument();
		expect(screen.queryByLabelText("SMTP Host")).not.toBeInTheDocument();
	});

	it("calls onCancel when Cancel is clicked on step 1", async () => {
		const onCancel = vi.fn();
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={onCancel} />);
		await userEvent.click(screen.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	// ── Step 1 → step 2 (with identities) ──────────────────────────────────

	it("advances to identity-link step after connector is created (with identities)", async () => {
		const identity = makeIdentity();
		render(
			<OutboundConnectorSetupModal identities={[identity]} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "My SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "user@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "secret");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(screen.getByText("Link your sending identities")).toBeInTheDocument();
		});
	});

	it("skips identity step when no identities exist and shows done", async () => {
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);

		await userEvent.type(screen.getByLabelText("Name"), "My SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "user@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "secret");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(screen.getByText("Ready to send!")).toBeInTheDocument();
		});
	});

	it("skips identity step when all identities already have a connector", async () => {
		const identity = makeIdentity({ outbound_connector_id: 99 });
		render(
			<OutboundConnectorSetupModal identities={[identity]} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "My SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "user@example.com");
		await userEvent.type(screen.getByLabelText("Password"), "secret");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => {
			expect(screen.getByText("Ready to send!")).toBeInTheDocument();
		});
	});

	it("calls api.connectors.outbound.create with correct payload for SMTP", async () => {
		const api = await importApi();
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);

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

	// ── Step 2: identity linking ────────────────────────────────────────────

	it("shows all unlinked identities checked by default in step 2", async () => {
		const identities = [
			makeIdentity({ id: 1, name: "Alice", email: "alice@example.com" }),
			makeIdentity({ id: 2, name: "Bob", email: "bob@example.com" }),
		];
		render(
			<OutboundConnectorSetupModal identities={identities} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		// Submit connector form
		await userEvent.type(screen.getByLabelText("Name"), "My SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => screen.getByText("Link your sending identities"));

		const checkboxes = screen.getAllByRole("checkbox");
		expect(checkboxes).toHaveLength(2);
		for (const cb of checkboxes) {
			expect(cb).toBeChecked();
		}
	});

	it("calls api.identities.update for selected identities on Apply", async () => {
		const api = await importApi();
		const identity = makeIdentity({ id: 7 });
		render(
			<OutboundConnectorSetupModal identities={[identity]} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));

		await waitFor(() => screen.getByText("Apply"));
		await userEvent.click(screen.getByText("Apply"));

		await waitFor(() => {
			expect(api.identities.update).toHaveBeenCalledWith(7, {
				outbound_connector_id: 42,
			});
		});
	});

	it("advances to done step after applying identity links", async () => {
		const identity = makeIdentity();
		render(
			<OutboundConnectorSetupModal identities={[identity]} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));
		await waitFor(() => screen.getByText("Apply"));
		await userEvent.click(screen.getByText("Apply"));

		await waitFor(() => {
			expect(screen.getByText("Ready to send!")).toBeInTheDocument();
		});
	});

	it("advances to done when Skip is clicked on identity step", async () => {
		const identity = makeIdentity();
		render(
			<OutboundConnectorSetupModal identities={[identity]} onDone={vi.fn()} onCancel={vi.fn()} />,
		);

		await userEvent.type(screen.getByLabelText("Name"), "SMTP");
		await userEvent.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
		await userEvent.type(screen.getByLabelText("Username"), "u");
		await userEvent.type(screen.getByLabelText("Password"), "p");
		await userEvent.click(screen.getByText("Save connector"));
		await waitFor(() => screen.getByText("Skip"));
		await userEvent.click(screen.getByText("Skip"));

		await waitFor(() => {
			expect(screen.getByText("Ready to send!")).toBeInTheDocument();
		});
	});

	// ── Done step ──────────────────────────────────────────────────────────

	it("calls onDone when Open compose is clicked on done step", async () => {
		const onDone = vi.fn();
		render(<OutboundConnectorSetupModal identities={[]} onDone={onDone} onCancel={vi.fn()} />);

		// Submit connector form to reach done step
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
		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={onCancel} />);

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

		render(<OutboundConnectorSetupModal identities={[]} onDone={vi.fn()} onCancel={vi.fn()} />);

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
