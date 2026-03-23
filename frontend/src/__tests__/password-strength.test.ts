import { describe, expect, it } from "vitest";
import { getPasswordStrength } from "../password-strength";

describe("getPasswordStrength", () => {
	it("returns score 0 for empty string", () => {
		const result = getPasswordStrength("");
		expect(result.score).toBe(0);
		expect(result.label).toBe("");
		expect(result.bits).toBe(0);
	});

	it("rates short passwords as Weak", () => {
		// "abc" → 3 * log2(26) ≈ 14 bits
		expect(getPasswordStrength("abc").label).toBe("Weak");
		expect(getPasswordStrength("abc").score).toBe(1);
	});

	it("rates a 12-char lowercase password as Fair", () => {
		// 12 * log2(26) ≈ 56 bits → Fair (40–59)
		const result = getPasswordStrength("abcdefghijkl");
		expect(result.label).toBe("Fair");
		expect(result.score).toBe(2);
	});

	it("rates a 16-char lowercase password as Good", () => {
		// 16 * log2(26) ≈ 75 bits → Good (60–79)
		const result = getPasswordStrength("abcdefghijklmnop");
		expect(result.label).toBe("Good");
		expect(result.score).toBe(3);
	});

	it("rates a long lowercase passphrase as Strong", () => {
		// "correct horse battery staple" → 28 chars, pool 59 (lower+symbols for space)
		// 28 * log2(59) ≈ 164 bits → Strong
		const result = getPasswordStrength("correct horse battery staple");
		expect(result.label).toBe("Strong");
		expect(result.score).toBe(4);
	});

	it("does NOT reward a short password just for using symbols", () => {
		// "P@ss!" → 5 chars, pool 95 → 5 * log2(95) ≈ 33 bits → Weak
		const result = getPasswordStrength("P@ss!");
		expect(result.label).toBe("Weak");
		expect(result.score).toBe(1);
	});

	it("rates a 20-char all-lowercase password as Strong", () => {
		// 20 * log2(26) ≈ 94 bits → Strong
		const result = getPasswordStrength("abcdefghijklmnopqrst");
		expect(result.label).toBe("Strong");
		expect(result.score).toBe(4);
	});

	it("rates a 12-char mixed password as Good", () => {
		// 12 chars, lower+upper+digits = pool 62 → 12 * log2(62) ≈ 71 bits → Good
		const result = getPasswordStrength("Abcdefghijk1");
		expect(result.label).toBe("Good");
		expect(result.score).toBe(3);
	});

	it("computes entropy bits accurately", () => {
		// 10 lowercase chars → 10 * log2(26) ≈ 47.00
		const result = getPasswordStrength("abcdefghij");
		expect(result.bits).toBeCloseTo(10 * Math.log2(26), 1);
	});
});
