import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsync } from "../hooks";

describe("useAsync", () => {
	it("starts with loading=true and data=null", () => {
		const fn = vi.fn(() => new Promise<string>(() => {})); // never resolves
		const { result } = renderHook(() => useAsync(fn));

		expect(result.current.loading).toBe(true);
		expect(result.current.data).toBe(null);
		expect(result.current.error).toBe(null);
	});

	it("resolves data and sets loading=false", async () => {
		const fn = vi.fn(() => Promise.resolve("hello"));
		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		expect(result.current.data).toBe("hello");
		expect(result.current.error).toBe(null);
	});

	it("captures error message on rejection", async () => {
		const fn = vi.fn(() => Promise.reject(new Error("fail")));
		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		expect(result.current.data).toBe(null);
		expect(result.current.error).toBe("fail");
	});

	it("refetch re-invokes the function", async () => {
		let counter = 0;
		const fn = vi.fn(() => Promise.resolve(++counter));
		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.data).toBe(1);
		});

		await act(async () => {
			result.current.refetch();
		});

		await waitFor(() => {
			expect(result.current.data).toBe(2);
		});

		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("re-fetches when deps change", async () => {
		const fn1 = vi.fn(() => Promise.resolve("a"));
		const fn2 = vi.fn(() => Promise.resolve("b"));

		let dep = 1;
		const { result, rerender } = renderHook(() => useAsync(dep === 1 ? fn1 : fn2, [dep]));

		await waitFor(() => {
			expect(result.current.data).toBe("a");
		});

		dep = 2;
		rerender();

		await waitFor(() => {
			expect(result.current.data).toBe("b");
		});
	});

	it("clears previous error on successful refetch", async () => {
		let shouldFail = true;
		const fn = vi.fn(() =>
			shouldFail ? Promise.reject(new Error("oops")) : Promise.resolve("ok"),
		);

		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.error).toBe("oops");
		});

		shouldFail = false;

		await act(async () => {
			result.current.refetch();
		});

		await waitFor(() => {
			expect(result.current.error).toBe(null);
			expect(result.current.data).toBe("ok");
		});
	});

	it("returns array data correctly", async () => {
		const fn = vi.fn(() => Promise.resolve([1, 2, 3]));
		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.data).toEqual([1, 2, 3]);
		});
	});

	it("handles null resolution", async () => {
		const fn = vi.fn(() => Promise.resolve(null));
		const { result } = renderHook(() => useAsync(fn));

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});
		// data is set to null from resolution, same as initial
		expect(result.current.data).toBe(null);
		expect(result.current.error).toBe(null);
	});

	it("ignores stale response when dep changes before slow request resolves", async () => {
		// Simulate a slow first request and a fast second request.
		// The second request should win regardless of resolution order.
		let resolveFirst!: (value: string) => void;
		const firstReq = new Promise<string>((res) => {
			resolveFirst = res;
		});

		let dep = 1;
		const fn = vi.fn(() => (dep === 1 ? firstReq : Promise.resolve("second")));

		const { result, rerender } = renderHook(() => useAsync(fn, [dep]));

		// Switch dep before first request resolves
		dep = 2;
		rerender();

		// Second request resolves immediately
		await waitFor(() => {
			expect(result.current.data).toBe("second");
		});

		// Now the stale first request resolves — should be ignored
		act(() => {
			resolveFirst("stale");
		});

		// Data must still be "second", not "stale"
		expect(result.current.data).toBe("second");
	});
});
