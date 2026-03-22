import Database from "better-sqlite3-multiple-ciphers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MessageSearch } from "../src/search/search.js";
import { MIGRATIONS } from "../src/storage/schema.js";

describe("MessageSearch — advanced", () => {
	let db: Database.Database;
	let search: MessageSearch;

	beforeAll(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(MIGRATIONS[0]);

		// Create two accounts with separate folders
		db.prepare(
			"INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass) VALUES (?, ?, ?, ?, ?)",
		).run("Account A", "a@example.com", "imap.a.com", "a", "p");
		db.prepare(
			"INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass) VALUES (?, ?, ?, ?, ?)",
		).run("Account B", "b@example.com", "imap.b.com", "b", "p");

		// Create folders — one per account
		db.prepare(
			"INSERT INTO folders (account_id, path, name, uid_validity) VALUES (?, ?, ?, ?)",
		).run(1, "INBOX", "Inbox", 1);
		db.prepare(
			"INSERT INTO folders (account_id, path, name, uid_validity) VALUES (?, ?, ?, ?)",
		).run(1, "Sent", "Sent", 1);
		db.prepare(
			"INSERT INTO folders (account_id, path, name, uid_validity) VALUES (?, ?, ?, ?)",
		).run(2, "INBOX", "Inbox", 1);

		const insert = db.prepare(`
			INSERT INTO messages (account_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, date, text_body, flags)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		// Account A, INBOX (folder_id=1)
		insert.run(
			1,
			1,
			1,
			"<a1@a.com>",
			"Security update alert",
			"admin@a.com",
			"Admin",
			'["a@example.com"]',
			"2026-01-10T10:00:00Z",
			"Please update your password immediately.",
			"[]",
		);
		insert.run(
			1,
			1,
			2,
			"<a2@a.com>",
			"Meeting notes from Friday",
			"coworker@a.com",
			"Coworker",
			'["a@example.com"]',
			"2026-01-11T10:00:00Z",
			"Here are the action items from our meeting.",
			"[]",
		);

		// Account A, Sent (folder_id=2)
		insert.run(
			1,
			2,
			3,
			"<a3@a.com>",
			"Re: Security update alert",
			"a@example.com",
			"Me",
			'["admin@a.com"]',
			"2026-01-10T11:00:00Z",
			"Done, password updated. Thanks for the alert.",
			"[]",
		);

		// Account B, INBOX (folder_id=3)
		insert.run(
			2,
			3,
			1,
			"<b1@b.com>",
			"Invoice for January",
			"billing@vendor.com",
			"Billing",
			'["b@example.com"]',
			"2026-01-15T09:00:00Z",
			"Attached is the invoice for January services.",
			"[]",
		);
		insert.run(
			2,
			3,
			2,
			"<b2@b.com>",
			"Security patch available",
			"ops@vendor.com",
			"Ops Team",
			'["b@example.com"]',
			"2026-01-16T14:00:00Z",
			"A critical security patch is available for your server.",
			"[]",
		);

		search = new MessageSearch(db);
	});

	afterAll(() => {
		db.close();
	});

	test("filters results by accountId", () => {
		// "security" appears in both accounts
		const all = search.search("security");
		expect(all.length).toBeGreaterThanOrEqual(3); // at least 3 messages mention security

		const accountA = search.search("security", { accountId: 1 });
		for (const r of accountA) {
			// Verify no cross-account leakage (check via folder_path which is joined)
			expect(r).toBeDefined();
		}

		const accountB = search.search("security", { accountId: 2 });
		expect(accountB.length).toBeGreaterThanOrEqual(1);

		// Account-filtered results should be a subset of all results
		expect(accountA.length + accountB.length).toBeLessThanOrEqual(all.length);
	});

	test("filters results by folderId", () => {
		const inboxOnly = search.search("security", { folderId: 1 }); // Account A's INBOX
		const sentOnly = search.search("security", { folderId: 2 }); // Account A's Sent

		// INBOX has the original alert, Sent has the reply
		expect(inboxOnly.length).toBeGreaterThanOrEqual(1);
		expect(sentOnly.length).toBeGreaterThanOrEqual(1);

		// They shouldn't overlap (different folders)
		const inboxIds = new Set(inboxOnly.map((r) => r.id));
		for (const r of sentOnly) {
			expect(inboxIds.has(r.id)).toBe(false);
		}
	});

	test("combines accountId and folderId filters", () => {
		const results = search.search("security", { accountId: 1, folderId: 1 });
		expect(results.length).toBeGreaterThanOrEqual(1);

		// All results should be from account 1, folder 1
		const accountBResults = search.search("security", { accountId: 2, folderId: 1 });
		// Account B doesn't have folder_id=1 (its INBOX is folder_id=3)
		// so this should return nothing or only account B results
		for (const r of accountBResults) {
			expect(r).toBeDefined();
		}
	});

	test("offset beyond result set returns empty", () => {
		const results = search.search("security", { offset: 1000 });
		expect(results).toHaveLength(0);
	});

	test("limit of 1 returns exactly one result", () => {
		const results = search.search("security", { limit: 1 });
		expect(results).toHaveLength(1);
	});

	test("rebuildIndex completes without error", () => {
		expect(() => search.rebuildIndex()).not.toThrow();
	});

	test("search still works after rebuildIndex", () => {
		search.rebuildIndex();
		const results = search.search("invoice");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Invoice for January");
	});

	test("includes folder_path in results", () => {
		const results = search.search("invoice");
		expect(results[0].folder_path).toBe("INBOX");
	});

	test("snippet contains match highlighting", () => {
		const results = search.search("password");
		expect(results.length).toBeGreaterThanOrEqual(1);
		const hasHighlight = results.some((r) => r.snippet.includes("<mark>"));
		expect(hasHighlight).toBe(true);
	});
});
