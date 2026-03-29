import { describe, expect, test } from "vitest";
import { signR2Request } from "./r2-sigv4.js";

describe("signR2Request", () => {
	const baseOpts = {
		method: "GET",
		url: new URL(
			"https://abc123.r2.cloudflarestorage.com/my-bucket?list-type=2&prefix=pending%2F&max-keys=100",
		),
		accessKeyId: "AKIAIOSFODNN7EXAMPLE",
		secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		date: new Date("2024-01-15T12:00:00Z"),
	};

	test("returns all required header fields", () => {
		const headers = signR2Request(baseOpts);
		expect(headers).toHaveProperty("authorization");
		expect(headers).toHaveProperty("x-amz-date");
		expect(headers).toHaveProperty("x-amz-content-sha256");
		expect(headers).toHaveProperty("host");
	});

	test("x-amz-date uses compact ISO format", () => {
		const headers = signR2Request(baseOpts);
		expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(headers["x-amz-date"]).toBe("20240115T120000Z");
	});

	test("host matches the URL host", () => {
		const headers = signR2Request(baseOpts);
		expect(headers.host).toBe("abc123.r2.cloudflarestorage.com");
	});

	test("authorization header has correct format", () => {
		const headers = signR2Request(baseOpts);
		expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
		expect(headers.authorization).toContain(
			"Credential=AKIAIOSFODNN7EXAMPLE/20240115/auto/s3/aws4_request",
		);
		expect(headers.authorization).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
		expect(headers.authorization).toContain("Signature=");
	});

	test("authorization signature is a 64-char hex string", () => {
		const headers = signR2Request(baseOpts);
		const sigMatch = headers.authorization.match(/Signature=([0-9a-f]+)$/);
		expect(sigMatch).not.toBeNull();
		expect(sigMatch?.[1]).toHaveLength(64);
	});

	test("x-amz-content-sha256 is SHA-256 of empty body for GET", () => {
		const headers = signR2Request(baseOpts);
		// SHA-256 of empty string
		expect(headers["x-amz-content-sha256"]).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	test("same inputs produce same output (deterministic)", () => {
		const h1 = signR2Request(baseOpts);
		const h2 = signR2Request(baseOpts);
		expect(h1.authorization).toBe(h2.authorization);
	});

	test("different methods produce different signatures", () => {
		const get = signR2Request({
			...baseOpts,
			url: new URL("https://abc123.r2.cloudflarestorage.com/my-bucket/key.json"),
		});
		const del = signR2Request({
			...baseOpts,
			method: "DELETE",
			url: new URL("https://abc123.r2.cloudflarestorage.com/my-bucket/key.json"),
		});
		expect(get.authorization).not.toBe(del.authorization);
	});

	test("different keys produce different signatures", () => {
		const h1 = signR2Request(baseOpts);
		const h2 = signR2Request({
			...baseOpts,
			accessKeyId: "OTHER_KEY_ID",
			secretAccessKey: "otherSecret",
		});
		expect(h1.authorization).not.toBe(h2.authorization);
	});

	test("query params are sorted in canonical request", () => {
		// Both URLs have same params in different order — should produce same signature
		const url1 = new URL(
			"https://abc123.r2.cloudflarestorage.com/bucket?list-type=2&prefix=a%2F&max-keys=10",
		);
		const url2 = new URL(
			"https://abc123.r2.cloudflarestorage.com/bucket?max-keys=10&prefix=a%2F&list-type=2",
		);
		const h1 = signR2Request({ ...baseOpts, url: url1 });
		const h2 = signR2Request({ ...baseOpts, url: url2 });
		expect(h1.authorization).toBe(h2.authorization);
	});

	test("body hash reflects provided body content", () => {
		const bodyBytes = new TextEncoder().encode('{"hello":"world"}');
		const withBody = signR2Request({
			...baseOpts,
			method: "PUT",
			url: new URL("https://abc123.r2.cloudflarestorage.com/bucket/key"),
			body: bodyBytes,
		});
		expect(withBody["x-amz-content-sha256"]).not.toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		// SHA-256 of '{"hello":"world"}' is deterministic
		const withBody2 = signR2Request({
			...baseOpts,
			method: "PUT",
			url: new URL("https://abc123.r2.cloudflarestorage.com/bucket/key"),
			body: bodyBytes,
		});
		expect(withBody["x-amz-content-sha256"]).toBe(withBody2["x-amz-content-sha256"]);
	});

	test("uses current date when no date provided", () => {
		const before = Date.now();
		const headers = signR2Request({
			method: "GET",
			url: new URL("https://abc.r2.cloudflarestorage.com/bucket"),
			accessKeyId: "key",
			secretAccessKey: "secret",
		});
		const after = Date.now();
		// x-amz-date should be within the current minute
		const amzMs = new Date(
			headers["x-amz-date"].replace(
				/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
				"$1-$2-$3T$4:$5:$6Z",
			),
		).getTime();
		expect(amzMs).toBeGreaterThanOrEqual(before - 1000);
		expect(amzMs).toBeLessThanOrEqual(after + 1000);
	});
});
