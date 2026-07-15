import { logger } from "../logger.js";

const FX_API_URL = "https://open.er-api.com/v6/latest/USD";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // free tier updates once/day; hourly poll is plenty

/** Caches a USD->PHP conversion rate from a free public FX API, refreshed hourly. */
export class FxRateService {
  private phpRate: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Last known USD->PHP rate, or null if it hasn't been fetched successfully yet. */
  getUsdToPhpRate(): number | null {
    return this.phpRate;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(FX_API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.PHP;
      if (typeof rate === "number" && rate > 0) {
        this.phpRate = rate;
      }
    } catch (err) {
      logger.warn({ err }, "failed to refresh USD/PHP FX rate; keeping last known value");
    }
  }
}
