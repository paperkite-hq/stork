/**
 * Generates documentation screenshots for the README and docs.
 * Run via: npm run screenshots:generate
 *
 * Output: docs/screenshots/{inbox,thread,compose}.png
 */
import { test } from "@playwright/test";

test("inbox screenshot", async ({ page }) => {
	await page.goto("/");
	// Wait for message list to fully load. Use "button" (element selector), not
	// '[role="button"]' (attribute selector) — <button> elements have an implicit
	// ARIA role of "button" but no explicit role attribute, so the attribute
	// selector never matches.
	await page.waitForSelector("button");
	await page.waitForTimeout(300);
	await page.screenshot({ path: "docs/screenshots/inbox.png" });
});

test("thread screenshot", async ({ page }) => {
	await page.goto("/");
	// Open the code review thread (2-message thread in Alex (Work) inbox — first account alphabetically)
	await page
		.getByRole("button", { name: /Code review: feat\/cache-invalidation/ })
		.first()
		.click();
	// Wait for thread view to render
	await page.waitForTimeout(400);
	await page.screenshot({ path: "docs/screenshots/thread.png" });
});

test("compose screenshot", async ({ page }) => {
	await page.goto("/");
	// Open compose modal — use role to avoid matching SVG <title>
	await page
		.getByRole("button", { name: /compose/i })
		.first()
		.click();
	// Wait for modal animation
	await page.waitForTimeout(300);
	await page.screenshot({ path: "docs/screenshots/compose.png" });
});
