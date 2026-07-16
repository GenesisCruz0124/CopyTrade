import cron, { type ScheduledTask } from "node-cron";
import type Database from "better-sqlite3";
import type { DcaConfig } from "../types.js";
import type { FuturesTradingService } from "../../mexcFutures/FuturesTradingService.js";
import type { FuturesExchangeClient } from "../../mexcFutures/futuresExchangeClient.js";
import { logger } from "../../logger.js";

const CRON_PRESETS: Record<Exclude<DcaConfig["interval"], "custom">, string> = {
  hourly: "0 * * * *",
  daily: "0 0 * * *",
  weekly: "0 0 * * 0"
};

export interface FuturesDcaStrategyDeps {
  db: Database.Database;
  futuresClient: FuturesExchangeClient;
  futuresTrading: FuturesTradingService;
}

/** Futures counterpart of DcaStrategy: opens a long each cycle instead of buying spot. Dip-multiplier/take-profit are out of scope for this v1 pass. */
export class FuturesDcaStrategy {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly botId: string,
    private readonly config: DcaConfig,
    private readonly deps: FuturesDcaStrategyDeps
  ) {}

  start(): void {
    const cronExpr = this.config.interval === "custom" ? this.config.cronExpression : CRON_PRESETS[this.config.interval];
    if (!cronExpr) throw new Error("custom interval requires cronExpression");

    this.task = cron.schedule(cronExpr, () => {
      this.tick().catch((err) => logger.error({ err, botId: this.botId }, "futures DCA tick failed"));
    });
    this.emitEvent("futures_dca_started", `Futures DCA started for ${this.config.symbol} on schedule "${cronExpr}"`);
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async tick(): Promise<void> {
    const leverage = this.config.leverage ?? 3;
    const ticker = await this.deps.futuresClient.ticker(this.config.symbol);
    const notional = this.config.amountUsdt * leverage;
    const quantity = notional / ticker.fairPrice;

    try {
      await this.deps.futuresTrading.placeOrder({
        botId: this.botId,
        symbol: this.config.symbol,
        positionType: "long",
        action: "open",
        leverage,
        openType: this.config.marginMode ?? "isolated",
        quantity,
        type: "MARKET"
      });
      this.emitEvent("order_placed", `Futures DCA long opened: ~${quantity} contracts on ${this.config.symbol}`);
    } catch (err) {
      this.emitEvent("order_rejected", `Futures DCA buy skipped: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  private emitEvent(type: string, message: string): void {
    this.deps.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, NULL, ?)`)
      .run(this.botId, type, message, Date.now());
  }
}
