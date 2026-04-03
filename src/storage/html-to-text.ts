/**
 * Lightweight HTML-to-text extraction for FTS indexing.
 *
 * Used as a fallback when an email has no plain-text MIME part — strips tags,
 * decodes common HTML entities, and collapses whitespace so FTS5 has something
 * meaningful to index. Not intended for display — just search.
 */

/** Common HTML entities. Covers the vast majority of email content. */
const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "\u2014",
	ndash: "\u2013",
	lsquo: "\u2018",
	rsquo: "\u2019",
	ldquo: "\u201C",
	rdquo: "\u201D",
	bull: "\u2022",
	hellip: "\u2026",
	copy: "\u00A9",
	reg: "\u00AE",
	trade: "\u2122",
};

/**
 * Extract searchable plain text from an HTML string.
 *
 * Returns null if input is null/undefined or if the result is empty after
 * stripping (e.g. an HTML email that's just images with no alt text).
 */
export function htmlToText(html: string | null | undefined): string | null {
	if (html == null) return null;

	let text = html;

	// Remove <style> and <script> blocks entirely (content + tags)
	text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
	text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

	// Insert newlines before block-level elements for readability
	text = text.replace(/<\/?(?:p|div|br|h[1-6]|li|tr|blockquote|hr)[^>]*\/?>/gi, "\n");

	// Strip all remaining HTML tags
	text = text.replace(/<[^>]+>/g, "");

	// Decode numeric entities (&#123; and &#x1F; forms)
	text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
		String.fromCodePoint(Number.parseInt(hex, 16)),
	);
	text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));

	// Decode named entities
	text = text.replace(/&([a-zA-Z]+);/g, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

	// Collapse whitespace: runs of spaces/tabs → single space, 3+ newlines → 2
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");
	text = text.trim();

	return text.length > 0 ? text : null;
}
