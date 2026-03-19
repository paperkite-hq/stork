/** Shared utility functions for mail flag checks */

export function isUnread(flags: string | null): boolean {
	if (!flags) return true;
	return !flags.includes("\\Seen");
}

export function isFlagged(flags: string | null): boolean {
	if (!flags) return false;
	return flags.includes("\\Flagged");
}
