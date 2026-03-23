/**
 * Entropy-based password strength estimation.
 *
 * Scores passwords by estimating information entropy (bits) from character
 * pool diversity × length. This naturally rewards long passphrases — a
 * sentence of lowercase words scores higher than a short string with
 * forced symbol substitutions.
 */

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
 * Estimate the effective character pool size from classes present in the
 * password, then compute entropy = length × log2(poolSize).
 *
 * Thresholds (in bits of entropy):
 *   < 40  → Weak
 *   40–59 → Fair
 *   60–79 → Good
 *   80+   → Strong
 *
 * Examples that score well:
 *   "correct horse battery staple" → ~133 bits (Strong)
 *   "a long sentence of words"     → ~114 bits (Strong)
 *   "sixteencharslong"             → ~75 bits  (Good)
 *
 * Examples that DON'T get free points for symbols:
 *   "P@ss!"  → ~33 bits (Weak)
 */
export function getPasswordStrength(password: string): PasswordStrength {
	if (password.length === 0) return EMPTY;

	let poolSize = 0;
	if (/[a-z]/.test(password)) poolSize += 26;
	if (/[A-Z]/.test(password)) poolSize += 26;
	if (/[0-9]/.test(password)) poolSize += 10;
	if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33; // symbols, space, punctuation

	// Fallback: if somehow no class matched (shouldn't happen for non-empty),
	// assume at least the full printable ASCII range
	if (poolSize === 0) poolSize = 95;

	const bits = password.length * Math.log2(poolSize);

	let score: number;
	if (bits < 40) score = 1;
	else if (bits < 60) score = 2;
	else if (bits < 80) score = 3;
	else score = 4;

	// biome-ignore lint/style/noNonNullAssertion: score is clamped to valid range
	return { score, bits, ...LEVELS[score]! };
}
