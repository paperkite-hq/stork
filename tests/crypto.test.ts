import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	changePassword,
	initializeEncryption,
	keysFileExists,
	rotateRecoveryKey,
	unlockWithPassword,
	unlockWithRecovery,
} from "../src/crypto/keys.js";

let dataDir: string;

beforeEach(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-crypto-test-"));
});

afterEach(() => {
	fs.rmSync(dataDir, { recursive: true });
});

describe("initializeEncryption", () => {
	test("creates stork.keys file", () => {
		initializeEncryption(dataDir, "strongpassword123!");
		expect(keysFileExists(dataDir)).toBe(true);
	});

	test("returns a 24-word BIP39 mnemonic", () => {
		const mnemonic = initializeEncryption(dataDir, "strongpassword123!");
		const words = mnemonic.trim().split(/\s+/);
		expect(words).toHaveLength(24);
	});

	test("stork.keys has expected structure", () => {
		initializeEncryption(dataDir, "strongpassword123!");
		const raw = fs.readFileSync(path.join(dataDir, "stork.keys"), "utf8");
		const keys = JSON.parse(raw);
		expect(keys.version).toBe(1);
		expect(keys.kdf.algorithm).toBe("argon2id");
		expect(keys.wrappedMasterKey.password).toBeTruthy();
		expect(keys.wrappedMasterKey.recovery).toBeTruthy();
	});
});

describe("unlockWithPassword", () => {
	test("returns vault key buffer on correct password", () => {
		initializeEncryption(dataDir, "correctpass123!");
		const vaultKey = unlockWithPassword(dataDir, "correctpass123!");
		expect(vaultKey).toBeInstanceOf(Buffer);
		expect(vaultKey.length).toBe(32);
		vaultKey.fill(0);
	});

	test("throws on wrong password", () => {
		initializeEncryption(dataDir, "correctpass123!");
		expect(() => unlockWithPassword(dataDir, "wrongpassword!")).toThrow();
	});
});

describe("unlockWithRecovery", () => {
	test("returns vault key on valid mnemonic", () => {
		const mnemonic = initializeEncryption(dataDir, "somepass456!");
		const vaultKey = unlockWithRecovery(dataDir, mnemonic);
		expect(vaultKey).toBeInstanceOf(Buffer);
		expect(vaultKey.length).toBe(32);
		vaultKey.fill(0);
	});

	test("vault key from recovery matches vault key from password", () => {
		const mnemonic = initializeEncryption(dataDir, "somepass456!");
		const vaultKeyFromPass = unlockWithPassword(dataDir, "somepass456!");
		const vaultKeyFromRecovery = unlockWithRecovery(dataDir, mnemonic);
		expect(vaultKeyFromPass.toString("hex")).toBe(vaultKeyFromRecovery.toString("hex"));
		vaultKeyFromPass.fill(0);
		vaultKeyFromRecovery.fill(0);
	});

	test("throws on invalid mnemonic", () => {
		initializeEncryption(dataDir, "somepass456!");
		expect(() => unlockWithRecovery(dataDir, "not a valid mnemonic at all")).toThrow();
	});
});

describe("changePassword", () => {
	test("new password unlocks successfully", () => {
		initializeEncryption(dataDir, "oldpassword123!");
		changePassword(dataDir, "oldpassword123!", "newpassword456!");
		const vaultKey = unlockWithPassword(dataDir, "newpassword456!");
		expect(vaultKey).toBeInstanceOf(Buffer);
		vaultKey.fill(0);
	});

	test("old password fails after change", () => {
		initializeEncryption(dataDir, "oldpassword123!");
		changePassword(dataDir, "oldpassword123!", "newpassword456!");
		expect(() => unlockWithPassword(dataDir, "oldpassword123!")).toThrow();
	});

	test("vault key is unchanged after password change", () => {
		initializeEncryption(dataDir, "oldpassword123!");
		const vaultKeyBefore = unlockWithPassword(dataDir, "oldpassword123!");
		changePassword(dataDir, "oldpassword123!", "newpassword456!");
		const vaultKeyAfter = unlockWithPassword(dataDir, "newpassword456!");
		expect(vaultKeyBefore.toString("hex")).toBe(vaultKeyAfter.toString("hex"));
		vaultKeyBefore.fill(0);
		vaultKeyAfter.fill(0);
	});

	test("recovery key still works after password change", () => {
		const mnemonic = initializeEncryption(dataDir, "oldpassword123!");
		changePassword(dataDir, "oldpassword123!", "newpassword456!");
		const vaultKey = unlockWithRecovery(dataDir, mnemonic);
		expect(vaultKey).toBeInstanceOf(Buffer);
		vaultKey.fill(0);
	});
});

describe("rotateRecoveryKey", () => {
	test("returns a new 24-word mnemonic", () => {
		initializeEncryption(dataDir, "pass123!abc");
		const newMnemonic = rotateRecoveryKey(dataDir, "pass123!abc");
		const words = newMnemonic.trim().split(/\s+/);
		expect(words).toHaveLength(24);
	});

	test("new mnemonic unlocks vault", () => {
		initializeEncryption(dataDir, "pass123!abc");
		const newMnemonic = rotateRecoveryKey(dataDir, "pass123!abc");
		const vaultKey = unlockWithRecovery(dataDir, newMnemonic);
		expect(vaultKey).toBeInstanceOf(Buffer);
		vaultKey.fill(0);
	});

	test("vault key unchanged after rotation", () => {
		initializeEncryption(dataDir, "pass123!abc");
		const vaultKeyBefore = unlockWithPassword(dataDir, "pass123!abc");
		const newMnemonic = rotateRecoveryKey(dataDir, "pass123!abc");
		const vaultKeyAfter = unlockWithRecovery(dataDir, newMnemonic);
		expect(vaultKeyBefore.toString("hex")).toBe(vaultKeyAfter.toString("hex"));
		vaultKeyBefore.fill(0);
		vaultKeyAfter.fill(0);
	});

	test("password still works after recovery key rotation", () => {
		initializeEncryption(dataDir, "pass123!abc");
		rotateRecoveryKey(dataDir, "pass123!abc");
		const vaultKey = unlockWithPassword(dataDir, "pass123!abc");
		expect(vaultKey).toBeInstanceOf(Buffer);
		vaultKey.fill(0);
	});
});
