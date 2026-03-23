import type { Context } from "hono";

/**
 * Parse a route parameter as a positive integer.
 * Returns the number if valid, or a 400 Response if NaN/negative/zero.
 */
export function parseIntParam(c: Context, name: string, value: string): number | Response {
	const n = Number(value);
	if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) {
		return c.json({ error: `Invalid ${name}: must be a positive integer` }, 400);
	}
	return n;
}

/**
 * Parse limit/offset query parameters with bounds enforcement.
 * Limit is clamped to [1, maxLimit] (default 200). Offset must be >= 0.
 */
export function parsePagination(
	c: Context,
	opts?: { defaultLimit?: number; maxLimit?: number },
): { limit: number; offset: number } | Response {
	const defaultLimit = opts?.defaultLimit ?? 50;
	const maxLimit = opts?.maxLimit ?? 200;

	const rawLimit = c.req.query("limit");
	const rawOffset = c.req.query("offset");

	let limit = defaultLimit;
	if (rawLimit !== undefined) {
		limit = Number(rawLimit);
		if (!Number.isFinite(limit) || limit < 1) {
			return c.json({ error: "limit must be a positive integer" }, 400);
		}
		limit = Math.min(Math.floor(limit), maxLimit);
	}

	let offset = 0;
	if (rawOffset !== undefined) {
		offset = Number(rawOffset);
		if (!Number.isFinite(offset) || offset < 0) {
			return c.json({ error: "offset must be a non-negative integer" }, 400);
		}
		offset = Math.floor(offset);
	}

	return { limit, offset };
}
