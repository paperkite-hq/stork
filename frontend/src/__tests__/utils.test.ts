import { describe, expect, test } from "vitest";
import { isFlagged, isUnread } from "../utils.js";

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
