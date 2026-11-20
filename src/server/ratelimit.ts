/**
 * In-memory token-bucket rate limiter (#110, NFR-05). Single-process app (N1), so a Map is enough;
 * limits are documented in ADR-0016. Buckets refill continuously and are pruned when idle.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

export function takeToken(key: string, capacity: number, refillPerMinute: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.updated > 3_600_000) buckets.delete(k);
  }
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 60_000) * refillPerMinute);
  b.updated = now;
  buckets.set(key, b);
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, retryAfterSec: 0 };
  }
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - b.tokens) / refillPerMinute) * 60)) };
}

/** Test hook: clears all buckets. */
export function resetRateLimits() {
  buckets.clear();
}