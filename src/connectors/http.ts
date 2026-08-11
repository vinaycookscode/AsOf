export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a fetch-returning function with retry/backoff for 429 and 5xx.
 * Honours Retry-After when present; otherwise exponential backoff with jitter.
 */
export async function withRetry<T>(fn: () => Promise<Response>, parse: (res: Response) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;

  let attempt = 0;
  for (;;) {
    const res = await fn();

    if (res.ok) {
      return parse(res);
    }

    if (!isRetryable(res.status) || attempt >= maxRetries) {
      const body = await res.text().catch(() => "");
      throw new HttpError(res.status, res.url, body);
    }

    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
    const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jitterMs = Math.random() * backoffMs * 0.25;
    await sleep(retryAfterMs ?? backoffMs + jitterMs);

    attempt += 1;
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight concurrently.
 * Preserves input order in the returned array.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
