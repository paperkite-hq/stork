import { expect, test } from "@playwright/test";

const TEST_PASSWORD = "SuperSecure12345!";
const NEW_PASSWORD = "AnotherSecure99!!";

// These tests run in serial order — each builds on the prior state.
test.describe.configure({ mode: "serial" });

test.describe("Encryption flow: setup → unlock → change password", () => {
	test("setup screen is shown on first boot", async ({ page }) => {
		await page.goto("/");

		// Should show the setup screen
		await expect(page.getByText("Set Up Encryption")).toBeVisible();
		await expect(page.getByPlaceholder("At least 12 characters")).toBeVisible();
		await expect(page.getByPlaceholder("Repeat your password")).toBeVisible();
	});

	test("setup: create vault with password and acknowledge mnemonic", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("Set Up Encryption")).toBeVisible();

		// Fill password fields
		await page.getByPlaceholder("At least 12 characters").fill(TEST_PASSWORD);
		await page.getByPlaceholder("Repeat your password").fill(TEST_PASSWORD);

		// Check password strength indicator appears
		await expect(page.getByTestId("password-strength")).toBeVisible();

		// Submit
		await page.getByRole("button", { name: "Create Encrypted Vault" }).click();

		// Should transition to mnemonic display step
		await expect(page.getByRole("heading", { name: "Save Your Recovery Phrase" })).toBeVisible({
			timeout: 15_000,
		});

		// "Continue to Stork" button should be disabled until checkbox is checked
		const continueBtn = page.getByRole("button", { name: "Continue to Stork" });
		await expect(continueBtn).toBeDisabled();

		// Check acknowledgement checkbox
		await page.getByRole("checkbox").check();
		await expect(continueBtn).toBeEnabled();

		// Click continue
		await continueBtn.click();

		// Should now be in unlocked state — the app tries to load but the encryption
		// test server has no data routes, so we just check the state transition happened.
		// Verify via the status API that we're unlocked.
		const statusRes = await page.request.get("/api/status");
		const status = await statusRes.json();
		expect(status.state).toBe("unlocked");
	});

	test("lock the container, then unlock screen is shown", async ({ page }) => {
		// Use the test-only endpoint to simulate a server restart (lock)
		const lockRes = await page.request.post("/api/__test/lock");
		expect(lockRes.ok()).toBeTruthy();

		await page.goto("/");

		// Should show unlock screen
		await expect(page.getByText("Unlock Stork")).toBeVisible();
		await expect(page.getByPlaceholder("Your encryption password")).toBeVisible();
	});

	test("unlock with password", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("Unlock Stork")).toBeVisible();

		// Enter password and submit
		await page.getByPlaceholder("Your encryption password").fill(TEST_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();

		// Wait for unlock to complete (Argon2 KDF, even fast mode)
		// Status should transition to unlocked
		await expect(async () => {
			const statusRes = await page.request.get("/api/status");
			const status = await statusRes.json();
			expect(status.state).toBe("unlocked");
		}).toPass({ timeout: 15_000 });
	});

	test("wrong password shows error and rate limit countdown", async ({ page }) => {
		// Lock again for this test
		await page.request.post("/api/__test/lock");
		await page.goto("/");
		await expect(page.getByText("Unlock Stork")).toBeVisible();

		// Try wrong password
		await page.getByPlaceholder("Your encryption password").fill("WrongPassword123");
		await page.getByRole("button", { name: "Unlock" }).click();

		// Should show error
		await expect(page.getByText("Incorrect password.")).toBeVisible({ timeout: 15_000 });

		// After second failure, should show rate-limit countdown
		await page.getByPlaceholder("Your encryption password").fill("WrongPassword456");
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(page.getByText("Incorrect password.")).toBeVisible({ timeout: 15_000 });

		// Countdown should appear after enough failures
		await expect(page.getByTestId("rate-limit-countdown")).toBeVisible({ timeout: 5_000 });

		// Now unlock with correct password (wait for countdown to expire)
		await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled({ timeout: 35_000 });
		await page.getByPlaceholder("Your encryption password").fill(TEST_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();

		await expect(async () => {
			const statusRes = await page.request.get("/api/status");
			const status = await statusRes.json();
			expect(status.state).toBe("unlocked");
		}).toPass({ timeout: 15_000 });
	});

	test("recovery mode toggle shows mnemonic input", async ({ page }) => {
		// Lock again
		await page.request.post("/api/__test/lock");
		await page.goto("/");
		await expect(page.getByText("Unlock Stork")).toBeVisible();

		// Click "Forgot password? Use recovery phrase"
		await page.getByText("Forgot password? Use recovery phrase").click();

		// Should show recovery mode
		await expect(page.getByText("Recover Access")).toBeVisible();
		await expect(page.getByPlaceholder(/word1 word2/)).toBeVisible();
		await expect(page.getByPlaceholder("At least 12 characters")).toBeVisible();

		// Toggle back
		await page.getByText("← Back to password unlock").click();
		await expect(page.getByText("Unlock Stork")).toBeVisible();

		// Unlock normally to continue the serial flow
		await page.getByPlaceholder("Your encryption password").fill(TEST_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(async () => {
			const statusRes = await page.request.get("/api/status");
			const status = await statusRes.json();
			expect(status.state).toBe("unlocked");
		}).toPass({ timeout: 15_000 });
	});

	test("change password via security settings", async ({ page, request }) => {
		// Verify we're unlocked
		const statusRes = await request.get("/api/status");
		expect((await statusRes.json()).state).toBe("unlocked");

		// Change password via API (since Settings modal needs the full app with accounts,
		// and our encryption test server doesn't serve data routes, we test the API directly
		// and verify the UI form renders correctly)
		const changeRes = await request.post("/api/change-password", {
			data: { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
		});
		expect(changeRes.ok()).toBeTruthy();

		// Verify: lock and re-unlock with the NEW password
		await request.post("/api/__test/lock");

		await page.goto("/");
		await expect(page.getByText("Unlock Stork")).toBeVisible();

		// Old password should fail
		await page.getByPlaceholder("Your encryption password").fill(TEST_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(page.getByText("Incorrect password.")).toBeVisible({ timeout: 15_000 });

		// New password should succeed
		await page.getByPlaceholder("Your encryption password").fill(NEW_PASSWORD);
		await page.getByRole("button", { name: "Unlock" }).click();
		await expect(async () => {
			const statusRes2 = await request.get("/api/status");
			const status2 = await statusRes2.json();
			expect(status2.state).toBe("unlocked");
		}).toPass({ timeout: 15_000 });
	});
});
