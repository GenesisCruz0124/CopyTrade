import type Database from "better-sqlite3";
import type { ExchangeClient } from "../exchange/ExchangeClient.js";
import { logger } from "../logger.js";
import { liquidationDistancePct } from "../mexcFutures/liquidation.js";

export interface OrderCheckInput {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  /** Present only for futures orders; triggers leverage/liquidation checks. */
  futures?: {
    leverage: number;
    positionType: "long" | "short";
    maintenanceMarginRate: number;
    /** Futures symbols (e.g. BTC_USDT) aren't known to the spot exchange client, so the
     *  caller supplies the current mark/last price for the deviation check instead. */
    marketPrice: number;
  };
}

export interface OrderCheckResult {
  allowed: boolean;
  reason?: string;
}

interface BotRow {
  id: string;
  status: string;
  allocated_usdt: number;
  daily_loss_limit_usdt: number | null;
  realized_pnl_usdt: number;
}

export interface SafetyRailsOptions {
  db: Database.Database;
  exchange: ExchangeClient;
  maxPriceDeviationPct: number;
  defaultDailyLossLimitUsdt: number;
  maxFuturesLeverage?: number;
  minLiquidationDistancePct?: number;
}

/**
 * Central safety gate. Every order must pass through checkOrder() before
 * submission. All rails live here so no strategy code can bypass them.
 */
export class SafetyRails {
  private killSwitchEngaged = false;

  constructor(private readonly opts: SafetyRailsOptions) {}

  isKillSwitchEngaged(): boolean {
    return this.killSwitchEngaged;
  }

  async checkOrder(botId: string, order: OrderCheckInput): Promise<OrderCheckResult> {
    if (this.killSwitchEngaged) {
      return { allowed: false, reason: "kill switch engaged" };
    }

    const bot = this.opts.db.prepare(`SELECT * FROM bots WHERE id = ?`).get(botId) as BotRow | undefined;
    if (!bot) return { allowed: false, reason: "bot not found" };
    if (bot.status !== "running") return { allowed: false, reason: `bot is ${bot.status}` };

    const dailyLossLimit = bot.daily_loss_limit_usdt ?? this.opts.defaultDailyLossLimitUsdt;
    const dailyLoss = this.getRealizedLossToday(botId);
    if (dailyLoss >= dailyLossLimit) {
      this.pauseBot(botId, "daily_loss_limit_hit", `Daily realized loss ${dailyLoss} USDT reached limit ${dailyLossLimit}`);
      return { allowed: false, reason: "daily loss limit reached; bot paused" };
    }

    const notional = order.price * order.quantity;
    if (order.side === "BUY") {
      const spent = this.getSpentUsdt(botId);
      if (spent + notional > bot.allocated_usdt) {
        return { allowed: false, reason: "order would exceed bot budget cap" };
      }
    }

    let marketPrice: number;
    if (order.futures) {
      marketPrice = order.futures.marketPrice;
    } else {
      try {
        marketPrice = (await this.opts.exchange.getTickerPrice(order.symbol)).price;
      } catch (err) {
        logger.warn({ err, symbol: order.symbol }, "safety check: could not fetch ticker; rejecting order");
        return { allowed: false, reason: "could not verify market price" };
      }
    }
    const deviationPct = Math.abs((order.price - marketPrice) / marketPrice) * 100;
    if (deviationPct > this.opts.maxPriceDeviationPct) {
      return {
        allowed: false,
        reason: `order price deviates ${deviationPct.toFixed(2)}% from market, exceeds ${this.opts.maxPriceDeviationPct}% limit`
      };
    }

    if (order.futures) {
      const maxLeverage = this.opts.maxFuturesLeverage ?? 20;
      if (order.futures.leverage > maxLeverage) {
        return { allowed: false, reason: `leverage ${order.futures.leverage}x exceeds max allowed ${maxLeverage}x` };
      }
      const minDistancePct = this.opts.minLiquidationDistancePct ?? 15;
      const distancePct = liquidationDistancePct(
        order.price,
        order.futures.leverage,
        order.futures.maintenanceMarginRate,
        order.futures.positionType
      );
      if (distancePct < minDistancePct) {
        return {
          allowed: false,
          reason: `estimated liquidation is only ${distancePct.toFixed(2)}% from entry, below the required ${minDistancePct}% buffer`
        };
      }
    }

    if (!order.futures) {
      // Futures margin balance is checked by the futures order-placement path itself
      // (spot exchangeInfo/account lookups below don't apply to contract symbols).
      const balanceOk = await this.hasSufficientBalance(order);
      if (!balanceOk) {
        return { allowed: false, reason: "insufficient balance" };
      }
    }

    return { allowed: true };
  }

