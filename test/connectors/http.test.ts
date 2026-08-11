import { describe, expect, it, vi } from "vitest";
import { HttpError, mapLimit, withRetry } from "../../src/connectors/http.js";

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("withRetry", () => {
  it("returns the parsed result on first success", async () => {
    const fn = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const result = await withRetry(fn, (res) => res.json(), { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));

    const result = await withRetry(fn, (res) => res.json(), { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx up to maxRetries then throws HttpError", async () => {
    const fn = vi.fn().mockResolvedValue(fakeResponse(503, "server exploded"));

    await expect(withRetry(fn, (res) => res.json(), { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(HttpError);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-retryable 4xx", async () => {
    const fn = vi.fn().mockResolvedValue(fakeResponse(404, "not found"));

    await expect(withRetry(fn, (res) => res.json(), { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow(HttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("mapLimit", () => {
  it("preserves order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const result = await mapLimit(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapLimit(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
