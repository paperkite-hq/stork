import { expect, test } from "@playwright/test";

test.describe("App layout and navigation", () => {
	test("loads the app with sidebar and message list", async ({ page }) => {
		await page.goto("/");
		// Sidebar should show Stork branding
		await expect(page.getByText("Stork")).toBeVisible();
		// Folder list should show Inbox in the promoted sidebar section
		await expect(page.getByRole("button", { name: /Inbox/ })).toBeVisible();
		// Should show compose button (use role to avoid matching SVG <title>Compose</title>)
		await expect(page.getByRole("button", { name: /compose/i }).first()).toBeVisible();
	});

	test("shows folder list with correct folders", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("button", { name: /Inbox/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /Sent/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /Drafts/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /Trash/ })).toBeVisible();
	});

	test("shows message list for inbox", async ({ page }) => {
		await page.goto("/");
		// Should see test emails — use exact match to avoid #1 matching #10
		await expect(page.getByText("E2E Test Email #1", { exact: true })).toBeVisible();
		await expect(page.getByText("Sender 1", { exact: true })).toBeVisible();
	});

	test("shows unread count badge on Inbox", async ({ page }) => {
		await page.goto("/");
		// Check the Inbox promoted button contains the unread badge
		const inboxBtn = page.getByRole("button", { name: /Inbox/ });
		await expect(inboxBtn).toBeVisible();
		await expect(inboxBtn).toContainText("3");
	});

	test("shows message count header", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("15 messages")).toBeVisible();
	});

	test("API health endpoint is reachable", async ({ request }) => {
		const response = await request.get("/api/health");
		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.status).toBe("ok");
	});
});

test.describe("Message interaction", () => {
	test("clicking a message shows its detail", async ({ page }) => {
		await page.goto("/");
		// Click on a specific email — use exact match
		await page.getByText("E2E Test Email #2", { exact: true }).click();
		// Email HTML is rendered inside a sandboxed iframe — use frameLocator to access it
		const emailFrame = page.frameLocator('iframe[title="Email content"]');
		await expect(emailFrame.getByText(/HTML body.*test email number 2/)).toBeVisible();
	});

	test("message detail shows sender info", async ({ page }) => {
		await page.goto("/");
		await page.getByText("E2E Test Email #2", { exact: true }).click();
		await expect(page.getByText("sender2@example.com")).toBeVisible();
	});

	test("starred message is visible in list", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("Important Starred Email")).toBeVisible();
	});

	test("message with attachment shows attachment indicator", async ({ page }) => {
		await page.goto("/");
		await page.getByText("Email with Attachment").click();
		await expect(page.getByText("document.pdf")).toBeVisible();
	});

	test("threaded conversation shows related messages", async ({ page }) => {
		await page.goto("/");
		// Click the first thread message — use the button role
		await page
			.getByRole("button", { name: /Thread: Project Discussion/ })
			.first()
			.click();
		// Thread view should show the original message content — use .first() since
		// snippets may also appear in the message list preview pane
		await expect(
			page.getByText(/discuss the project timeline|Sounds good|Next week works/).first(),
		).toBeVisible();
	});

	test("reply button opens compose modal", async ({ page }) => {
		await page.goto("/");
		await page.getByText("E2E Test Email #2", { exact: true }).click();
		await expect(page.getByText("sender2@example.com")).toBeVisible();
		// Click reply — use first() since there might be Reply and Reply All
		await page.getByRole("button", { name: /reply/i }).first().click();
		// Compose modal should open with To and Subject inputs
		await expect(page.getByPlaceholder("recipient@example.com")).toBeVisible();
	});
});

test.describe("Folder navigation", () => {
	test("switching to Sent folder shows sent messages", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("button", { name: /Sent/ }).click();
		await expect(page.getByText("Outgoing Test")).toBeVisible();
	});

	test("switching to empty Drafts folder shows empty state", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("button", { name: /Drafts/ }).click();
		// Should show empty state
		await expect(page.getByText("No messages in this folder")).toBeVisible();
	});

	test("switching back to Inbox restores message list", async ({ page }) => {
		await page.goto("/");
		await page.getByRole("button", { name: /Sent/ }).click();
		await expect(page.getByText("Outgoing Test")).toBeVisible();
		await page.getByRole("button", { name: /Inbox/ }).click();
		await expect(page.getByText("E2E Test Email #2", { exact: true })).toBeVisible();
	});
});

