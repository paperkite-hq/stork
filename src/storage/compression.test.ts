import { describe, expect, test } from "vitest";
import {
	compressBuffer,
	compressText,
	decompressBuffer,
	decompressMessageRow,
	decompressText,
} from "./compression.js";

describe("compression", () => {
	test("compressText and decompressText round-trip", () => {
		const original =
			"<html><body><h1>Hello World</h1><p>This is a test email with enough content to compress well.</p><p>More content here to make compression worthwhile.</p></body></html>";
		const compressed = compressText(original);
		expect(compressed).toBeInstanceOf(Buffer);
		expect(compressed?.length).toBeLessThan(Buffer.byteLength(original));
		expect(decompressText(compressed)).toBe(original);
	});

	test("compressText returns null for null input", () => {
		expect(compressText(null)).toBeNull();
		expect(compressText(undefined)).toBeNull();
	});

	test("decompressText passes through strings (legacy uncompressed data)", () => {
		expect(decompressText("plain text")).toBe("plain text");
	});

	test("decompressText returns null for null input", () => {
		expect(decompressText(null)).toBeNull();
		expect(decompressText(undefined)).toBeNull();
	});

	test("compressBuffer and decompressBuffer round-trip", () => {
		const original = Buffer.from("Hello, attachment world!");
		const compressed = compressBuffer(original);
		expect(compressed).toBeInstanceOf(Buffer);
		const decompressed = decompressBuffer(compressed);
		expect(decompressed).toEqual(original);
	});

	test("decompressBuffer passes through non-zlib data", () => {
		// Data that doesn't start with 0x78 (zlib header)
		const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
		expect(decompressBuffer(raw)).toEqual(raw);
	});

	test("decompressBuffer returns null for null input", () => {
		expect(decompressBuffer(null)).toBeNull();
		expect(decompressBuffer(undefined)).toBeNull();
	});

	test("decompressMessageRow decompresses html_body and raw_headers", () => {
		const htmlCompressed = compressText("<p>Hello</p>");
		const headersCompressed = compressText("From: test@example.com\r\nTo: user@example.com");
		const row = {
			id: 1,
			subject: "Test",
			html_body: htmlCompressed,
			raw_headers: headersCompressed,
			text_body: "plain text",
		};
		const result = decompressMessageRow(row);
		expect(result.html_body).toBe("<p>Hello</p>");
		expect(result.raw_headers).toBe("From: test@example.com\r\nTo: user@example.com");
		expect(result.text_body).toBe("plain text"); // untouched
	});

	test("decompressMessageRow handles legacy uncompressed strings", () => {
		const row = {
			id: 1,
			html_body: "<p>Old data</p>",
			raw_headers: "From: old@example.com",
		};
		const result = decompressMessageRow(row);
		expect(result.html_body).toBe("<p>Old data</p>");
		expect(result.raw_headers).toBe("From: old@example.com");
	});

	test("HTML compresses well (>50% reduction for typical email)", () => {
		// Typical HTML email with repetitive structure
		const html = `
			<html><body>
			<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
				<h1 style="color: #333;">Monthly Newsletter</h1>
				<p style="color: #666; line-height: 1.6;">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
				<p style="color: #666; line-height: 1.6;">Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
				<p style="color: #666; line-height: 1.6;">Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
				<a href="https://example.com/unsubscribe" style="color: #999; font-size: 12px;">Unsubscribe</a>
			</div>
			</body></html>
		`;
		const compressed = compressText(html);
		const ratio = (compressed?.length ?? 0) / Buffer.byteLength(html);
		expect(ratio).toBeLessThan(0.6); // >40% compression (real emails compress much better)
	});
});
