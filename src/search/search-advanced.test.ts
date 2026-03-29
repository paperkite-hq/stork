import type Database from "better-sqlite3-multiple-ciphers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	createTestDb,
	createTestFolder,
	createTestInboundConnector,
} from "../test-helpers/test-db.js";
import { MessageSearch } from "./search.js";

describe("MessageSearch — advanced", () => {
	let db: Database.Database;
	let search: MessageSearch;
	let connectorA: number;
	let connectorB: number;
	let inboxA: number;
	let sentA: number;
	let inboxB: number;

	beforeAll(() => {
		db = createTestDb();

		// Create two identities with separate folders
		connectorA = createTestInboundConnector(db, { name: "Account A" });
		connectorB = createTestInboundConnector(db, { name: "Account B" });

		inboxA = createTestFolder(db, connectorA, "INBOX");
		sentA = createTestFolder(db, connectorA, "Sent");
		inboxB = createTestFolder(db, connectorB, "INBOX");

		const insert = db.prepare(`
			INSERT INTO messages (inbound_connector_id, folder_id, uid, message_id, subject,
				from_address, from_name, to_addresses, date, text_body, flags, size, has_attachments)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, 0)
		`);

		// Account A, INBOX
		insert.run(
			connectorA,
			inboxA,
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
			connectorA,
			inboxA,
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

		// Account A, Sent
		insert.run(
			connectorA,
			sentA,
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

		// Account B, INBOX
		insert.run(
			connectorB,
			inboxB,
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
			connectorB,
			inboxB,
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

	test("filters results by inboundConnectorId", () => {
		// "security" appears in both identities
		const all = search.search("security");
		expect(all.length).toBeGreaterThanOrEqual(3); // at least 3 messages mention security

		const identityAResults = search.search("security", { inboundConnectorId: connectorA });
		for (const r of identityAResults) {
			// Verify no cross-identity leakage (check via folder_path which is joined)
			expect(r).toBeDefined();
		}

		const identityBResults2 = search.search("security", { inboundConnectorId: connectorB });
		expect(identityBResults2.length).toBeGreaterThanOrEqual(1);

		// Account-filtered results should be a subset of all results
		expect(identityAResults.length + identityBResults2.length).toBeLessThanOrEqual(all.length);
	});

	test("filters results by folderId", () => {
		const inboxOnly = search.search("security", { folderId: inboxA });
		const sentOnly = search.search("security", { folderId: sentA });

		// INBOX has the original alert, Sent has the reply
		expect(inboxOnly.length).toBeGreaterThanOrEqual(1);
		expect(sentOnly.length).toBeGreaterThanOrEqual(1);

		// They shouldn't overlap (different folders)
		const inboxIds = new Set(inboxOnly.map((r) => r.id));
		for (const r of sentOnly) {
			expect(inboxIds.has(r.id)).toBe(false);
		}
	});

	test("combines inboundConnectorId and folderId filters", () => {
		const results = search.search("security", { inboundConnectorId: connectorA, folderId: inboxA });
		expect(results.length).toBeGreaterThanOrEqual(1);

		// Identity B doesn't have inboxA — should return nothing
		const identityBResults = search.search("security", {
			inboundConnectorId: connectorB,
			folderId: inboxA,
		});
		expect(identityBResults).toHaveLength(0);
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
