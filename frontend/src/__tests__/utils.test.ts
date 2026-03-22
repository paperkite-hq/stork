import { describe, expect, test } from "vitest";
import {
	formatAddressList,
	getPageSize,
	isFlagged,
	isUnread,
	parseAddressField,
	parseFlags,
} from "../utils.js";

describe("isUnread", () => {
	test("null flags → unread", () => {
		expect(isUnread(null)).toBe(true);
	});

	test("empty string → unread", () => {
		expect(isUnread("")).toBe(true);
	});

	test("flags without \\Seen → unread", () => {
		expect(isUnread("\\Flagged,\\Answered")).toBe(true);
	});

	test("flags with \\Seen → read", () => {
		expect(isUnread("\\Seen")).toBe(false);
	});

	test("\\Seen among comma-separated flags → read", () => {
		expect(isUnread("\\Seen,\\Flagged")).toBe(false);
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
		expect(isFlagged("\\Seen,\\Answered")).toBe(false);
	});

	test("flags with \\Flagged → flagged", () => {
		expect(isFlagged("\\Flagged")).toBe(true);
	});

	test("\\Flagged among comma-separated flags → flagged", () => {
		expect(isFlagged("\\Seen,\\Flagged,\\Answered")).toBe(true);
	});
});

describe("parseFlags", () => {
	test("null → empty set", () => {
		expect(parseFlags(null)).toEqual(new Set());
	});

	test("empty string → empty set", () => {
		expect(parseFlags("")).toEqual(new Set());
	});

	test("single flag → set with one entry", () => {
		expect(parseFlags("\\Seen")).toEqual(new Set(["\\Seen"]));
	});

	test("comma-separated flags → set with all entries", () => {
		expect(parseFlags("\\Seen,\\Flagged,\\Answered")).toEqual(
			new Set(["\\Seen", "\\Flagged", "\\Answered"]),
		);
	});

	test("trailing comma → no empty entries", () => {
		expect(parseFlags("\\Seen,")).toEqual(new Set(["\\Seen"]));
	});

	test("leading comma → no empty entries", () => {
		expect(parseFlags(",\\Seen")).toEqual(new Set(["\\Seen"]));
	});
});

describe("parseAddressField", () => {
	test("null → empty array", () => {
		expect(parseAddressField(null)).toEqual([]);
	});

	test("empty string → empty array", () => {
		expect(parseAddressField("")).toEqual([]);
	});

	test("JSON array format (from IMAP sync)", () => {
		expect(parseAddressField('["alice@test.com","bob@test.com"]')).toEqual([
			"alice@test.com",
			"bob@test.com",
		]);
	});

	test("single-element JSON array", () => {
		expect(parseAddressField('["alice@test.com"]')).toEqual(["alice@test.com"]);
	});

	test("comma-separated format (from demo/legacy data)", () => {
		expect(parseAddressField("alice@test.com, bob@test.com")).toEqual([
			"alice@test.com",
			"bob@test.com",
		]);
	});

	test("single bare email", () => {
		expect(parseAddressField("alice@test.com")).toEqual(["alice@test.com"]);
	});

	test("invalid JSON falls back to comma-split", () => {
		expect(parseAddressField("[broken")).toEqual(["[broken"]);
	});

	test("JSON array with null entries filters them out", () => {
		expect(parseAddressField('["alice@test.com",null,"bob@test.com"]')).toEqual([
			"alice@test.com",
			"bob@test.com",
		]);
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

	test("JSON array format → correctly parsed and formatted", () => {
		expect(formatAddressList('["alice@example.com","bob@example.com"]')).toBe(
			"alice@example.com, bob@example.com",
		);
	});

	test("JSON array with display names → extracts names", () => {
		expect(formatAddressList('["Alice <alice@example.com>","bob@example.com"]')).toBe(
			"Alice, bob@example.com",
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
