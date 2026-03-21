import Database from "@signalapp/better-sqlite3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MessageSearch, parseSearchQuery } from "../src/search/search.js";
import { MIGRATIONS } from "../src/storage/schema.js";

describe("parseSearchQuery", () => {
	test("extracts from: operator", () => {
		const result = parseSearchQuery("from:alice@test.com hello");
		expect(result.ftsQuery).toBe("hello");
		expect(result.filters).toEqual([{ type: "from", value: "alice@test.com" }]);
	});

	test("extracts to: operator", () => {
		const result = parseSearchQuery("to:bob@test.com world");
		expect(result.ftsQuery).toBe("world");
		expect(result.filters).toEqual([{ type: "to", value: "bob@test.com" }]);
	});

	test("extracts subject: with quoted value", () => {
		const result = parseSearchQuery('subject:"meeting notes" important');
		expect(result.ftsQuery).toBe("important");
		expect(result.filters).toEqual([{ type: "subject", value: "meeting notes" }]);
	});

	test("extracts has:attachment", () => {
		const result = parseSearchQuery("has:attachment invoice");
		expect(result.ftsQuery).toBe("invoice");
		expect(result.filters).toEqual([{ type: "has", value: "attachment" }]);
	});

	test("extracts is:unread", () => {
		const result = parseSearchQuery("is:unread");
		expect(result.ftsQuery).toBe("");
		expect(result.filters).toEqual([{ type: "is", value: "unread" }]);
	});

	test("extracts is:starred", () => {
		const result = parseSearchQuery("is:starred important");
		expect(result.ftsQuery).toBe("important");
		expect(result.filters).toEqual([{ type: "is", value: "starred" }]);
	});

	test("extracts before: and after: dates", () => {
		const result = parseSearchQuery("after:2024-01-01 before:2024-12-31 test");
		expect(result.ftsQuery).toBe("test");
		expect(result.filters).toHaveLength(2);
		expect(result.filters[0]).toEqual({ type: "after", value: "2024-01-01" });
		expect(result.filters[1]).toEqual({ type: "before", value: "2024-12-31" });
	});

	test("extracts label: operator", () => {
		const result = parseSearchQuery("label:inbox hello");
		expect(result.ftsQuery).toBe("hello");
		expect(result.filters).toEqual([{ type: "label", value: "inbox" }]);
	});

	test("handles multiple operators", () => {
		const result = parseSearchQuery("from:alice to:bob has:attachment hello");
		expect(result.ftsQuery).toBe("hello");
		expect(result.filters).toHaveLength(3);
	});

	test("returns empty filters for plain queries", () => {
		const result = parseSearchQuery("hello world");
		expect(result.ftsQuery).toBe("hello world");
		expect(result.filters).toHaveLength(0);
	});

	test("is case-insensitive for operators", () => {
		const result = parseSearchQuery("FROM:alice@test.com");
		expect(result.filters).toEqual([{ type: "from", value: "alice@test.com" }]);
	});

	test("handles operator-only query", () => {
		const result = parseSearchQuery("from:alice is:unread has:attachment");
		expect(result.ftsQuery).toBe("");
		expect(result.filters).toHaveLength(3);
	});
});