test.describe("Compose", () => {
	test("compose button opens compose modal", async ({ page }) => {
		await page.goto("/");
		// Use role selector to avoid matching SVG <title>Compose</title>
		await page
			.getByRole("button", { name: /compose/i })
			.first()
			.click();
		// Modal should appear with compose form elements
		await expect(page.getByPlaceholder("recipient@example.com")).toBeVisible();
	});

	test("compose modal can be dismissed", async ({ page }) => {
		await page.goto("/");
		// Use role selector to avoid matching SVG <title>Compose</title>
		await page
			.getByRole("button", { name: /compose/i })
			.first()
			.click();
		// Wait for compose modal to appear
		await expect(page.getByPlaceholder("recipient@example.com")).toBeVisible();
		// Dismiss with Escape
		await page.keyboard.press("Escape");
		await expect(page.getByPlaceholder("recipient@example.com")).not.toBeVisible();
	});
});

test.describe("Search", () => {
	test("search button is visible in sidebar", async ({ page }) => {
		await page.goto("/");
		// Search is a button that says "Search mail…"
		await expect(page.getByText("Search mail")).toBeVisible();
	});

	test("clicking search button opens search panel", async ({ page }) => {
		await page.goto("/");
		await page.getByText("Search mail").click();
		// Search panel should open with an input field
		await expect(page.getByPlaceholder("Search messages…")).toBeVisible();
	});
});

test.describe("Keyboard shortcuts", () => {
	test("? opens shortcuts help modal", async ({ page }) => {
		await page.goto("/");
		// Click on message list area first to ensure focus is not in an input
		await page.locator("body").click();
		await page.keyboard.press("?");
		await expect(page.getByText("Keyboard Shortcuts")).toBeVisible();
	});

	test("Escape closes shortcuts help", async ({ page }) => {
		await page.goto("/");
		await page.locator("body").click();
		await page.keyboard.press("?");
		await expect(page.getByText("Keyboard Shortcuts")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByText("Keyboard Shortcuts")).not.toBeVisible();
	});

	test("j/k navigate message list", async ({ page }) => {
		await page.goto("/");
		await page.locator("body").click();
		// Press j to move down in the message list
		await page.keyboard.press("j");
		// Press Enter to open the selected message
		await page.keyboard.press("Enter");
		// Message detail should appear (sender email visible)
		await expect(
			page.locator("[class*='text-gray']").filter({ hasText: /@/ }).first(),
		).toBeVisible();
	});
});

test.describe("Dark mode", () => {
	test("dark mode toggle is visible", async ({ page }) => {
		await page.goto("/");
		// Dark mode toggle uses title attribute for accessibility
		await expect(page.getByTitle("Toggle dark mode")).toBeVisible();
	});

	test("clicking dark mode toggle changes theme", async ({ page }) => {
		await page.goto("/");
		await page.getByTitle("Toggle dark mode").click();
		// Wait for dark class to be applied to the document
		await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
		const hasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
		expect(hasDark).toBeTruthy();
	});
});

test.describe("Settings", () => {
	test("settings gear opens settings panel", async ({ page }) => {
		await page.goto("/");
		// Settings is a gear icon button with title "Settings"
		await page.getByTitle("Settings").click();
		// Settings panel should show account info
		await expect(page.getByText("E2E Test Account")).toBeVisible();
	});
});

