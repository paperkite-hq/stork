import Database from "better-sqlite3-multiple-ciphers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MIGRATIONS } from "../storage/schema.js";
import { MessageSearch } from "./search.js";

describe("MessageSearch", () => {
	let db: Database.Database;
	let search: MessageSearch;

	beforeAll(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(MIGRATIONS[0]);

		// Insert test account and folder
		db.prepare(
			"INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass) VALUES (?, ?, ?, ?, ?)",
		).run("Test", "test@example.com", "imap.example.com", "test", "pass");

		db.prepare(
			"INSERT INTO folders (account_id, path, name, uid_validity) VALUES (?, ?, ?, ?)",
		).run(1, "INBOX", "Inbox", 1);

		// Insert test messages
		const insert = db.prepare(`
			INSERT INTO messages (account_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, date, text_body, flags)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		insert.run(
			1,
			1,
			1,
			"<msg1@example.com>",
			"Project update for Q4",
			"alice@example.com",
			"Alice Smith",
			'["test@example.com"]',
			"2026-01-15T10:00:00Z",
			"Here is the quarterly project update with budget details.",
			"[]",
		);

		insert.run(
			1,
			1,
			2,
			"<msg2@example.com>",
			"Lunch tomorrow?",
			"bob@example.com",
			"Bob Jones",
			'["test@example.com"]',
			"2026-01-16T14:30:00Z",
			"Want to grab lunch at the new Thai place tomorrow?",
			"[]",
		);

		insert.run(
			1,
			1,
			3,
			"<msg3@example.com>",
			"Invoice #2847",
			"billing@vendor.com",
			"Vendor Billing",
			'["test@example.com"]',
			"2026-01-17T09:00:00Z",
			"Please find attached the invoice for January services.",
			"[]",
		);

		search = new MessageSearch(db);
	});

	afterAll(() => {
		db.close();
	});

	test("finds messages by subject keyword", () => {
		const results = search.search("project");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Project update for Q4");
	});

	test("finds messages by body content", () => {
		const results = search.search("Thai");
		expect(results).toHaveLength(1);
		expect(results[0].from_address).toBe("bob@example.com");
	});

	test("finds messages by sender", () => {
		const results = search.search("alice");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Project update for Q4");
	});

	test("returns empty for no matches", () => {
		const results = search.search("nonexistent");
		expect(results).toHaveLength(0);
	});

	test("respects limit parameter", () => {
		const results = search.search("example", { limit: 1 });
		expect(results).toHaveLength(1);
	});

	test("respects offset parameter", () => {
		const all = search.search("example");
		const withOffset = search.search("example", { offset: 1 });
		expect(withOffset.length).toBeLessThan(all.length);
	});

	test("includes snippet with highlighting", () => {
		const results = search.search("quarterly");
		expect(results).toHaveLength(1);
		expect(results[0].snippet).toContain("<mark>");
	});
});
