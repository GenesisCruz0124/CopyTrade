import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import type Database from "better-sqlite3";
import type { ExchangeClient } from "../../exchange/ExchangeClient.js";
import type { DcaConfig } from "../types.js";
import { validateAndRoundOrder } from "../../mexc/symbolFilters.js";
import type { SafetyRails } from "../../safety/safetyRails.js";
import { logger } from "../../logger.js";

const CRON_PRESETS: Record<Exclude<DcaConfig["interval"], "custom">, string> = {
  hourly: "0 * * * *",
  daily: "0 0 * * *",
  weekly: "0 0 * * 0"
};

export interface DcaStrategyDeps {
  db: Database.Database;
  exchange: ExchangeClient;
  safety: SafetyRails;
}

/**
 * DCA strategy: buys a fixed USDT amount on a schedule, optionally boosted
 * when the 24h change dips past a threshold, and optionally takes profit by
 * selling the full accumulated position once a target gain is reached.
 */
export class DcaStrategy {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly botId: string,
    private readonly config: DcaConfig,
    private readonly deps: DcaStrategyDeps
  ) {}

  start(): void {
    const cronExpr = this.config.interval === "custom" ? this.config.cronExpression : CRON_PRESETS[this.config.interval];
    if (!cronExpr) throw new Error("custom interval requires cronExpression");

    this.task = cron.schedule(cronExpr, () => {
      this.tick().catch((err) => logger.error({ err, botId: this.botId }, "DCA tick failed"));
    });
    this.emitEvent("dca_started", `DCA started for ${this.config.symbol} on schedule "${cronExpr}"`);
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  /** Polls any still-open (limitAtAsk) orders for a fill — market orders fill synchronously and don't need this. */
  async reconcile(): Promise<void> {
    const openOrders = this.deps.db
      .prepare(`SELECT * FROM orders WHERE bot_id = ? AND status = 'NEW'`)
      .all(this.botId) as { client_order_id: string; exchange_order_id: string | null }[];

    for (const order of openOrders) {
      try {
        const result = await this.deps.exchange.queryOrder(this.config.symbol, order.exchange_order_id ?? undefined, order.client_order_id);
        if (result.status === "FILLED") {
          this.persistFill(result.side, result.executedQty, result.price, order.client_order_id);
        }
      } catch (err) {
        logger.warn({ err, clientOrderId: order.client_order_id, botId: this.botId }, "failed to query DCA order during reconcile");
      }
    }
  }

  /** One scheduled cycle: check take-profit first, then execute the (possibly boosted) buy. */
  async tick(): Promise<void> {
    if (this.config.takeProfitPct) {
      const tookProfit = await this.maybeTakeProfit();
      if (tookProfit) return;
    }
    await this.executeBuy();
  }

  private async executeBuy(): Promise<void> {
    const { exchange, safety } = this.deps;
    const info = await exchange.getExchangeInfo();
    const filter = info.symbols.find((s) => s.symbol === this.config.symbol);
    if (!filter) throw new Error(`Unknown symbol ${this.config.symbol}`);

    const ticker = await exchange.getTickerPrice(this.config.symbol);
    let amountUsdt = this.config.amountUsdt;

    if (this.config.dipMultiplier && this.config.dipThresholdPct) {
      const change24hPct = await this.get24hChangePct();
      if (change24hPct !== null && change24hPct < -this.config.dipThresholdPct) {
        amountUsdt *= this.config.dipMultiplier;
        this.emitEvent(
          "dca_dip_boost",
          `24h change ${change24hPct.toFixed(2)}% triggered ${this.config.dipMultiplier}x buy`
        );
      }
    }

    const useMarket = (this.config.orderStyle ?? "market") === "market";
    const orderPrice = useMarket ? ticker.price : ticker.price; // limitAtAsk approximated with current ask/price
    const quantity = amountUsdt / orderPrice;

    const validated = validateAndRoundOrder(orderPrice, quantity, filter);
    if (!validated.ok) {
      this.emitEvent("order_rejected", `DCA buy skipped: ${validated.reason}`);
      return;
    }

    const check = await safety.checkOrder(this.botId, {
      symbol: this.config.symbol,
      side: "BUY",
      price: validated.price,
      quantity: validated.quantity
    });
    if (!check.allowed) {
      this.emitEvent("order_rejected", `Safety rail blocked DCA buy: ${check.reason}`);
      return;
    }

    const clientOrderId = `dca-${this.botId}-${randomUUID().slice(0, 8)}`;
    const result = await exchange.placeOrder({
      symbol: this.config.symbol,
      side: "BUY",
      type: useMarket ? "MARKET" : "LIMIT",
      price: useMarket ? undefined : validated.price,
      quantity: validated.quantity,
      clientOrderId
    });
    this.persistOrder(clientOrderId, result.orderId, "BUY", validated.price, validated.quantity);
    if (result.status === "FILLED") {
      this.persistFill("BUY", result.executedQty, result.price, clientOrderId);
    }
    this.emitEvent("order_placed", `DCA buy placed: ${validated.quantity} ${this.config.symbol} @ ~${validated.price}`);
  }

  /** Sells the full accumulated base-asset position if average-cost gain exceeds takeProfitPct. */
  private async maybeTakeProfit(): Promise<boolean> {
    const { exchange, safety } = this.deps;
    const info = await exchange.getExchangeInfo();
    const filter = info.symbols.find((s) => s.symbol === this.config.symbol);
    if (!filter) return false;

    const position = this.getPosition();
    if (position.quantity <= 0) return false;

    const ticker = await exchange.getTickerPrice(this.config.symbol);
    const avgCost = position.costUsdt / position.quantity;
    const gainPct = ((ticker.price - avgCost) / avgCost) * 100;
    if (gainPct < this.config.takeProfitPct!) return false;

    const validated = validateAndRoundOrder(ticker.price, position.quantity, filter);
    if (!validated.ok) return false;

    const check = await safety.checkOrder(this.botId, {
      symbol: this.config.symbol,
      side: "SELL",
      price: validated.price,
      quantity: validated.quantity
    });
    if (!check.allowed) {
      this.emitEvent("order_rejected", `Safety rail blocked take-profit sell: ${check.reason}`);
      return false;
    }

    const clientOrderId = `dca-tp-${this.botId}-${randomUUID().slice(0, 8)}`;
    const result = await exchange.placeOrder({
      symbol: this.config.symbol,
      side: "SELL",
      type: "MARKET",
      quantity: validated.quantity,
      clientOrderId
    });
    this.persistOrder(clientOrderId, result.orderId, "SELL", validated.price, validated.quantity);
    if (result.status === "FILLED") {
      this.persistFill("SELL", result.executedQty, result.price, clientOrderId);
      this.deps.safety.recordRealizedPnl(this.botId, (result.price - avgCost) * result.executedQty);
    }
    this.emitEvent("take_profit", `Take-profit sell at ${gainPct.toFixed(2)}% gain (target ${this.config.takeProfitPct}%)`);
    return true;
  }

  private getPosition(): { quantity: number; costUsdt: number } {
    const row = this.deps.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN side = 'BUY' THEN quantity ELSE -quantity END), 0) as quantity,
           COALESCE(SUM(CASE WHEN side = 'BUY' THEN quote_qty ELSE -quote_qty END), 0) as costUsdt
         FROM fills WHERE bot_id = ?`
      )
      .get(this.botId) as { quantity: number; costUsdt: number };
    return row;
  }

  private async get24hChangePct(): Promise<number | null> {
    try {
      // 24 hourly candles ~= one day of change.
      const klines = await this.deps.exchange.getKlines(this.config.symbol, "60m", 24);
      if (klines.length === 0) return null;
      const first = klines[0].open;
      const last = klines[klines.length - 1].close;
      if (first <= 0) return null;
      return ((last - first) / first) * 100;
    } catch (err) {
      logger.warn({ err, symbol: this.config.symbol }, "failed to fetch klines for dip check; skipping boost");
      return null;
    }
  }

  private persistOrder(
    clientOrderId: string,
    exchangeOrderId: string,
    side: "BUY" | "SELL",
    price: number,
    quantity: number
  ): void {
    const now = Date.now();
    this.deps.db
      .prepare(
        `INSERT INTO orders (id, bot_id, client_order_id, exchange_order_id, symbol, side, type, price, quantity, status, grid_level, created_at, updated_at)
         VALUES (@id, @bot_id, @client_order_id, @exchange_order_id, @symbol, @side, 'MARKET', @price, @quantity, 'NEW', NULL, @created_at, @updated_at)
         ON CONFLICT(client_order_id) DO NOTHING`
      )
      .run({
        id: randomUUID(),
        bot_id: this.botId,
        client_order_id: clientOrderId,
        exchange_order_id: exchangeOrderId,
        symbol: this.config.symbol,
        side,
        price,
        quantity,
        created_at: now,
        updated_at: now
      });
  }

  private persistFill(side: "BUY" | "SELL", quantity: number, price: number, clientOrderId: string): void {
    const now = Date.now();
    this.deps.db
      .prepare(`UPDATE orders SET status = 'FILLED', updated_at = ? WHERE client_order_id = ?`)
      .run(now, clientOrderId);

    const order = this.deps.db.prepare(`SELECT id FROM orders WHERE client_order_id = ?`).get(clientOrderId) as
      | { id: string }
      | undefined;
    if (!order) return;

    // ON CONFLICT guards against reconcile() and the synchronous fill path both firing for the same order.
    this.deps.db
      .prepare(
        `INSERT INTO fills (id, order_id, bot_id, symbol, side, price, quantity, quote_qty, commission, commission_asset, trade_id, created_at)
         VALUES (@id, @order_id, @bot_id, @symbol, @side, @price, @quantity, @quote_qty, 0, NULL, @trade_id, @created_at)`
      )
      .run({
        id: randomUUID(),
        order_id: order.id,
        bot_id: this.botId,
        symbol: this.config.symbol,
        side,
        price,
        quantity,
        quote_qty: price * quantity,
        trade_id: clientOrderId,
        created_at: now
      });
  }

  private emitEvent(type: string, message: string): void {
    this.deps.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, NULL, ?)`)
      .run(this.botId, type, message, Date.now());
  }
}
