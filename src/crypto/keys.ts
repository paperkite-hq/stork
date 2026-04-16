/**
 * Key management for Stork encryption at rest.
 *
 * Two-tier vault key pattern:
 *   - Vault Key (MDK): random 256-bit key, encrypts the SQLite database
 *   - Password envelope: Argon2id KDF → KEK → AES-256-GCM wraps vault key
 *   - Recovery envelope: BIP39 mnemonic → 32-byte key → AES-256-GCM wraps vault key
 *
 * Credential rotation (password change, recovery key rotation) is O(1): only the
 * envelope blob is re-encrypted; the vault key and database are untouched.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argon2id } from "@noble/hashes/argon2.js";
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from "bip39";

// ── Argon2id parameters ────────────────────────────────────────────────────
// Use fast KDF in test mode to avoid timeouts under coverage instrumentation
const FAST_KDF = process.env.STORK_FAST_KDF === "1";
const ARGON2_MEMORY = FAST_KDF ? 1024 : 65536; // 1 MiB test / 64 MiB prod
const ARGON2_ITERATIONS = FAST_KDF ? 1 : 3;
const ARGON2_PARALLELISM = 1;
const KEY_BYTES = 32; // 256-bit keys throughout

// ── stork.keys file format ─────────────────────────────────────────────────

interface WrappedKey {
	iv: string; // base64, 12 bytes
	ciphertext: string; // base64, encrypted vault key
	tag: string; // base64, 16 bytes GCM auth tag
}

interface KeysFile {
	version: 1;
	kdf: {
		algorithm: "argon2id";
		salt: string; // base64, 32 bytes
		memoryCost: number;
		timeCost: number;
		parallelism: number;
	};
	wrappedMasterKey: {
		password: WrappedKey;
		recovery: WrappedKey;
		pendingRecovery?: WrappedKey; // present during two-phase rotation
	};
}

// ── Crypto primitives ──────────────────────────────────────────────────────

function generateVaultKey(): Buffer {
	return randomBytes(KEY_BYTES);
}

interface KdfParams {
	memoryCost: number;
	timeCost: number;
	parallelism: number;
}

function deriveKEK(password: string, salt: Buffer, params?: KdfParams): Buffer {
	const key = argon2id(password, salt, {
		m: params?.memoryCost ?? ARGON2_MEMORY,
		t: params?.timeCost ?? ARGON2_ITERATIONS,
		p: params?.parallelism ?? ARGON2_PARALLELISM,
		dkLen: KEY_BYTES,
	});
	return Buffer.from(key);
}

function recoveryMnemonicToKey(mnemonic: string): Buffer {
	// BIP39 entropy → 32 bytes (256-bit mnemonic → 32-byte raw entropy)
	const entropy = mnemonicToEntropy(mnemonic);
	return Buffer.from(entropy, "hex");
}

function wrapKey(vaultKey: Buffer, wrappingKey: Buffer): WrappedKey {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
	const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		iv: iv.toString("base64"),
		ciphertext: ciphertext.toString("base64"),
		tag: tag.toString("base64"),
	};
}

function unwrapKey(envelope: WrappedKey, wrappingKey: Buffer): Buffer {
	const iv = Buffer.from(envelope.iv, "base64");
	const ciphertext = Buffer.from(envelope.ciphertext, "base64");
	const tag = Buffer.from(envelope.tag, "base64");
	const decipher = createDecipheriv("aes-256-gcm", wrappingKey, iv);
	decipher.setAuthTag(tag);
	try {
		const vaultKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		return vaultKey;
	} catch {
		throw new Error("Decryption failed: wrong password or corrupted key file");
	}
}

function zeroBuffer(buf: Buffer): void {
	buf.fill(0);
}

// ── Key file I/O ───────────────────────────────────────────────────────────

function keysFilePath(dataDir: string): string {
	return join(dataDir, "stork.keys");
}

export function keysFileExists(dataDir: string): boolean {
	return existsSync(keysFilePath(dataDir));
}

function readKeysFile(dataDir: string): KeysFile {
	const raw = readFileSync(keysFilePath(dataDir), "utf8");
	return JSON.parse(raw) as KeysFile;
}

function writeKeysFile(dataDir: string, data: KeysFile): void {
	const path = keysFilePath(dataDir);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(tmp, path);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * First-boot setup: generate vault key, wrap with both password and recovery key.
 * Writes stork.keys and returns the 24-word BIP39 recovery mnemonic for display.
 */
