import DOMPurify from "dompurify";

/**
 * Sanitize an HTML email body: strip unsafe tags/attributes, block tracking
 * pixels and event handlers, then force all links to open in a new tab.
 *
 * When `blockRemoteImages` is true, all `<img>` tags with remote `src`
 * (http/https) are replaced with placeholders. This prevents senders from
 * using tracking pixels or fingerprinting via image loads. The caller can
 * re-render with `blockRemoteImages: false` when the user clicks "Show images".
 */
export function sanitizeEmailHtml(html: string, opts?: { blockRemoteImages?: boolean }): string {
	const blockImages = opts?.blockRemoteImages ?? true;
	const clean = DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		ADD_ATTR: ["target"],
		FORBID_TAGS: ["style", "script", "form", "meta", "link", "object", "embed", "iframe"],
	});
	// Post-process: strip event handler attributes, enforce safe links,
	// and block tracking pixels (1x1 images)
	const div = document.createElement("div");
	div.innerHTML = clean;

	// Remove all event handler attributes (on*)
	for (const el of div.querySelectorAll("*")) {
		for (const attr of [...el.attributes]) {
			if (attr.name.startsWith("on")) {
				el.removeAttribute(attr.name);
			}
		}
	}

	// Force all anchors to open in new tab with safe referrer policy
	for (const a of div.querySelectorAll("a[href]")) {
		a.setAttribute("target", "_blank");
		a.setAttribute("rel", "noopener noreferrer");
	}

	// Handle images: always remove tracking pixels, optionally block all remote images
	for (const img of div.querySelectorAll("img")) {
		const w = img.getAttribute("width");
		const h = img.getAttribute("height");
		// Always strip tracking pixels (1x1 or 0x0)
		if ((w === "1" || w === "0") && (h === "1" || h === "0")) {
			img.remove();
			continue;
		}
		const src = img.getAttribute("src") ?? "";
		// Always strip known tracking patterns
		if (
			src.includes("/track") ||
			src.includes("/pixel") ||
			src.includes("/open") ||
			src.includes("beacon")
		) {
			img.remove();
			continue;
		}
		// Block remote images when enabled (http/https URLs)
		if (blockImages && (src.startsWith("http://") || src.startsWith("https://"))) {
			img.remove();
		}
	}

	return div.innerHTML;
}

/** Returns true if the HTML contains remote images (http/https src) that would be blocked.
 *  Uses a lightweight regex pre-check to avoid a redundant DOMPurify pass. */
export function hasRemoteImages(html: string): boolean {
	// Quick exit: no img tags at all
	if (!/<img\s/i.test(html)) return false;
	// Parse just enough to check src attributes — uses already-sanitized output
	// when called after sanitizeEmailHtml, but also works on raw HTML
	const div = document.createElement("div");
	div.innerHTML = html;
	for (const img of div.querySelectorAll("img")) {
		const src = img.getAttribute("src") ?? "";
		const w = img.getAttribute("width");
		const h = img.getAttribute("height");
		// Skip tracking pixels
		if ((w === "1" || w === "0") && (h === "1" || h === "0")) continue;
		if (
			src.includes("/track") ||
			src.includes("/pixel") ||
			src.includes("/open") ||
			src.includes("beacon")
		)
			continue;
		if (src.startsWith("http://") || src.startsWith("https://")) return true;
	}
	return false;
}

export function formatFullDate(dateStr: string): string {
	return new Date(dateStr).toLocaleString(undefined, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatFileSize(bytes: number | null): string {
	if (bytes === null || bytes === 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
