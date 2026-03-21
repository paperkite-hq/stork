import { describe, expect, test } from "vitest";
import { formatAddressList, getPageSize, isFlagged, isUnread } from "../utils.js";

describe("isUnread", () => {
	test("null flags → unread", () => {
		expect(isUnread(null)).toBe(true);
	});

	test("empty string → unread", () => {
		expect(isUnread("")).toBe(true);
	});

	test("flags without \\Seen → unread", () => {
		expect(isUnread("\\Flagged \\Answered")).toBe(true);
	});

	test("flags with \\Seen → read", () => {
		expect(isUnread("\\Seen")).toBe(false);
	});

	test("\\Seen among multiple flags → read", () => {
		expect(isUnread("\\Seen \\Flagged")).toBe(false);
	});
});

describe("isFlagged", () => {
	test("null flags → not flagged", () => {
		expect(isFlagged(null)).toBe(false);
	});

	test("empty string → not flagged", () => {
		expect(isFlagged("")).toBe(false);
	});

	test("flags without \\Flagged → not flagged", () => {
		expect(isFlagged("\\Seen \\Answered")).toBe(false);
	});

	test("flags with \\Flagged → flagged", () => {
		expect(isFlagged("\\Flagged")).toBe(true);
	});

	test("\\Flagged among multiple flags → flagged", () => {
		expect(isFlagged("\\Seen \\Flagged \\Answered")).toBe(true);
	});
});

describe("formatAddressList", () => {
	test("null → empty string", () => {
		expect(formatAddressList(null)).toBe("");
	});

	test("empty string → empty string", () => {
		expect(formatAddressList("")).toBe("");
	});

	test("bare email address → returned as-is", () => {
		expect(formatAddressList("alice@example.com")).toBe("alice@example.com");
	});

	test("display name + email → returns display name", () => {
		expect(formatAddressList("Alice Smith <alice@example.com>")).toBe("Alice Smith");
	});

	test("quoted display name → strips quotes", () => {
		expect(formatAddressList('"Alice Smith" <alice@example.com>')).toBe("Alice Smith");
	});

	test("multiple addresses → comma-separated display names", () => {
		expect(
			formatAddressList("Alice <alice@example.com>, bob@example.com, Carol <carol@test.com>"),
		).toBe("Alice, bob@example.com, Carol");
	});

	test("empty display name → falls back to email", () => {
		expect(formatAddressList("<alice@example.com>")).toBe("alice@example.com");
	});

	test("skips empty segments from trailing commas", () => {
		expect(formatAddressList("alice@example.com, , bob@example.com")).toBe(
			"alice@example.com, bob@example.com",
		);
	});
});

describe("getPageSize", () => {
	test("returns 50 by default", () => {
		expect(getPageSize()).toBe(50);
	});

	test("reads from localStorage", () => {
		localStorage.setItem("stork-messages-per-page", "25");
		expect(getPageSize()).toBe(25);
		localStorage.removeItem("stork-messages-per-page");
	});

	test("rejects invalid values (0, negative, >200)", () => {
		localStorage.setItem("stork-messages-per-page", "0");
		expect(getPageSize()).toBe(50);
		localStorage.setItem("stork-messages-per-page", "-5");
		expect(getPageSize()).toBe(50);
		localStorage.setItem("stork-messages-per-page", "500");
		expect(getPageSize()).toBe(50);
		localStorage.removeItem("stork-messages-per-page");
	});

	test("rejects NaN strings", () => {
		localStorage.setItem("stork-messages-per-page", "abc");
		expect(getPageSize()).toBe(50);
		localStorage.removeItem("stork-messages-per-page");
	});
});