export function initializeEncryption(dataDir: string, password: string): string {
	const vaultKey = generateVaultKey();
	const passwordSalt = randomBytes(KEY_BYTES);
	const kek = deriveKEK(password, passwordSalt);

	// Generate recovery mnemonic (24 words = 256 bits of entropy)
	const recoveryMnemonic = generateMnemonic(256);
	const recoveryKey = recoveryMnemonicToKey(recoveryMnemonic);

	const keysData: KeysFile = {
		version: 1,
		kdf: {
			algorithm: "argon2id",
			salt: passwordSalt.toString("base64"),
			memoryCost: ARGON2_MEMORY,
			timeCost: ARGON2_ITERATIONS,
			parallelism: ARGON2_PARALLELISM,
		},
		wrappedMasterKey: {
			password: wrapKey(vaultKey, kek),
			recovery: wrapKey(vaultKey, recoveryKey),
		},
	};

	writeKeysFile(dataDir, keysData);

	zeroBuffer(kek);
	zeroBuffer(recoveryKey);
	// vaultKey is returned conceptually — caller must zero it after opening the DB
	zeroBuffer(vaultKey);

	return recoveryMnemonic;
}

/**
 * Unlock with password. Returns the vault key buffer.
 * Caller MUST zero the returned buffer after passing it to SQLCipher.
 */
export function unlockWithPassword(dataDir: string, password: string): Buffer {
	const keysData = readKeysFile(dataDir);
	const passwordSalt = Buffer.from(keysData.kdf.salt, "base64");
	const kek = deriveKEK(password, passwordSalt, keysData.kdf);
	try {
		const vaultKey = unwrapKey(keysData.wrappedMasterKey.password, kek);
		zeroBuffer(kek);
		return vaultKey;
	} catch (e) {
		zeroBuffer(kek);
		throw e;
	}
}

/**
 * Unlock with BIP39 recovery mnemonic. Returns the vault key buffer.
 * Tries both the active recovery envelope and any pending rotation envelope.
 */
export function unlockWithRecovery(dataDir: string, mnemonic: string): Buffer {
	if (!validateMnemonic(mnemonic)) {
		throw new Error("Invalid recovery mnemonic");
	}
	const keysData = readKeysFile(dataDir);
	const recoveryKey = recoveryMnemonicToKey(mnemonic);

	// Try active recovery envelope first
	try {
		const vaultKey = unwrapKey(keysData.wrappedMasterKey.recovery, recoveryKey);
		zeroBuffer(recoveryKey);
		return vaultKey;
	} catch {
		// Fall through to try pending envelope
	}

	// Try pending recovery envelope (mid-rotation state)
	if (keysData.wrappedMasterKey.pendingRecovery) {
		try {
			const vaultKey = unwrapKey(keysData.wrappedMasterKey.pendingRecovery, recoveryKey);
			zeroBuffer(recoveryKey);
			return vaultKey;
		} catch {
			// Both failed
		}
	}

	zeroBuffer(recoveryKey);
	throw new Error("Decryption failed: wrong password or corrupted key file");
}

/**
 * Change password. Re-wraps vault key with new KEK. O(1) — database untouched.
 */
export function changePassword(
	dataDir: string,
	currentPassword: string,
	newPassword: string,
): void {
	const vaultKey = unlockWithPassword(dataDir, currentPassword);
	const keysData = readKeysFile(dataDir);

	const newSalt = randomBytes(KEY_BYTES);
	const newKek = deriveKEK(newPassword, newSalt);

	keysData.kdf.salt = newSalt.toString("base64");
	keysData.wrappedMasterKey.password = wrapKey(vaultKey, newKek);

	writeKeysFile(dataDir, keysData);

	zeroBuffer(newKek);
	zeroBuffer(vaultKey);
}

/**
 * Rotate recovery key — Phase 1 (prepare).
 *
 * Generates a new recovery envelope and stores it as `pendingRecovery` alongside
 * the existing `recovery` envelope. Both the old and new mnemonics will unlock
 * the vault until the rotation is confirmed or cancelled.
 *
 * Returns the new 24-word BIP39 mnemonic for the user to write down.
 */
