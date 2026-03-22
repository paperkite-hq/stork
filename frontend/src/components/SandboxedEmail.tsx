import { useCallback, useEffect, useRef } from "react";

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
}

export function SandboxedEmail({ html, className, allowRemoteImages, dark }: SandboxedEmailProps) {
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
</style>
</head>
<body>${html}</body>
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