  recordRealizedPnl(botId: string, pnlUsdt: number): void {
    this.opts.db
      .prepare(`UPDATE bots SET realized_pnl_usdt = realized_pnl_usdt + ?, updated_at = ? WHERE id = ?`)
      .run(pnlUsdt, Date.now(), botId);
  }

  pauseBot(botId: string, eventType: string, message: string): void {
    this.opts.db.prepare(`UPDATE bots SET status = 'paused', updated_at = ? WHERE id = ?`).run(Date.now(), botId);
    this.opts.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, NULL, ?)`)
      .run(botId, eventType, message, Date.now());
    logger.warn({ botId, eventType }, message);
  }

  /** Cancels all open orders across all bots and pauses everything. */
  async engageKillSwitch(): Promise<void> {
    this.killSwitchEngaged = true;
    const bots = this.opts.db.prepare(`SELECT id FROM bots WHERE status = 'running'`).all() as { id: string }[];

    for (const { id } of bots) {
      const openOrders = await this.opts.exchange.openOrders();
      for (const order of openOrders) {
        try {
          await this.opts.exchange.cancelOrder(order.symbol, order.orderId, order.clientOrderId);
        } catch (err) {
          logger.error({ err, orderId: order.orderId }, "failed to cancel order during kill switch");
        }
      }
      this.opts.db.prepare(`UPDATE bots SET status = 'paused', updated_at = ? WHERE id = ?`).run(Date.now(), id);
    }

    this.opts.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (NULL, 'kill_switch', 'Kill switch engaged: all bots paused, all open orders cancelled', NULL, ?)`)
      .run(Date.now());
    logger.warn("kill switch engaged");
  }

  disengageKillSwitch(): void {
    this.killSwitchEngaged = false;
  }

  private getRealizedLossToday(botId: string): number {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = this.opts.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN realized_pnl_usdt < 0 THEN -realized_pnl_usdt ELSE 0 END), 0) as loss
         FROM pnl_snapshots WHERE bot_id = ? AND created_at >= ?`
      )
      .get(botId, startOfDay.getTime()) as { loss: number };
    return row.loss;
  }

  private getSpentUsdt(botId: string): number {
    const row = this.opts.db
      .prepare(
        `SELECT COALESCE(SUM(price * quantity), 0) as spent FROM orders
         WHERE bot_id = ? AND side = 'BUY' AND status IN ('NEW', 'PARTIALLY_FILLED', 'FILLED')`
      )
      .get(botId) as { spent: number };
    return row.spent;
  }

  private async hasSufficientBalance(order: OrderCheckInput): Promise<boolean> {
    const info = await this.opts.exchange.getExchangeInfo();
    const filter = info.symbols.find((s) => s.symbol === order.symbol);
    if (!filter) return false;

    const account = await this.opts.exchange.getAccountInfo();
    const notional = order.price * order.quantity;

    if (order.side === "BUY") {
      const quote = account.balances.find((b) => b.asset === filter.quoteAsset);
      return (quote?.free ?? 0) >= notional;
    }
    const base = account.balances.find((b) => b.asset === filter.baseAsset);
    return (base?.free ?? 0) >= order.quantity;
  }
}
