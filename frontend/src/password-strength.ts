/**
 * Dictionary-aware password strength estimation.
 *
 * Computes both character-level entropy (length × log2(poolSize)) and
 * dictionary-aware entropy (treating recognized common words as single
 * units from a known dictionary). Uses the LOWER of the two estimates,
 * so a password like "david was here" gets scored as ~3 common words
 * (~33 bits) rather than 14 random characters (~82 bits).
 *
 * This naturally rewards genuinely random passwords and long passphrases
 * with uncommon words, while penalizing phrases built from trivially
 * guessable dictionary words.
 */

import { getCommonWords } from "./common-words";

export interface PasswordStrength {
	score: number; // 0–4 (0 = empty)
	label: string;
	color: string;
	textColor: string;
	bits: number;
}

const EMPTY: PasswordStrength = { score: 0, label: "", color: "", textColor: "", bits: 0 };

const LEVELS: Record<number, { label: string; color: string; textColor: string }> = {
	1: { label: "Weak", color: "bg-red-500", textColor: "text-red-500" },
	2: { label: "Fair", color: "bg-orange-500", textColor: "text-orange-500" },
	3: { label: "Good", color: "bg-yellow-500", textColor: "text-yellow-500" },
	4: { label: "Strong", color: "bg-green-500", textColor: "text-green-500" },
};

/**
 * Estimate character-pool entropy: length × log2(poolSize).
 */
function charEntropy(password: string): number {
	let poolSize = 0;
	if (/[a-z]/.test(password)) poolSize += 26;
	if (/[A-Z]/.test(password)) poolSize += 26;
	if (/[0-9]/.test(password)) poolSize += 10;
	if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33;
	if (poolSize === 0) poolSize = 95;
	return password.length * Math.log2(poolSize);
}

/**
 * Estimate dictionary-aware entropy. Splits the password into tokens on
 * whitespace/hyphens/underscores, checks each against a common-words list,
 * and scores matched tokens as dictionary picks rather than random characters.
 *
 * Returns Infinity if the password doesn't decompose into dictionary words
 * (i.e., character entropy should be used instead).
 */
function dictEntropy(password: string): number {
	const words = getCommonWords();
	// Split on common delimiters (space, hyphen, underscore, period)
	const tokens = password
		.toLowerCase()
		.split(/[\s\-_.]+/)
		.filter(Boolean);

	// Only apply dictionary penalty if we get multiple tokens and most are common words
	if (tokens.length < 2) return Number.POSITIVE_INFINITY;

	let dictCount = 0;
	let nonDictBits = 0;

	for (const token of tokens) {
		if (words.has(token)) {
			dictCount++;
		} else {
			// Non-dictionary token: use character-level entropy for this segment
			nonDictBits += charEntropy(token);
		}
	}

	// Only apply dictionary scoring if at least half the tokens are common words
	if (dictCount < tokens.length / 2) return Number.POSITIVE_INFINITY;

	// Each dictionary word contributes log2(dictionarySize) bits
	const dictBits = dictCount * Math.log2(words.size);

	// Small bonus for separator choice (space vs hyphen vs underscore etc.)
	// An attacker would need to guess which separator, but there are only ~4 options
	const separatorBits = (tokens.length - 1) * Math.log2(4);

	return dictBits + nonDictBits + separatorBits;
}

/**
 * Get password strength using the more conservative of character-level
 * and dictionary-aware entropy estimates.
 *
 * Thresholds (in bits of entropy):
 *   < 40  → Weak
 *   40–59 → Fair
 *   60–79 → Good
 *   80+   → Strong
 */
export function getPasswordStrength(password: string): PasswordStrength {
	if (password.length === 0) return EMPTY;

	const bits = Math.min(charEntropy(password), dictEntropy(password));

	let score: number;
	if (bits < 40) score = 1;
	else if (bits < 60) score = 2;
	else if (bits < 80) score = 3;
	else score = 4;

	// biome-ignore lint/style/noNonNullAssertion: score is clamped to valid range
	return { score, bits, ...LEVELS[score]! };
}
