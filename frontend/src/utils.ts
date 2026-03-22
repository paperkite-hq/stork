/** Shared utility functions for mail flag checks and provider config */

/** Well-known IMAP/SMTP server configurations for common email providers. */
export const WELL_KNOWN_PROVIDERS: Record<string, { imap_host: string; smtp_host: string }> = {
	"gmail.com": { imap_host: "imap.gmail.com", smtp_host: "smtp.gmail.com" },
	"googlemail.com": { imap_host: "imap.gmail.com", smtp_host: "smtp.gmail.com" },
	"outlook.com": { imap_host: "outlook.office365.com", smtp_host: "smtp.office365.com" },
	"hotmail.com": { imap_host: "outlook.office365.com", smtp_host: "smtp.office365.com" },
	"live.com": { imap_host: "outlook.office365.com", smtp_host: "smtp.office365.com" },
	"yahoo.com": { imap_host: "imap.mail.yahoo.com", smtp_host: "smtp.mail.yahoo.com" },
	"icloud.com": { imap_host: "imap.mail.me.com", smtp_host: "smtp.mail.me.com" },
	"me.com": { imap_host: "imap.mail.me.com", smtp_host: "smtp.mail.me.com" },
	"fastmail.com": { imap_host: "imap.fastmail.com", smtp_host: "smtp.fastmail.com" },
	"pm.me": { imap_host: "127.0.0.1", smtp_host: "127.0.0.1" },
	"protonmail.com": { imap_host: "127.0.0.1", smtp_host: "127.0.0.1" },
	"zoho.com": { imap_host: "imap.zoho.com", smtp_host: "smtp.zoho.com" },
};

/** Parse a comma-separated flags string into a Set for reliable lookup.
 *  Backend stores flags as comma-separated (e.g. "\\Seen,\\Flagged"). */
export function parseFlags(flags: string | null): Set<string> {
	if (!flags) return new Set();
	return new Set(flags.split(",").filter(Boolean));
}

export function isUnread(flags: string | null): boolean {
	return !parseFlags(flags).has("\\Seen");
}

export function isFlagged(flags: string | null): boolean {
	return parseFlags(flags).has("\\Flagged");
}

/**
 * Parse an address field into individual address strings.
 * Handles two storage formats:
 *  - JSON array: `["alice@test.com","bob@test.com"]` (from IMAP sync)
 *  - Comma-separated: `alice@test.com, bob@test.com` (from send route, demo data)
 */
export function parseAddressField(raw: string | null): string[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.filter(Boolean);
		} catch {
			// Not valid JSON — fall through to comma-split
		}
	}
	return trimmed
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Format an address field for display. Handles both JSON array and comma-separated
 * storage formats. Extracts display names from "Name <email>" format.
 */
export function formatAddressList(raw: string | null): string {
	if (!raw) return "";
	return parseAddressField(raw)
		.map((addr) => {
			// Match "Display Name <email>" or bare "<email>" pattern
			const match = addr.match(/^(.*?)\s*<([^>]+)>$/);
			if (match) {
				const name = (match[1] ?? "").replace(/^["']|["']$/g, "").trim();
				return name || match[2] || addr;
			}
			return addr;
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
