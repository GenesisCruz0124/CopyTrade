interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Simple in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (typically the client IP). No new dependency — this only needs to gate a
 * couple of auth routes, not the whole API. Not shared across engine
 * instances; fine for this app's single-process deployment model.
 */
export class SlidingWindowRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  /** Returns true (and counts the attempt) if under the limit, false if rate-limited. */
  attempt(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.maxAttempts) return false;
    bucket.count += 1;
    return true;
  }

  /** Drops expired buckets so long-running processes don't accumulate one
   *  entry per distinct IP ever seen. */
  sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
