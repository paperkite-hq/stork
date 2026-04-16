import { Hono } from "hono";
import {
	cancelRecoveryKeyRotation,
	changePassword,
	confirmRecoveryKeyRotation,
	hasPendingRecoveryRotation,
	initializeEncryption,
	prepareRecoveryKeyRotation,
	setPasswordFromVaultKey,
	unlockWithPassword,
	unlockWithRecovery,
} from "../../crypto/keys.js";
import type { ContainerContext } from "../../crypto/lifecycle.js";
import { transitionToUnlocked } from "../../crypto/lifecycle.js";

// Progressive rate limiting for failed unlock attempts (ms delays)
const UNLOCK_DELAYS = [0, 1000, 2000, 4000, 8000, 16000, 30000];
let failedUnlockAttempts = 0;
let lastFailedUnlockAt = 0;

function getUnlockDelay(): number {
	// Reset counter after 10 minutes of no attempts
	if (Date.now() - lastFailedUnlockAt > 600_000) failedUnlockAttempts = 0;
	return UNLOCK_DELAYS[Math.min(failedUnlockAttempts, UNLOCK_DELAYS.length - 1)];
}

export function encryptionRoutes(context: ContainerContext): Hono {
	const api = new Hono();

	api.get("/health", (c) => {
		return c.json({ status: "ok", version: "0.1.0" });
	});

	api.get("/status", (c) => {
		return c.json({ state: context.state });
	});

	api.post("/setup", async (c) => {
		if (context.state !== "setup") {
			return c.json({ error: "Already initialized" }, 409);
		}
		const body = await c.req.json();
		if (!body.password || typeof body.password !== "string") {
			return c.json({ error: "password is required" }, 400);
		}
		if (body.password.length < 12) {
			return c.json({ error: "Password must be at least 12 characters" }, 400);
		}
		const mnemonic = initializeEncryption(context.dataDir, body.password);
		const vaultKey = unlockWithPassword(context.dataDir, body.password);
		transitionToUnlocked(context, vaultKey);
		return c.json({ recoveryMnemonic: mnemonic }, 201);
	});

	api.post("/unlock", async (c) => {
		if (context.state === "setup") {
			return c.json({ error: "Not initialized — use /api/setup first" }, 409);
		}
		if (context.state === "unlocked") {
			return c.json({ ok: true, alreadyUnlocked: true });
		}

		const delay = getUnlockDelay();
		if (delay > 0) {
			await new Promise((r) => setTimeout(r, delay));
		}

		const body = await c.req.json();

		let vaultKey: Buffer;
		try {
			if (body.recoveryMnemonic) {
				vaultKey = unlockWithRecovery(context.dataDir, body.recoveryMnemonic);
				if (!body.newPassword || typeof body.newPassword !== "string") {
					return c.json({ error: "newPassword is required when using recovery mnemonic" }, 400);
				}
				setPasswordFromVaultKey(context.dataDir, vaultKey, body.newPassword);
			} else if (body.password) {
				vaultKey = unlockWithPassword(context.dataDir, body.password);
			} else {
				return c.json({ error: "password or recoveryMnemonic is required" }, 400);
			}
		} catch {
			failedUnlockAttempts++;
			lastFailedUnlockAt = Date.now();
			return c.json({ error: "Invalid password or recovery key" }, 401);
		}

		failedUnlockAttempts = 0;
		try {
			transitionToUnlocked(context, vaultKey);
			return c.json({ ok: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("Unlock succeeded but failed to open database:", msg);
			return c.json({ error: `Unlock succeeded but failed to open database: ${msg}` }, 500);
		}
	});

	api.post("/change-password", async (c) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		const body = await c.req.json();
		if (!body.currentPassword || !body.newPassword) {
			return c.json({ error: "currentPassword and newPassword are required" }, 400);
		}
		if (body.newPassword.length < 12) {
			return c.json({ error: "Password must be at least 12 characters" }, 400);
		}
		try {
			changePassword(context.dataDir, body.currentPassword, body.newPassword);
			return c.json({ ok: true });
		} catch {
			return c.json({ error: "Current password is incorrect" }, 401);
		}
	});

	api.post("/rotate-recovery-key", async (c) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		const body = await c.req.json();
		if (!body.password) {
			return c.json({ error: "password is required to authorize recovery key rotation" }, 400);
		}
		try {
			const newMnemonic = prepareRecoveryKeyRotation(context.dataDir, body.password);
			return c.json({ recoveryMnemonic: newMnemonic, pending: true });
		} catch {
			return c.json({ error: "Password is incorrect" }, 401);
		}
	});

	api.post("/confirm-recovery-rotation", async (c) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		const body = await c.req.json();
		if (!body.password) {
			return c.json({ error: "password is required to confirm recovery key rotation" }, 400);
		}
		try {
			confirmRecoveryKeyRotation(context.dataDir, body.password);
			return c.json({ ok: true });
		} catch (e) {
			const msg = (e as Error).message;
			if (msg.includes("No pending")) {
				return c.json({ error: msg }, 409);
			}
			return c.json({ error: "Password is incorrect" }, 401);
		}
	});

	api.post("/cancel-recovery-rotation", async (c) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		cancelRecoveryKeyRotation(context.dataDir);
		return c.json({ ok: true });
	});

	api.get("/recovery-rotation-status", (c) => {
		if (context.state !== "unlocked") {
			return c.json({ error: "Container is locked", state: context.state }, 423);
		}
		return c.json({ pending: hasPendingRecoveryRotation(context.dataDir) });
	});

	return api;
}