export function prepareRecoveryKeyRotation(dataDir: string, currentPassword: string): string {
	const vaultKey = unlockWithPassword(dataDir, currentPassword);
	const keysData = readKeysFile(dataDir);

	const newMnemonic = generateMnemonic(256);
	const newRecoveryKey = recoveryMnemonicToKey(newMnemonic);

	keysData.wrappedMasterKey.pendingRecovery = wrapKey(vaultKey, newRecoveryKey);

	writeKeysFile(dataDir, keysData);

	zeroBuffer(newRecoveryKey);
	zeroBuffer(vaultKey);

	return newMnemonic;
}

/**
 * Rotate recovery key — Phase 2 (confirm).
 *
 * Promotes `pendingRecovery` to `recovery` and deletes the old envelope.
 * After this call, only the new mnemonic (from prepareRecoveryKeyRotation) works.
 * Requires password to authorize.
 */
export function confirmRecoveryKeyRotation(dataDir: string, currentPassword: string): void {
	// Verify password is correct
	const vaultKey = unlockWithPassword(dataDir, currentPassword);
	zeroBuffer(vaultKey);

	const keysData = readKeysFile(dataDir);
	if (!keysData.wrappedMasterKey.pendingRecovery) {
		throw new Error("No pending recovery key rotation to confirm");
	}

	keysData.wrappedMasterKey.recovery = keysData.wrappedMasterKey.pendingRecovery;
	keysData.wrappedMasterKey.pendingRecovery = undefined;

	writeKeysFile(dataDir, keysData);
}

/**
 * Cancel a pending recovery key rotation.
 *
 * Removes the `pendingRecovery` envelope, leaving the original recovery key intact.
 */
export function cancelRecoveryKeyRotation(dataDir: string): void {
	const keysData = readKeysFile(dataDir);
	if (!keysData.wrappedMasterKey.pendingRecovery) {
		return; // nothing to cancel
	}

	keysData.wrappedMasterKey.pendingRecovery = undefined;
	writeKeysFile(dataDir, keysData);
}

/**
 * Check whether a recovery key rotation is pending confirmation.
 */
export function hasPendingRecoveryRotation(dataDir: string): boolean {
	if (!keysFileExists(dataDir)) return false;
	const keysData = readKeysFile(dataDir);
	return !!keysData.wrappedMasterKey.pendingRecovery;
}

/**
 * @deprecated Use prepareRecoveryKeyRotation + confirmRecoveryKeyRotation instead.
 * Kept for backward compatibility — performs an atomic (non-resilient) rotation.
 */
export function rotateRecoveryKey(dataDir: string, currentPassword: string): string {
	const vaultKey = unlockWithPassword(dataDir, currentPassword);
	const keysData = readKeysFile(dataDir);

	const newMnemonic = generateMnemonic(256);
	const newRecoveryKey = recoveryMnemonicToKey(newMnemonic);

	keysData.wrappedMasterKey.recovery = wrapKey(vaultKey, newRecoveryKey);

	writeKeysFile(dataDir, keysData);

	zeroBuffer(newRecoveryKey);
	zeroBuffer(vaultKey);

	return newMnemonic;
}

/**
 * Set a new password using an already-unwrapped vault key.
 * Used during recovery unlock to set a new password without knowing the old one.
 */
export function setPasswordFromVaultKey(
	dataDir: string,
	vaultKey: Buffer,
	newPassword: string,
): void {
	const keysData = readKeysFile(dataDir);

	const newSalt = randomBytes(KEY_BYTES);
	const newKek = deriveKEK(newPassword, newSalt);

	keysData.kdf.salt = newSalt.toString("base64");
	keysData.wrappedMasterKey.password = wrapKey(vaultKey, newKek);

	writeKeysFile(dataDir, keysData);

	zeroBuffer(newKek);
}

/**
 * Unlock with vault key already in hand (used after initializeEncryption sets up keys
 * and the caller needs to also open the database in the same session).
 * Re-derives vault key from password.
 */
export function getVaultKey(dataDir: string, password: string): Buffer {
	return unlockWithPassword(dataDir, password);
}
