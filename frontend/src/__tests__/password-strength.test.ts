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

	it("does NOT reward a short password just for using symbols", () => {
		// "P@ss!" → 5 chars, pool 95 → 5 * log2(95) ≈ 33 bits → Weak
		const result = getPasswordStrength("P@ss!");
		expect(result.label).toBe("Weak");
		expect(result.score).toBe(1);
	});

	it("rates a 20-char all-lowercase password as Strong", () => {
		// 20 * log2(26) ≈ 94 bits → Strong (no dictionary match, single token)
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

	it("computes entropy bits accurately for non-dictionary passwords", () => {
		// 10 lowercase chars → 10 * log2(26) ≈ 47.00
		const result = getPasswordStrength("abcdefghij");
		expect(result.bits).toBeCloseTo(10 * Math.log2(26), 1);
	});

	// Dictionary-aware scoring tests
	describe("dictionary-aware scoring", () => {
		it("penalizes common word phrases — 'david was here' is NOT Strong", () => {
			const result = getPasswordStrength("david was here");
			expect(result.label).not.toBe("Strong");
			// 3 common words from ~2000-word dict ≈ 33 bits + separator bits → Weak
			expect(result.score).toBeLessThanOrEqual(1);
		});

		it("penalizes other trivial word phrases", () => {
			expect(getPasswordStrength("i love you").label).toBe("Weak");
			expect(getPasswordStrength("let me in").label).toBe("Weak");
			expect(getPasswordStrength("open the door").label).toBe("Weak");
		});

		it("rates 4-common-word passphrases as Fair (not Strong)", () => {
			// "correct horse battery staple" — 4 common words ≈ 44 bits → Fair
			const result = getPasswordStrength("correct horse battery staple");
			expect(result.label).toBe("Fair");
			expect(result.score).toBe(2);
		});

		it("rates 6+ common-word passphrases as Good", () => {
			const result = getPasswordStrength("the quick brown fox jump over");
			expect(result.score).toBeGreaterThanOrEqual(3);
		});

		it("does not penalize single-token passwords (no dictionary split)", () => {
			// A single long word without spaces uses character entropy
			const result = getPasswordStrength("abcdefghijklmnopqrst");
			expect(result.label).toBe("Strong");
		});

		it("does not penalize passwords with mostly non-dictionary tokens", () => {
			// Mixed: some dictionary words but mostly random → char entropy used
			const result = getPasswordStrength("xkq7 zpmr david wnt9");
			// "david" is common but the rest aren't — less than half are dict words
			// so dictionary penalty doesn't apply, char entropy is used
			expect(result.score).toBeGreaterThanOrEqual(3);
		});

		it("handles hyphen-separated common words", () => {
			const result = getPasswordStrength("love-hate-game");
			expect(result.score).toBeLessThanOrEqual(2);
		});

		it("handles underscore-separated common words", () => {
			const result = getPasswordStrength("fire_water_earth_air");
			expect(result.score).toBeLessThanOrEqual(2);
		});
	});
});