describe("MessageSearch — structured operators", () => {
	let db: Database.Database;
	let search: MessageSearch;

	beforeAll(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		db.exec(MIGRATIONS[0]);
		db.exec(MIGRATIONS[2]); // labels

		db.prepare(
			"INSERT INTO accounts (name, email, imap_host, imap_user, imap_pass) VALUES (?, ?, ?, ?, ?)",
		).run("Test", "test@example.com", "imap.test.com", "test", "pass");

		db.prepare(
			"INSERT INTO folders (account_id, path, name, uid_validity) VALUES (?, ?, ?, ?)",
		).run(1, "INBOX", "Inbox", 1);

		const insert = db.prepare(`
			INSERT INTO messages (account_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, cc_addresses, date, text_body, flags, has_attachments)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		// Message 1: unread, from alice, with attachment
		insert.run(
			1,
			1,
			1,
			"<m1@test.com>",
			"Project proposal",
			"alice@example.com",
			"Alice Smith",
			'["test@example.com"]',
			null,
			"2026-01-10T10:00:00Z",
			"Here is the project proposal document.",
			"[]",
			1,
		);

		// Message 2: read, starred, from bob, cc to carol
		insert.run(
			1,
			1,
			2,
			"<m2@test.com>",
			"Meeting tomorrow",
			"bob@example.com",
			"Bob Jones",
			'["test@example.com"]',
			'["carol@example.com"]',
			"2026-01-15T14:00:00Z",
			"Let's meet tomorrow at 3pm.",
			'["\\\\Seen", "\\\\Flagged"]',
			0,
		);

		// Message 3: unread, from alice, no attachment
		insert.run(
			1,
			1,
			3,
			"<m3@test.com>",
			"Follow-up on proposal",
			"alice@example.com",
			"Alice Smith",
			'["test@example.com"]',
			null,
			"2026-02-01T09:00:00Z",
			"Just checking in on the proposal status.",
			"[]",
			0,
		);

		// Message 4: read, from charlie, old date
		insert.run(
			1,
			1,
			4,
			"<m4@test.com>",
			"Invoice December",
			"charlie@vendor.com",
			"Charlie",
			'["test@example.com"]',
			null,
			"2025-12-20T08:00:00Z",
			"December invoice attached.",
			'["\\\\Seen"]',
			1,
		);

		// Create a label and assign it
		db.prepare("INSERT INTO labels (account_id, name, color, source) VALUES (?, ?, ?, ?)").run(
			1,
			"Important",
			"#ef4444",
			"user",
		);
		db.prepare("INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)").run(1, 1); // Message 1 has "Important" label

		search = new MessageSearch(db);
	});

	afterAll(() => {
		db.close();
	});

	test("from: filters by sender address", () => {
		const results = search.search("from:alice");
		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(r.from_address).toContain("alice");
		}
	});

	test("from: matches sender name", () => {
		const results = search.search("from:Smith");
		expect(results).toHaveLength(2);
	});

	test("to: filters by recipient", () => {
		const results = search.search("to:carol");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Meeting tomorrow");
	});

	test("subject: filters by subject line", () => {
		const results = search.search("subject:proposal");
		expect(results).toHaveLength(2);
	});

	test("subject: with quoted phrase", () => {
		const results = search.search('subject:"Meeting tomorrow"');
		expect(results).toHaveLength(1);
		expect(results[0].from_address).toBe("bob@example.com");
	});

	test("has:attachment filters messages with attachments", () => {
		const results = search.search("has:attachment");
		expect(results).toHaveLength(2);
		for (const r of results) {
			expect(["Project proposal", "Invoice December"]).toContain(r.subject);
		}
	});

	test("is:unread filters unread messages", () => {
		const results = search.search("is:unread");
		expect(results).toHaveLength(2);
	});

	test("is:read filters read messages", () => {
		const results = search.search("is:read");
		expect(results).toHaveLength(2);
	});

	test("is:starred filters flagged messages", () => {
		const results = search.search("is:starred");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Meeting tomorrow");
	});

	test("before: filters by date", () => {
		const results = search.search("before:2026-01-01");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Invoice December");
	});

	test("after: filters by date", () => {
		const results = search.search("after:2026-01-20");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Follow-up on proposal");
	});

	test("date range with before: and after:", () => {
		const results = search.search("after:2026-01-01 before:2026-01-31");
		expect(results).toHaveLength(2); // Jan 10 and Jan 15
	});

	test("label: filters by label name", () => {
		const results = search.search("label:Important");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Project proposal");
	});

	test("combines FTS with from: filter", () => {
		const results = search.search("proposal from:alice");
		expect(results).toHaveLength(2);
	});

	test("combines FTS with has:attachment", () => {
		const results = search.search("invoice has:attachment");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Invoice December");
	});

	test("combines multiple operators", () => {
		const results = search.search("from:alice is:unread has:attachment");
		expect(results).toHaveLength(1);
		expect(results[0].subject).toBe("Project proposal");
	});

	test("filter-only query with no FTS text returns results", () => {
		const results = search.search("from:bob is:starred");
		expect(results).toHaveLength(1);
	});

	test("empty filter-only query returns nothing", () => {
		const results = search.search("");
		expect(results).toHaveLength(0);
	});
});
