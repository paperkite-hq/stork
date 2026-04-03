import { describe, expect, test } from "vitest";
import { htmlToText } from "./html-to-text.js";

describe("htmlToText", () => {
	test("returns null for null/undefined input", () => {
		expect(htmlToText(null)).toBeNull();
		expect(htmlToText(undefined)).toBeNull();
	});

	test("returns null for empty HTML", () => {
		expect(htmlToText("")).toBeNull();
		expect(htmlToText("   ")).toBeNull();
	});

	test("strips HTML tags and returns text content", () => {
		expect(htmlToText("<p>Hello world</p>")).toBe("Hello world");
	});

	test("handles nested tags", () => {
		const result = htmlToText("<div><p><strong>Bold</strong> and <em>italic</em></p></div>");
		expect(result).toContain("Bold");
		expect(result).toContain("and");
		expect(result).toContain("italic");
	});

	test("decodes common HTML entities", () => {
		expect(htmlToText("Tom &amp; Jerry")).toBe("Tom & Jerry");
		expect(htmlToText("&lt;script&gt;")).toBe("<script>");
		expect(htmlToText("&quot;quoted&quot;")).toBe('"quoted"');
		expect(htmlToText("non&nbsp;breaking")).toBe("non breaking");
	});

	test("decodes numeric entities", () => {
		expect(htmlToText("&#169; 2026")).toBe("\u00A9 2026");
		expect(htmlToText("&#x2014; dash")).toBe("\u2014 dash");
	});

	test("removes style and script blocks entirely", () => {
		const html = `
			<style>.foo { color: red; }</style>
			<p>Visible text</p>
			<script>alert('xss')</script>
		`;
		const result = htmlToText(html);
		expect(result).toContain("Visible text");
		expect(result).not.toContain("color");
		expect(result).not.toContain("alert");
		expect(result).not.toContain("xss");
	});

	test("inserts line breaks for block elements", () => {
		const html = "<p>First paragraph</p><p>Second paragraph</p>";
		const result = htmlToText(html);
		expect(result).toContain("First paragraph");
		expect(result).toContain("Second paragraph");
		// Should have newline separation, not run together
		expect(result).not.toBe("First paragraphSecond paragraph");
	});

	test("collapses excessive whitespace", () => {
		const html = "<p>  lots   of    spaces  </p>";
		expect(htmlToText(html)).toBe("lots of spaces");
	});

	test("handles typical marketing email", () => {
		const html = `
			<html><body>
			<div style="font-family: Arial, sans-serif;">
				<h1>Welcome to Our Newsletter</h1>
				<p>Dear subscriber, we have exciting news!</p>
				<a href="https://example.com">Click here</a>
				<p>Best regards,<br>The Team</p>
			</div>
			</body></html>
		`;
		const result = htmlToText(html);
		expect(result).toContain("Welcome to Our Newsletter");
		expect(result).toContain("Dear subscriber");
		expect(result).toContain("Click here");
		expect(result).toContain("Best regards");
		expect(result).not.toContain("font-family");
		expect(result).not.toContain("href");
	});

	test("returns null for image-only HTML", () => {
		// HTML with only images and no text content
		expect(htmlToText('<img src="photo.jpg" />')).toBeNull();
	});
});
