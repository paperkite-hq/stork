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
		// CSP should only allow data: and cid: — no https: or http:
		expect(iframe.srcdoc).toContain("img-src data: cid:;");
		expect(iframe.srcdoc).not.toContain("img-src data: cid: https:");
	});

	it("CSP allows remote images when allowRemoteImages is true", () => {
		render(<SandboxedEmail html='<img src="https://example.com/img.png">' allowRemoteImages />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("img-src data: cid: https: http:;");
	});

	it("always allows data: and cid: images regardless of allowRemoteImages", () => {
		render(<SandboxedEmail html='<img src="data:image/png;base64,abc">' />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.srcdoc).toContain("img-src data: cid:");
	});

	it("blocks scripts via sandbox attribute (no allow-scripts)", () => {
		render(<SandboxedEmail html='<script>alert("xss")</script>' />);
		const iframe = screen.getByTitle("Email content") as HTMLIFrameElement;
		expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
	});
});
