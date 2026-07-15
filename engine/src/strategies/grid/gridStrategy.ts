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

  /**
   * Polls every open level's order for a fill. There is no push-based fill
   * notification wired up for either paper or live orders yet, so this must
   * be called periodically (see index.ts) for the grid to ever progress past
   * its initial orders.
   */
  async reconcile(): Promise<void> {
    const { exchange } = this.deps;
    for (const level of this.levels) {
      if (level.status !== "OPEN" || !level.orderId) continue;
      let result;
      try {
        result = await exchange.queryOrder(this.config.symbol, level.orderId, level.clientOrderId);
      } catch (err) {
        logger.warn({ err, level: level.level, botId: this.botId }, "failed to query grid order during reconcile");
        continue;
      }
      if (result.status === "FILLED") {
        await this.onOrderFilled(level.clientOrderId!, result.executedQty, result.price);
      }
    }
  }

  /** Handles a fill: persists it, updates the level, and places the opposite-side order one level away. */
  private async onOrderFilled(clientOrderId: string, filledQty: number, fillPrice: number): Promise<void> {
    const level = this.levels.find((l) => l.clientOrderId === clientOrderId);
    if (!level || level.status === "FILLED") return;

    level.status = "FILLED";
    this.persistState();
    this.persistFill(level, filledQty, fillPrice);
    this.emitEvent("order_filled", `Level ${level.level} (${level.side}) filled`, { clientOrderId, filledQty });

    if (level.side === "SELL") {
      const costBasis = this.estimateMatchedBuyPrice(level);
      if (costBasis !== null) {
        const pnl = (fillPrice - costBasis) * filledQty;
        this.deps.safety.recordRealizedPnl(this.botId, pnl);
      }
    }

    const nextLevel =
      level.side === "BUY"
        ? this.levels[level.level + 1] // place a SELL one level above
        : this.levels[level.level - 1]; // place a BUY one level below

    if (!nextLevel) return;

    nextLevel.side = level.side === "BUY" ? "SELL" : "BUY";
    nextLevel.status = "PENDING";
    await this.placeLevelOrder(nextLevel, filledQty);
  }

  /** Best-effort cost basis for a sell fill: the price of the level directly below it, which is what would have been bought to stock this level. */
  private estimateMatchedBuyPrice(sellLevel: GridLevelState): number | null {
    const buyLevel = this.levels[sellLevel.level - 1];
    return buyLevel ? buyLevel.price : null;
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
    this.persistOrder(level, validated.price, validated.quantity);
    this.emitEvent("order_placed", `Placed ${level.side} at level ${level.level} @ ${validated.price}`);
  }

  private persistOrder(level: GridLevelState, price: number, quantity: number): void {
    const now = Date.now();
    this.deps.db
      .prepare(
        `INSERT INTO orders (id, bot_id, client_order_id, exchange_order_id, symbol, side, type, price, quantity, status, grid_level, created_at, updated_at)
         VALUES (@id, @bot_id, @client_order_id, @exchange_order_id, @symbol, @side, 'LIMIT', @price, @quantity, 'NEW', @grid_level, @created_at, @updated_at)
         ON CONFLICT(client_order_id) DO UPDATE SET status = 'NEW', updated_at = @updated_at`
      )
      .run({
        id: randomUUID(),
        bot_id: this.botId,
        client_order_id: level.clientOrderId,
        exchange_order_id: level.orderId ?? null,
        symbol: this.config.symbol,
        side: level.side,
        price,
        quantity,
        grid_level: level.level,
        created_at: now,
        updated_at: now
      });
  }

  private persistFill(level: GridLevelState, quantity: number, price: number): void {
    const now = Date.now();
    this.deps.db
      .prepare(`UPDATE orders SET status = 'FILLED', updated_at = ? WHERE client_order_id = ?`)
      .run(now, level.clientOrderId);

    const order = this.deps.db
      .prepare(`SELECT id FROM orders WHERE client_order_id = ?`)
      .get(level.clientOrderId) as { id: string } | undefined;
    if (!order) return;

    this.deps.db
      .prepare(
        `INSERT INTO fills (id, order_id, bot_id, symbol, side, price, quantity, quote_qty, commission, commission_asset, trade_id, created_at)
         VALUES (@id, @order_id, @bot_id, @symbol, @side, @price, @quantity, @quote_qty, 0, NULL, NULL, @created_at)`
      )
      .run({
        id: randomUUID(),
        order_id: order.id,
        bot_id: this.botId,
        symbol: this.config.symbol,
        side: level.side,
        price,
        quantity,
        quote_qty: price * quantity,
        created_at: now
      });
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
