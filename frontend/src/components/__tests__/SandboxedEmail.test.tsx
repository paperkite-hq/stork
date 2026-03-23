import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SandboxedEmail } from "../SandboxedEmail";

describe("SandboxedEmail", () => {
	it("renders an iframe with sandboxed attributes", () => {
		render(<SandboxedEmail html="<p>Hello</p>" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe).toBeInTheDocument();
		expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin allow-popups");
	});

	it("injects html into srcdoc", () => {
		render(<SandboxedEmail html="<p>Test content</p>" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("<p>Test content</p>");
	});

	it("applies custom className", () => {
		render(<SandboxedEmail html="<p>Hi</p>" className="email-content" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.className).toBe("email-content");
	});

	it("CSP blocks remote images by default", () => {
		render(<SandboxedEmail html="<p>Hello</p>" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		// CSP should only allow data: and the API origin — no https: or http: for general remote images
		expect(iframe.srcdoc).toContain("img-src data:");
		expect(iframe.srcdoc).not.toContain("https: http:");
	});

	it("CSP allows remote images when allowRemoteImages is true", () => {
		render(<SandboxedEmail html='<img src="https://example.com/img.png">' allowRemoteImages />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("https: http:");
	});

	it("always allows data: images regardless of allowRemoteImages", () => {
		render(<SandboxedEmail html='<img src="data:image/png;base64,abc">' />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("img-src data:");
	});

	it("applies dark mode colors when dark prop is true", () => {
		render(<SandboxedEmail html="<p>Dark mode</p>" dark />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("color: #e5e7eb");
		expect(iframe.srcdoc).toContain("background: #111827");
	});

	it("applies light mode colors when dark is false", () => {
		render(<SandboxedEmail html="<p>Light mode</p>" dark={false} />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("color: #1f2937");
		expect(iframe.srcdoc).toContain("background: transparent");
	});

	it("blocks scripts via sandbox attribute (no allow-scripts)", () => {
		render(<SandboxedEmail html='<script>alert("xss")</script>' />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
	});

	it("highlights matching search terms in body text with <mark> elements", () => {
		render(
			<SandboxedEmail html="<p>Invoice received from Alice</p>" searchQuery="invoice alice" />,
		);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("<mark>");
		expect(iframe.srcdoc.toLowerCase()).toContain("invoice");
		expect(iframe.srcdoc.toLowerCase()).toContain("alice");
	});

	it("does not add mark elements when searchQuery is empty", () => {
		render(<SandboxedEmail html="<p>Invoice from Alice</p>" searchQuery="" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).not.toContain("<mark>");
	});

	it("does not add mark elements when searchQuery is undefined", () => {
		render(<SandboxedEmail html="<p>Invoice from Alice</p>" />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).not.toContain("<mark>");
	});

	it("strips search operators before highlighting — only plain terms are highlighted", () => {
		render(
			<SandboxedEmail
				html="<p>Invoice from alice@test.com</p>"
				searchQuery="from:alice@test.com invoice"
			/>,
		);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		// "invoice" (length > 1) should be highlighted
		expect(iframe.srcdoc).toContain("<mark>");
		// The "from:" operator itself should not be wrapped in a mark tag
		expect(iframe.srcdoc).not.toContain("<mark>from</mark>");
	});

	it("applies operator-only query without highlighting anything", () => {
		render(
			<SandboxedEmail
				html="<p>Some email body</p>"
				searchQuery="from:alice is:unread has:attachment"
			/>,
		);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).not.toContain("<mark>");
	});
});
