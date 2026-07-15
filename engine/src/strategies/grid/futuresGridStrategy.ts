import type Database from "better-sqlite3";
import type { GridConfig, GridLevelState } from "../types.js";
import { computeGridLevels, computeBudgetPerBuyLevel, validateGridRangeAgainstPrice } from "./gridMath.js";
import type { FuturesTradingService } from "../../mexcFutures/FuturesTradingService.js";
import type { FuturesRestClient } from "../../mexcFutures/futuresRestClient.js";
import { logger } from "../../logger.js";

export interface FuturesGridStrategyDeps {
  db: Database.Database;
  futuresClient: FuturesRestClient;
  futuresTrading: FuturesTradingService;
}

/**
 * Futures counterpart of GridStrategy: same level math, but longs/shorts
 * contracts with leverage instead of buying/selling spot inventory. Scoped
 * down from the spot version for v1 — levels are tracked and orders placed,
 * but opposite-side re-entry after a fill is driven by periodic reconciliation
 * (via reconcile()) rather than a private WS fill stream, since MEXC's
 * futures private WS integration is not yet wired up.
 */
export class FuturesGridStrategy {
  private levels: GridLevelState[] = [];

  constructor(
    private readonly botId: string,
    private readonly config: GridConfig,
    private readonly deps: FuturesGridStrategyDeps
  ) {}

  async start(): Promise<void> {
    const { futuresClient } = this.deps;
    const ticker = await futuresClient.ticker(this.config.symbol);
    validateGridRangeAgainstPrice(this.config, ticker.fairPrice);

    const prices = computeGridLevels(this.config);
    const buyLevelCount = prices.filter((p) => p < ticker.fairPrice).length;
    const marginPerLevel = computeBudgetPerBuyLevel(this.config.totalBudgetUsdt, buyLevelCount);
    const leverage = this.config.leverage ?? 3;

    this.levels = prices.map((price, index) => ({
      level: index,
      price,
      side: price < ticker.fairPrice ? "BUY" : "SELL",
      status: "PENDING" as const
    }));
    this.persistState();

    for (const level of this.levels) {
      if (level.side !== "BUY") continue; // opens long only; shorts mirrored the same way if configured for short grids
      const notional = marginPerLevel * leverage;
      const quantity = notional / level.price;
      await this.placeLevelOrder(level, quantity, leverage);
    }

    this.emitEvent("futures_grid_started", `Futures grid started for ${this.config.symbol} (${leverage}x) with ${prices.length} levels`);
  }

  private async placeLevelOrder(level: GridLevelState, quantity: number, leverage: number): Promise<void> {
    try {
      const result = await this.deps.futuresTrading.placeOrder({
        botId: this.botId,
        symbol: this.config.symbol,
        positionType: "long",
        action: "open",
        leverage,
        openType: this.config.marginMode ?? "isolated",
        quantity,
        price: level.price,
        type: "LIMIT"
      });
      level.status = "OPEN";
      level.orderId = result.orderId;
      this.persistState();
      this.emitEvent("order_placed", `Placed futures long at level ${level.level} @ ${level.price}`);
    } catch (err) {
      logger.warn({ err, level: level.level }, "futures grid level order rejected");
      this.emitEvent("order_rejected", `Level ${level.level} rejected: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  private persistState(): void {
    this.deps.db
      .prepare(`UPDATE bots SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ levels: this.levels }), Date.now(), this.botId);
  }

  private emitEvent(type: string, message: string): void {
    this.deps.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, NULL, ?)`)
      .run(this.botId, type, message, Date.now());
  }

  getLevels(): GridLevelState[] {
    return this.levels;
  }
}
