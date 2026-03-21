import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: () => Promise.resolve(data),
	};
}

describe("api client", () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("accounts", () => {
		it("list fetches /api/accounts", async () => {
			const accounts = [{ id: 1, name: "Test" }];
			mockFetch.mockResolvedValue(mockJsonResponse(accounts));

			const result = await api.accounts.list();
			expect(result).toEqual(accounts);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("get fetches /api/accounts/:id", async () => {
			const account = { id: 1, name: "Test", email: "test@test.com" };
			mockFetch.mockResolvedValue(mockJsonResponse(account));

			const result = await api.accounts.get(1);
			expect(result).toEqual(account);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("create POSTs to /api/accounts", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ id: 2 }, 200));

			const data = { name: "New", email: "new@test.com", imap_host: "imap.test.com" };
			const result = await api.accounts.create(data);
			expect(result).toEqual({ id: 2 });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(data),
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("update PUTs to /api/accounts/:id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.accounts.update(1, { name: "Updated" });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1",
				expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ name: "Updated" }),
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("delete DELETEs /api/accounts/:id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.accounts.delete(5);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/5",
				expect.objectContaining({
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("syncStatus fetches /api/accounts/:id/sync-status", async () => {
			const status = [{ id: 1, name: "INBOX", message_count: 10 }];
			mockFetch.mockResolvedValue(mockJsonResponse(status));

			const result = await api.accounts.syncStatus(1);
			expect(result).toEqual(status);
		});
	});

	describe("folders", () => {
		it("list fetches /api/accounts/:id/folders", async () => {
			const folders = [{ id: 1, path: "INBOX", name: "INBOX" }];
			mockFetch.mockResolvedValue(mockJsonResponse(folders));

			const result = await api.folders.list(1);
			expect(result).toEqual(folders);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1/folders",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});
	});

	describe("messages", () => {
		it("list fetches messages with default params", async () => {
			const messages = [{ id: 1, subject: "Hello" }];
			mockFetch.mockResolvedValue(mockJsonResponse(messages));

			const result = await api.messages.list(1, 2);
			expect(result).toEqual(messages);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1/folders/2/messages?",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("list passes limit and offset params", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse([]));

			await api.messages.list(1, 2, { limit: 10, offset: 20 });
			const url = mockFetch.mock.calls[0]?.[0] as string;
			expect(url).toContain("limit=10");
			expect(url).toContain("offset=20");
		});

		it("get fetches /api/messages/:id", async () => {
			const msg = { id: 42, subject: "Test" };
			mockFetch.mockResolvedValue(mockJsonResponse(msg));

			const result = await api.messages.get(42);
			expect(result).toEqual(msg);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/42",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("getThread fetches /api/messages/:id/thread", async () => {
			const thread = [{ id: 1 }, { id: 2 }];
			mockFetch.mockResolvedValue(mockJsonResponse(thread));

			const result = await api.messages.getThread(1);
			expect(result).toEqual(thread);
		});

		it("updateFlags PATCHes /api/messages/:id/flags", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, flags: "\\Seen,\\Flagged" }));

			const result = await api.messages.updateFlags(1, { add: ["\\Flagged"] });
			expect(result.flags).toBe("\\Seen,\\Flagged");
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/1/flags",
				expect.objectContaining({
					method: "PATCH",
					body: JSON.stringify({ add: ["\\Flagged"] }),
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("delete DELETEs /api/messages/:id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.messages.delete(99);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/99",
				expect.objectContaining({
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("attachments fetches /api/messages/:id/attachments", async () => {
			const attachments = [{ id: 1, filename: "doc.pdf" }];
			mockFetch.mockResolvedValue(mockJsonResponse(attachments));

			const result = await api.messages.attachments(5);
			expect(result).toEqual(attachments);
		});
	});

	describe("search", () => {
		it("searches with query string", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse([]));

			await api.search("hello");
			const url = mockFetch.mock.calls[0]?.[0] as string;
			expect(url).toContain("q=hello");
		});

		it("passes accountId and limit options", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse([]));

			await api.search("test", { accountId: 3, limit: 5 });
			const url = mockFetch.mock.calls[0]?.[0] as string;
			expect(url).toContain("q=test");
			expect(url).toContain("account_id=3");
			expect(url).toContain("limit=5");
		});
	});

	describe("sync", () => {
		it("status fetches /api/sync/status", async () => {
			const status = { "1": { running: false, lastSync: 1000 } };
			mockFetch.mockResolvedValue(mockJsonResponse(status));

			const result = await api.sync.status();
			expect(result).toEqual(status);
		});
	});

	describe("labels", () => {
		it("list fetches /api/accounts/:id/labels", async () => {
			const labels = [{ id: 1, name: "Inbox" }];
			mockFetch.mockResolvedValue(mockJsonResponse(labels));

			const result = await api.labels.list(1);
			expect(result).toEqual(labels);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1/labels",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("create POSTs to /api/accounts/:id/labels", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ id: 5 }));

			const result = await api.labels.create(1, { name: "Important", color: "#ff0000" });
			expect(result).toEqual({ id: 5 });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1/labels",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ name: "Important", color: "#ff0000" }),
				}),
			);
		});

		it("update PUTs to /api/labels/:id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.labels.update(5, { name: "Updated" });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/labels/5",
				expect.objectContaining({
					method: "PUT",
					body: JSON.stringify({ name: "Updated" }),
				}),
			);
		});

		it("delete DELETEs /api/labels/:id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.labels.delete(5);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/labels/5",
				expect.objectContaining({ method: "DELETE" }),
			);
		});

		it("messages fetches /api/labels/:id/messages", async () => {
			const messages = [{ id: 1, subject: "Hello" }];
			mockFetch.mockResolvedValue(mockJsonResponse(messages));

			const result = await api.labels.messages(3);
			expect(result).toEqual(messages);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/labels/3/messages?",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});

		it("messages passes limit and offset params", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse([]));

			await api.labels.messages(3, { limit: 25, offset: 50 });
			const url = mockFetch.mock.calls[0]?.[0] as string;
			expect(url).toContain("limit=25");
			expect(url).toContain("offset=50");
		});
	});

	describe("messages — extended", () => {
		it("move POSTs to /api/messages/:id/move", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.messages.move(1, 5);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/1/move",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ folder_id: 5 }),
				}),
			);
		});

		it("labels fetches /api/messages/:id/labels", async () => {
			const labels = [{ id: 1, name: "Inbox" }];
			mockFetch.mockResolvedValue(mockJsonResponse(labels));

			const result = await api.messages.labels(1);
			expect(result).toEqual(labels);
		});

		it("addLabels POSTs to /api/messages/:id/labels", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.messages.addLabels(1, [2, 3]);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/1/labels",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ label_ids: [2, 3] }),
				}),
			);
		});

		it("removeLabel DELETEs /api/messages/:id/labels/:labelId", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.messages.removeLabel(1, 5);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/1/labels/5",
				expect.objectContaining({ method: "DELETE" }),
			);
		});

		it("bulk POSTs to /api/messages/bulk", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, count: 3 }));

			const result = await api.messages.bulk([1, 2, 3], "delete");
			expect(result).toEqual({ ok: true, count: 3 });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/bulk",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ ids: [1, 2, 3], action: "delete" }),
				}),
			);
		});

		it("bulk with flag action passes opts", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, count: 2 }));

			await api.messages.bulk([1, 2], "flag", { add: ["\\Seen"] });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/bulk",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ ids: [1, 2], action: "flag", add: ["\\Seen"] }),
				}),
			);
		});

		it("bulk with move action passes folder_id", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, count: 1 }));

			await api.messages.bulk([5], "move", { folder_id: 10 });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/messages/bulk",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ ids: [5], action: "move", folder_id: 10 }),
				}),
			);
		});
	});

	describe("encryption", () => {
		it("setup POSTs to /api/setup", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ recoveryMnemonic: "word1 word2" }));

			const result = await api.encryption.setup("password123");
			expect(result).toEqual({ recoveryMnemonic: "word1 word2" });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/setup",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ password: "password123" }),
				}),
			);
		});

		it("unlock POSTs to /api/unlock with password", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.encryption.unlock({ password: "secret" });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/unlock",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ password: "secret" }),
				}),
			);
		});

		it("unlock POSTs to /api/unlock with recovery mnemonic", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

			await api.encryption.unlock({
				recoveryMnemonic: "word1 word2 word3",
				newPassword: "newpass",
			});
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/unlock",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						recoveryMnemonic: "word1 word2 word3",
						newPassword: "newpass",
					}),
				}),
			);
		});
	});

	describe("status", () => {
		it("fetches /api/status", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ state: "unlocked" }));

			const result = await api.status();
			expect(result).toEqual({ state: "unlocked" });
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/status",
				expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
			);
		});
	});

	describe("sync — extended", () => {
		it("trigger POSTs to /api/accounts/:id/sync", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({}));

			await api.sync.trigger(1);
			expect(mockFetch).toHaveBeenCalledWith(
				"/api/accounts/1/sync",
				expect.objectContaining({ method: "POST" }),
			);
		});
	});

	describe("error handling", () => {
		it("throws on non-ok response with error message", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ error: "Not found" }, 404));

			await expect(api.accounts.get(999)).rejects.toThrow("Not found");
		});

		it("falls back to statusText when no error in body", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: () => Promise.reject(new Error("bad json")),
			});

			await expect(api.accounts.list()).rejects.toThrow("Internal Server Error");
		});

		it("passes AbortSignal to fetch for timeout", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse([]));

			await api.accounts.list();
			const init = mockFetch.mock.calls[0]?.[1];
			expect(init.signal).toBeInstanceOf(AbortSignal);
		});

		it("converts AbortError to a timeout message", async () => {
			const abortError = new DOMException("signal is aborted", "AbortError");
			mockFetch.mockRejectedValue(abortError);

			await expect(api.accounts.list()).rejects.toThrow(/timed out/);
		});
	});
});
