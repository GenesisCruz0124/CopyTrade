import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExchangeClient } from "../../exchange/ExchangeClient.js";
import type { GridConfig, GridLevelState } from "../types.js";
import { computeGridLevels, computeBudgetPerBuyLevel, validateGridRangeAgainstPrice } from "./gridMath.js";
import { validateAndRoundOrder } from "../../mexc/symbolFilters.js";
import type { SafetyRails } from "../../safety/safetyRails.js";
import { logger } from "../../logger.js";

export interface GridStrategyDeps {
  db: Database.Database;
  exchange: ExchangeClient;
  safety: SafetyRails;
}

/**
 * Grid strategy: places buy limits below current price and sell limits above.
 * Sell orders are only ever placed against inventory this bot itself
 * accumulated (tracked per-level), never against pre-existing wallet balance.
 * On a fill, the opposite-side order is placed one grid level away.
 */
export class GridStrategy {
  private levels: GridLevelState[] = [];

  constructor(
    private readonly botId: string,
    private readonly config: GridConfig,
    private readonly deps: GridStrategyDeps
  ) {}

  async start(): Promise<void> {
    const { exchange } = this.deps;
    const ticker = await exchange.getTickerPrice(this.config.symbol);
    validateGridRangeAgainstPrice(this.config, ticker.price);

    const prices = computeGridLevels(this.config);
    const buyLevelCount = prices.filter((p) => p < ticker.price).length;
    const budgetPerLevel = computeBudgetPerBuyLevel(this.config.totalBudgetUsdt, buyLevelCount);

    this.levels = prices.map((price, index) => ({
      level: index,
      price,
      side: price < ticker.price ? "BUY" : "SELL",
      status: "PENDING" as const
    }));

    this.persistState();

    for (const level of this.levels) {
      if (level.side !== "BUY") continue; // sells only ever placed after a buy fills at that level
      const quantity = budgetPerLevel / level.price;
      await this.placeLevelOrder(level, quantity);
    }

    this.emitEvent("grid_started", `Grid started for ${this.config.symbol} with ${prices.length} levels`);
  }

  /** Call when a fill notification arrives for a tracked order (from WS or reconciliation). */
  async onOrderFilled(clientOrderId: string, filledQty: number): Promise<void> {
    const level = this.levels.find((l) => l.clientOrderId === clientOrderId);
    if (!level) return;

    level.status = "FILLED";
    this.persistState();
    this.emitEvent("order_filled", `Level ${level.level} (${level.side}) filled`, { clientOrderId, filledQty });

    const nextLevel =
      level.side === "BUY"
        ? this.levels[level.level + 1] // place a SELL one level above
        : this.levels[level.level - 1]; // place a BUY one level below

    if (!nextLevel) return;

    nextLevel.side = level.side === "BUY" ? "SELL" : "BUY";
    nextLevel.status = "PENDING";
    await this.placeLevelOrder(nextLevel, filledQty);
  }

  private async placeLevelOrder(level: GridLevelState, quantity: number): Promise<void> {
    const { exchange, safety } = this.deps;
    const info = await exchange.getExchangeInfo();
    const filter = info.symbols.find((s) => s.symbol === this.config.symbol);
    if (!filter) throw new Error(`Unknown symbol ${this.config.symbol}`);

    const validated = validateAndRoundOrder(level.price, quantity, filter);
    if (!validated.ok) {
      logger.warn({ level: level.level, reason: validated.reason }, "skipping grid level, invalid order");
      return;
    }

    const check = await safety.checkOrder(this.botId, {
      symbol: this.config.symbol,
      side: level.side,
      price: validated.price,
      quantity: validated.quantity
    });
    if (!check.allowed) {
      this.emitEvent("order_rejected", `Safety rail blocked level ${level.level}: ${check.reason}`);
      return;
    }

    const clientOrderId = `grid-${this.botId}-${level.level}-${randomUUID().slice(0, 8)}`;
    level.clientOrderId = clientOrderId;
    level.status = "OPEN";
    this.persistState();

    const result = await exchange.placeOrder({
      symbol: this.config.symbol,
      side: level.side,
      type: "LIMIT",
      price: validated.price,
      quantity: validated.quantity,
      clientOrderId
    });
    level.orderId = result.orderId;
    this.persistState();
    this.emitEvent("order_placed", `Placed ${level.side} at level ${level.level} @ ${validated.price}`);
  }

  private persistState(): void {
    this.deps.db
      .prepare(`UPDATE bots SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ levels: this.levels }), Date.now(), this.botId);
  }

  private emitEvent(type: string, message: string, data?: unknown): void {
    this.deps.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(this.botId, type, message, data ? JSON.stringify(data) : null, Date.now());
  }

  getLevels(): GridLevelState[] {
    return this.levels;
  }
}