test.describe("API integration", () => {
	test("GET /api/accounts returns seeded account", async ({ request }) => {
		const response = await request.get("/api/accounts");
		expect(response.ok()).toBeTruthy();
		const accounts = await response.json();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].name).toBe("E2E Test Account");
		expect(accounts[0].email).toBe("e2e@test.local");
	});

	test("GET /api/accounts/:id/folders returns seeded folders", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const response = await request.get(`/api/accounts/${accountId}/folders`);
		expect(response.ok()).toBeTruthy();
		const folders = await response.json();
		expect(folders.length).toBeGreaterThanOrEqual(4);
		const names = folders.map((f: { name: string }) => f.name);
		expect(names).toContain("INBOX");
		expect(names).toContain("Sent");
		expect(names).toContain("Drafts");
		expect(names).toContain("Trash");
	});

	test("GET messages returns inbox messages", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const response = await request.get(`/api/accounts/${accountId}/folders/${inbox.id}/messages`);
		expect(response.ok()).toBeTruthy();
		const messages = await response.json();
		expect(messages.length).toBeGreaterThanOrEqual(10);
	});

	test("GET /api/messages/:id returns message detail", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const messagesRes = await request.get(
			`/api/accounts/${accountId}/folders/${inbox.id}/messages?limit=1`,
		);
		const messages = await messagesRes.json();
		const msgId = messages[0].id;

		const response = await request.get(`/api/messages/${msgId}`);
		expect(response.ok()).toBeTruthy();
		const message = await response.json();
		expect(message.subject).toBeDefined();
		expect(message.from_address).toBeDefined();
	});

	test("PATCH flags updates message flags", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const messagesRes = await request.get(
			`/api/accounts/${accountId}/folders/${inbox.id}/messages?limit=1`,
		);
		const messages = await messagesRes.json();
		const msgId = messages[0].id;

		const response = await request.patch(`/api/messages/${msgId}/flags`, {
			data: { add: ["\\Flagged"] },
		});
		expect(response.ok()).toBeTruthy();
		const result = await response.json();
		expect(result.flags).toContain("\\Flagged");
	});

	test("GET /api/search returns results", async ({ request }) => {
		const response = await request.get("/api/search?q=important");
		expect(response.ok()).toBeTruthy();
		const results = await response.json();
		expect(Array.isArray(results)).toBeTruthy();
	});

	test("POST and DELETE account lifecycle", async ({ request }) => {
		const response = await request.post("/api/accounts", {
			data: {
				name: "New E2E Account",
				email: "new@test.local",
				imap_host: "127.0.0.1",
				imap_port: 993,
				imap_user: "newuser",
				imap_pass: "newpass",
			},
		});
		expect(response.status()).toBe(201);
		const result = await response.json();
		expect(result.id).toBeDefined();

		const deleteRes = await request.delete(`/api/accounts/${result.id}`);
		expect(deleteRes.ok()).toBeTruthy();
	});

	test("GET thread returns related messages", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const messagesRes = await request.get(
			`/api/accounts/${accountId}/folders/${inbox.id}/messages`,
		);
		const messages = await messagesRes.json();
		const threadMsg = messages.find((m: { subject: string }) =>
			m.subject.includes("Thread: Project Discussion"),
		);
		if (threadMsg) {
			const response = await request.get(`/api/messages/${threadMsg.id}/thread`);
			expect(response.ok()).toBeTruthy();
			const thread = await response.json();
			expect(thread.length).toBeGreaterThanOrEqual(1);
		}
	});

	test("GET attachments lists message attachments", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const messagesRes = await request.get(
			`/api/accounts/${accountId}/folders/${inbox.id}/messages`,
		);
		const messages = await messagesRes.json();
		const attachMsg = messages.find(
			(m: { subject: string }) => m.subject === "Email with Attachment",
		);
		if (attachMsg) {
			const response = await request.get(`/api/messages/${attachMsg.id}/attachments`);
			expect(response.ok()).toBeTruthy();
			const attachments = await response.json();
			expect(attachments.length).toBeGreaterThanOrEqual(1);
			expect(attachments[0].filename).toBe("document.pdf");
		}
	});

	test("DELETE message removes it", async ({ request }) => {
		const accountsRes = await request.get("/api/accounts");
		const accounts = await accountsRes.json();
		const accountId = accounts[0].id;

		const foldersRes = await request.get(`/api/accounts/${accountId}/folders`);
		const folders = await foldersRes.json();
		const inbox = folders.find((f: { name: string }) => f.name === "INBOX");

		const messagesRes = await request.get(
			`/api/accounts/${accountId}/folders/${inbox.id}/messages`,
		);
		const messages = await messagesRes.json();
		const lastMsg = messages[messages.length - 1];

		const response = await request.delete(`/api/messages/${lastMsg.id}`);
		expect(response.ok()).toBeTruthy();

		const verifyRes = await request.get(`/api/messages/${lastMsg.id}`);
		expect(verifyRes.status()).toBe(404);
	});
});
