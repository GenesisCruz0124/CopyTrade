type QueueItem = {
  run: () => Promise<void>;
};

/**
 * Simple token-bucket-style request queue. MEXC Spot limits: order endpoints
 * 20 req/s, other endpoints 10 req/s. We queue and drain at the configured
 * rate rather than bursting, and retry on 429 with exponential backoff.
 */
export class RateLimitedQueue {
  private queue: QueueItem[] = [];
  private inFlight = 0;
  private readonly maxPerSecond: number;
  private readonly maxConcurrent: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(maxPerSecond: number, maxConcurrent = maxPerSecond) {
    this.maxPerSecond = maxPerSecond;
    this.maxConcurrent = maxConcurrent;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        }
      });
      this.ensureDraining();
    });
  }

  private ensureDraining() {
    if (this.timer) return;
    const intervalMs = Math.ceil(1000 / this.maxPerSecond);
    this.timer = setInterval(() => this.drainTick(), intervalMs);
  }

  private drainTick() {
    while (this.queue.length > 0 && this.inFlight < this.maxConcurrent) {
      const item = this.queue.shift();
      if (!item) break;
      this.inFlight++;
      item.run().finally(() => {
        this.inFlight--;
      });
    }
    if (this.queue.length === 0 && this.inFlight === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export async function withBackoffOn429<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; isRateLimited: (err: unknown) => boolean }
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!opts.isRateLimited(err) || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
