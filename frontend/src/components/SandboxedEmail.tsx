import { useCallback, useEffect, useMemo, useRef } from "react";
import { extractSearchTerms } from "../utils";

/**
 * Walk all text nodes in a parsed HTML document and wrap search term matches
 * in <mark> elements. Operates on text nodes only — never touches tag names
 * or attribute values — so it is safe to run on sanitized email HTML.
 */
function highlightHtmlTerms(html: string, terms: string[]): string {
	if (terms.length === 0) return html;
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const regex = new RegExp(`(${terms.join("|")})`, "gi");

	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		textNodes.push(node as Text);
		node = walker.nextNode();
	}

	for (const textNode of textNodes) {
		const text = textNode.textContent ?? "";
		if (!regex.test(text)) {
			regex.lastIndex = 0;
			continue;
		}
		regex.lastIndex = 0;
		const parts = text.split(regex);
		if (parts.length <= 1) continue;

		const fragment = doc.createDocumentFragment();
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i] ?? "";
			if (i % 2 === 1) {
				const mark = doc.createElement("mark");
				mark.textContent = part;
				fragment.appendChild(mark);
			} else if (part) {
				fragment.appendChild(doc.createTextNode(part));
			}
		}
		textNode.parentNode?.replaceChild(fragment, textNode);
	}

	return doc.body.innerHTML;
}

/**
 * Renders sanitized email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - The `sandbox` attribute without `allow-scripts` prevents ALL JavaScript
 *   execution inside the iframe — even if the sanitizer misses a `<script>`
 *   tag or event handler, the browser will refuse to run it.
 * - `allow-same-origin` is safe here because scripts are blocked — it only
 *   lets the parent read `contentDocument` to auto-size the iframe height.
 *   (The dangerous combination is `allow-same-origin` + `allow-scripts`.)
 * - `allow-popups` lets links open in new tabs (combined with target="_blank").
 * - Email HTML is injected via srcdoc, so no network request is made.
 */
interface SandboxedEmailProps {
	html: string;
	className?: string;
	/** When true, the iframe's CSP allows loading remote images (http/https). */
	allowRemoteImages?: boolean;
	/** When true, applies dark-mode-friendly colors inside the iframe. */
	dark?: boolean;
	/** When set, highlights matching search terms in the email body. */
	searchQuery?: string;
}

export function SandboxedEmail({
	html,
	className,
	allowRemoteImages,
	dark,
	searchQuery,
}: SandboxedEmailProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);

	const adjustHeight = useCallback(() => {
		const iframe = iframeRef.current;
		if (!iframe) return;
		try {
			const doc = iframe.contentDocument;
			if (doc?.body) {
				// Use the larger of body and documentElement scrollHeight for accuracy
				const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
				iframe.style.height = `${height}px`;
			}
		} catch {
			// Same-origin access failed — leave at default height
		}
	}, []);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) return;

		const onLoad = () => {
			adjustHeight();
			// Watch for dynamic content changes (e.g. images loading)
			try {
				const doc = iframe.contentDocument;
				if (doc?.body) {
					const observer = new ResizeObserver(adjustHeight);
					observer.observe(doc.body);
					return () => observer.disconnect();
				}
			} catch {
				// Same-origin access failed
			}
		};

		iframe.addEventListener("load", onLoad);
		return () => iframe.removeEventListener("load", onLoad);
	}, [adjustHeight]);

	const highlightedHtml = useMemo(() => {
		if (!searchQuery) return html;
		const terms = extractSearchTerms(searchQuery);
		return highlightHtmlTerms(html, terms);
	}, [html, searchQuery]);

	// Wrap the email HTML with minimal styling to match the parent theme
	const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: ${allowRemoteImages ? "https: http: " : ""}${`${window.location.origin}/api/`};">
<style>
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: ${dark ? "#e5e7eb" : "#1f2937"};
    background: ${dark ? "#111827" : "transparent"};
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  a { color: ${dark ? "#93c5fd" : "#2563eb"}; }
  table { max-width: 100%; }
  pre, code { white-space: pre-wrap; }
  mark { background: ${dark ? "#854d0e" : "#fef08a"}; color: inherit; border-radius: 2px; }
</style>
</head>
<body>${highlightedHtml}</body>
</html>`;

	return (
		<iframe
			ref={iframeRef}
			sandbox="allow-same-origin allow-popups"
			srcDoc={srcdoc}
			title="Email content"
			className={className}
			style={{
				width: "100%",
				border: "none",
				overflow: "hidden",
				minHeight: "50px",
			}}
		/>
	);
}
