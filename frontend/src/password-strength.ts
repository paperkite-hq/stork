/**
 * Password strength estimation based on character-pool entropy.
 *
 * Computes entropy as length × log2(poolSize), where poolSize is determined
 * by the character classes present. This naturally rewards length over
 * character diversity — a long lowercase passphrase scores higher than a
 * short symbol-laden password.
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
 * Get password strength based on character-pool entropy.
 *
 * Thresholds (in bits of entropy):
 *   < 40  → Weak
 *   40–59 → Fair
 *   60–79 → Good
 *   80+   → Strong
 */
export function getPasswordStrength(password: string): PasswordStrength {
	if (password.length === 0) return EMPTY;

	const bits = charEntropy(password);

	let score: number;
	if (bits < 40) score = 1;
	else if (bits < 60) score = 2;
	else if (bits < 80) score = 3;
	else score = 4;

	// biome-ignore lint/style/noNonNullAssertion: score is clamped to valid range
	return { score, bits, ...LEVELS[score]! };
}
