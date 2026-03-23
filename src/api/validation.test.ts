import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { parseIntParam, parsePagination } from "./validation.js";

describe("parseIntParam", () => {
	const app = new Hono();

	app.get("/test/:id", (c) => {
		const id = parseIntParam(c, "id", c.req.param("id"));
		if (id instanceof Response) return id;
		return c.json({ id });
	});

	test("valid positive integer", async () => {
		const res = await app.request("/test/42");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 42 });
	});

	test("rejects NaN", async () => {
		const res = await app.request("/test/abc");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Invalid id: must be a positive integer" });
	});

	test("rejects zero", async () => {
		const res = await app.request("/test/0");
		expect(res.status).toBe(400);
	});

	test("rejects negative", async () => {
		const res = await app.request("/test/-5");
		expect(res.status).toBe(400);
	});

	test("rejects float", async () => {
		const res = await app.request("/test/3.14");
		expect(res.status).toBe(400);
	});

	test("rejects Infinity", async () => {
		const res = await app.request("/test/Infinity");
		expect(res.status).toBe(400);
	});
});

describe("parsePagination", () => {
	const app = new Hono();

	app.get("/test", (c) => {
		const pagination = parsePagination(c);
		if (pagination instanceof Response) return pagination;
		return c.json(pagination);
	});

	test("defaults to limit=50 offset=0", async () => {
		const res = await app.request("/test");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ limit: 50, offset: 0 });
	});

	test("accepts valid limit and offset", async () => {
		const res = await app.request("/test?limit=25&offset=100");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ limit: 25, offset: 100 });
	});

	test("clamps limit to maxLimit (200)", async () => {
		const res = await app.request("/test?limit=500");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ limit: 200, offset: 0 });
	});

	test("rejects negative limit", async () => {
		const res = await app.request("/test?limit=-1");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "limit must be a positive integer" });
	});

	test("rejects NaN limit", async () => {
		const res = await app.request("/test?limit=abc");
		expect(res.status).toBe(400);
	});

	test("rejects negative offset", async () => {
		const res = await app.request("/test?offset=-10");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "offset must be a non-negative integer" });
	});

	test("rejects NaN offset", async () => {
		const res = await app.request("/test?offset=xyz");
		expect(res.status).toBe(400);
	});

	test("floors float limit", async () => {
		const res = await app.request("/test?limit=25.7");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ limit: 25, offset: 0 });
	});

	test("floors float offset", async () => {
		const res = await app.request("/test?offset=10.9");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ limit: 50, offset: 10 });
	});
});
