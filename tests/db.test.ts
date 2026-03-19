import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "@signalapp/better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ensureSchema, openDatabase } from "../src/storage/db.js";
import { SCHEMA_VERSION } from "../src/storage/schema.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stork-db-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true });
});

describe("openDatabase", () => {
	test("creates database file in specified directory", () => {
		const db = openDatabase("test.db", tmpDir);
		db.close();
		expect(fs.existsSync(path.join(tmpDir, "test.db"))).toBe(true);
	});

	test("returns a database with schema applied", () => {
		const db = openDatabase("test.db", tmpDir);
		const row = db.prepare("SELECT version FROM schema_version").get() as
			| { version: number }
			| undefined;
		expect(row).toBeTruthy();
		expect(row?.version).toBe(SCHEMA_VERSION);
		db.close();
	});

	test("default filename is stork.db", () => {
		const db = openDatabase(undefined, tmpDir);
		db.close();
		expect(fs.existsSync(path.join(tmpDir, "stork.db"))).toBe(true);
	});

	test("enables foreign keys pragma", () => {
		const db = openDatabase("pragma-test.db", tmpDir);
		const result = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
		expect(result.foreign_keys).toBe(1);
		db.close();
	});
});

describe("ensureSchema", () => {
	test("is idempotent — calling twice does not duplicate schema", () => {
		const db = new Database(":memory:");
		ensureSchema(db);
		ensureSchema(db);
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
	});

	test("applies all migrations to reach current SCHEMA_VERSION", () => {
		const db = new Database(":memory:");
		ensureSchema(db);
		const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
		expect(row.version).toBe(SCHEMA_VERSION);
	});
});
