import { describe, it, expect, vi, afterEach } from "vitest";
import { SlidingWindowRateLimiter } from "../src/api/rateLimiter.js";

describe("SlidingWindowRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxAttempts within the window, then blocks", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    expect(limiter.attempt("1.2.3.4")).toBe(true);
    expect(limiter.attempt("1.2.3.4")).toBe(true);
    expect(limiter.attempt("1.2.3.4")).toBe(true);
    expect(limiter.attempt("1.2.3.4")).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000);
    expect(limiter.attempt("a")).toBe(true);
    expect(limiter.attempt("b")).toBe(true);
    expect(limiter.attempt("a")).toBe(false);
    expect(limiter.attempt("b")).toBe(false);
  });

  it("resets once the window elapses", () => {
    vi.useFakeTimers();
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.attempt("x")).toBe(true);
    expect(limiter.attempt("x")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.attempt("x")).toBe(true);
  });

  it("sweep drops only expired buckets", () => {
    vi.useFakeTimers();
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    limiter.attempt("stale");
    vi.advanceTimersByTime(1001);
    limiter.attempt("fresh");
    limiter.sweep();
    // "stale"'s window has long expired, so a new attempt should be allowed again.
    expect(limiter.attempt("stale")).toBe(true);
    // "fresh" is still within its window and already used its one attempt.
    expect(limiter.attempt("fresh")).toBe(false);
  });
});
