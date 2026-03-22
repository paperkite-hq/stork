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
});
