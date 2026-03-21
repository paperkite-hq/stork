/** Shared utility functions for mail flag checks */

export function isUnread(flags: string | null): boolean {
	if (!flags) return true;
	return !flags.includes("\\Seen");
}

export function isFlagged(flags: string | null): boolean {
	if (!flags) return false;
	return flags.includes("\\Flagged");
}

/**
 * Parse a comma-separated list of RFC 2822 addresses into a readable format.
 * Handles both "Display Name <email@example.com>" and bare "email@example.com".
 * Returns a cleaned, comma-separated string of display names (with email as fallback).
 */
export function formatAddressList(raw: string | null): string {
	if (!raw) return "";
	return raw
		.split(",")
		.map((addr) => {
			const trimmed = addr.trim();
			if (!trimmed) return "";
			// Match "Display Name <email>" or bare "<email>" pattern
			const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
			if (match) {
				const name = (match[1] ?? "").replace(/^["']|["']$/g, "").trim();
				return name || match[2] || trimmed;
			}
			return trimmed;
		})
		.filter(Boolean)
		.join(", ");
}

/**
 * Read messages-per-page preference from localStorage.
 * Returns the stored value or the default (50).
 */
export function getPageSize(): number {
	try {
		const stored = localStorage.getItem("stork-messages-per-page");
		if (stored) {
			const n = Number(stored);
			if (n > 0 && n <= 200) return n;
		}
	} catch {
		// localStorage unavailable
	}
	return 50;
}
