/**
 * AWS SigV4 signing for Cloudflare R2's S3-compatible API.
 *
 * Cloudflare R2 uses the AWS SigV4 signing scheme with region "auto" and
 * service "s3". Credentials are R2 Access Key ID / Secret Access Key pairs
 * generated in the Cloudflare dashboard (not the global CF API token).
 *
 * Endpoint format: https://<accountId>.r2.cloudflarestorage.com/<bucket>/...
 *
 * @module
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Headers returned from signR2Request, ready to be passed to fetch(). */
export interface R2SignedHeaders {
	authorization: string;
	"x-amz-date": string;
	"x-amz-content-sha256": string;
	host: string;
}

/**
 * Compute AWS SigV4 signed headers for a Cloudflare R2 request.
 *
 * @param opts.method - HTTP method (GET, DELETE, etc.)
 * @param opts.url    - Full request URL (including query string)
 * @param opts.accessKeyId - R2 access key ID
 * @param opts.secretAccessKey - R2 secret access key
 * @param opts.body   - Request body bytes (default: empty)
 * @param opts.date   - Request date (default: now; injectable for testing)
 */
export function signR2Request(opts: {
	method: string;
	url: URL;
	accessKeyId: string;
	secretAccessKey: string;
	body?: Uint8Array;
	date?: Date;
}): R2SignedHeaders {
	const { method, url, accessKeyId, secretAccessKey } = opts;
	const region = "auto"; // Cloudflare R2's SigV4 region string
	const service = "s3";

	const date = opts.date ?? new Date();
	const amzDate = formatAmzDate(date);
	const dateStamp = amzDate.slice(0, 8);

	const bodyHash = hexHash(opts.body ?? new Uint8Array(0));

	// Build canonical headers (must be sorted, lowercase names)
	const headersToSign: Record<string, string> = {
		host: url.host,
		"x-amz-content-sha256": bodyHash,
		"x-amz-date": amzDate,
	};

	const sortedNames = Object.keys(headersToSign).sort();
	const canonicalHeaders = sortedNames.map((k) => `${k}:${headersToSign[k]}\n`).join("");
	const signedHeaders = sortedNames.join(";");

	// Canonical query string: sort parameters lexicographically
	const canonicalQueryString = [...url.searchParams.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&");

	const canonicalUri = url.pathname || "/";

	const canonicalRequest = [
		method.toUpperCase(),
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	].join("\n");

	const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		hexHash(te(canonicalRequest)),
	].join("\n");

	const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region, service);
	const signature = hexBytes(hmac(sha256, signingKey, te(stringToSign)));

	const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

	return {
		authorization,
		"x-amz-date": amzDate,
		"x-amz-content-sha256": bodyHash,
		host: url.host,
	};
}

/** Format a Date as the AWS "x-amz-date" timestamp: YYYYMMDDTHHmmssZ */
function formatAmzDate(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

/** Derive the SigV4 signing key via the HMAC key derivation chain. */
function deriveSigningKey(
	secretKey: string,
	dateStamp: string,
	region: string,
	service: string,
): Uint8Array {
	const kDate = hmac(sha256, te(`AWS4${secretKey}`), te(dateStamp));
	const kRegion = hmac(sha256, kDate, te(region));
	const kService = hmac(sha256, kRegion, te(service));
	return hmac(sha256, kService, te("aws4_request"));
}

/** Hex-encode a SHA-256 hash of the given bytes. */
function hexHash(data: Uint8Array): string {
	return hexBytes(sha256(data));
}

/** Hex-encode a byte array. */
function hexBytes(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("hex");
}

/** TextEncoder shorthand. */
function te(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}
