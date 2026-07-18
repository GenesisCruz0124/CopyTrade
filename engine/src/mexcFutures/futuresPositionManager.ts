import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FuturesExchangeClient } from "./futuresExchangeClient.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import { floorToStep } from "../mexc/symbolFilters.js";
import { logger } from "../logger.js";
import { buildFuturesPositionRow } from "./futuresPositionRowFactory.js";

export interface OpenPositionInput {
  symbol: string;
  side: "long" | "short";
  leverage: number;
  openType: "isolated" | "cross";
  sizing: { mode: "usd"; usdAmount: number } | { mode: "percent"; percent: number };
  takeProfitPercent?: number;
  stopLossPercent?: number;
}

export interface FuturesPositionRow {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  open_type: "isolated" | "cross";
  entry_price: number;
  quantity: number;
  contract_size: number;
  margin_usdt: number;
  take_profit_price: number | null;
  stop_loss_price: number | null;
  risk_usdt: number | null;
  taker_fee_rate: number | null;
  open_fee_usdt: number | null;
  close_fee_usdt: number | null;
  status: "open" | "closed";
  close_price: number | null;
  close_reason: string | null;
  realized_pnl_usdt: number | null;
  order_id: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

function totalFee(row: FuturesPositionRow): number | null {
  if (row.open_fee_usdt == null) return null;
  return row.open_fee_usdt + (row.close_fee_usdt ?? 0);
}

export interface FuturesPositionView extends FuturesPositionRow {
  currentPrice: number | null;
  unrealizedPnlUsdt: number | null;
  unrealizedPnlPercent: number | null;
  totalFeeUsdt: number | null;
}

/**
 * Manual (not bot-driven) futures positions opened directly from the app —
 * "open long/short with $X or Y% of balance and a TP/SL". Separate from
 * FuturesTradingService/BotManager, which are strategy-scoped and require a
 * running bot row for SafetyRails.checkOrder. Manual positions have their own
 * lightweight checks (kill switch, leverage bounds) since there's no bot to
 * attach a budget/daily-loss cap to.
 */
export class FuturesPositionManager {
  constructor(
    private readonly db: Database.Database,
    private readonly futuresClient: FuturesExchangeClient,
    private readonly safety: SafetyRails,
    private readonly maxLeverage: number = 20,
    /** null = legacy/unowned rows (single-tenant deployments, or the admin token).
     *  Scopes every query so per-user runtimes sharing the main db in live mode
     *  can never see or touch another user's positions. */
    private readonly userId: string | null = null
  ) {}

  async open(input: OpenPositionInput): Promise<FuturesPositionRow> {
    if (this.safety.isKillSwitchEngaged()) {
      throw new Error("kill switch engaged");
    }
    if (input.leverage < 1 || input.leverage > this.maxLeverage) {
      throw new Error(`leverage ${input.leverage}x outside allowed range 1-${this.maxLeverage}x`);
    }

    const [detail, ticker] = await Promise.all([
      this.futuresClient.contractDetail(input.symbol),
      this.futuresClient.ticker(input.symbol)
    ]);
    if (input.leverage > detail.maxLeverage) {
      throw new Error(`leverage ${input.leverage}x exceeds contract max ${detail.maxLeverage}x`);
    }

    let marginUsdt: number;
    if (input.sizing.mode === "usd") {
      marginUsdt = input.sizing.usdAmount;
    } else {
      const asset = await this.futuresClient.assets("USDT");
      marginUsdt = (input.sizing.percent / 100) * asset.availableBalance;
    }
    if (marginUsdt <= 0) throw new Error("computed margin amount is zero or negative");

    const price = ticker.fairPrice;

    const notional = marginUsdt * input.leverage;
    const rawQty = notional / (price * detail.contractSize);
    const qty = floorToStep(rawQty, detail.volUnit || 1);
    if (qty < detail.minVol) throw new Error(`sized quantity ${qty} below contract minVol ${detail.minVol}`);
    if (qty > detail.maxVol) throw new Error(`sized quantity ${qty} exceeds contract maxVol ${detail.maxVol}`);

    // Validate TP/SL against the current price BEFORE placing anything — a bad
    // percentage (e.g. a stop-loss of 100%+ that implies a negative price) must
    // reject the request outright rather than open a position with no working stop.
    // This dry call's return value is discarded; only its validation (and the
    // computed TP/SL prices, reused below) matter here.
    const id = randomUUID();
    buildFuturesPositionRow({
      id,
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      openType: input.openType,
      entryPrice: price,
      quantity: qty,
      contractSize: detail.contractSize,
      marginUsdt,
      takeProfitPercent: input.takeProfitPercent,
      stopLossPercent: input.stopLossPercent,
      takerFeeRate: detail.takerFeeRate,
      orderId: null,
      now: Date.now()
    });

    const side = input.side === "long" ? 1 : 3; // 1=open long, 3=open short
    const externalOid = `man-${randomUUID().slice(0, 10)}`;
    const result = await this.futuresClient.placeOrder({
      symbol: input.symbol,
      side,
      vol: qty,
      leverage: input.leverage,
      openType: input.openType,
      type: "MARKET",
      externalOid
    });

    // Market orders are always taker fills; capture the rate now so close() can
    // compute its own fee later without another contractDetail round trip.
    const row = buildFuturesPositionRow({
      id,
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      openType: input.openType,
      entryPrice: price,
      quantity: qty,
      contractSize: detail.contractSize,
      marginUsdt,
      takeProfitPercent: input.takeProfitPercent,
      stopLossPercent: input.stopLossPercent,
      takerFeeRate: detail.takerFeeRate,
      orderId: result.orderId,
      now: Date.now()
    });

    this.insertRow(row);
    return row;
  }

  /** Inserts a pre-built futures_positions row. Exposed so FuturesPendingOrderManager
   *  can reuse the same insert path once a detected LIMIT fill produces a row via
   *  buildFuturesPositionRow, instead of duplicating this SQL. */
  insertRow(row: FuturesPositionRow): void {
    this.db
      .prepare(
        `INSERT INTO futures_positions
           (id, symbol, side, leverage, open_type, entry_price, quantity, contract_size, margin_usdt,
            take_profit_price, stop_loss_price, risk_usdt, taker_fee_rate, open_fee_usdt, status, order_id, user_id, created_at, updated_at)
         VALUES (@id, @symbol, @side, @leverage, @open_type, @entry_price, @quantity, @contract_size, @margin_usdt,
                 @take_profit_price, @stop_loss_price, @risk_usdt, @taker_fee_rate, @open_fee_usdt, @status, @order_id, @user_id, @created_at, @updated_at)`
      )
      .run({ ...row, user_id: this.userId });
  }

  async close(positionId: string, reason = "manual"): Promise<FuturesPositionRow> {
    const row = this.db.prepare(`SELECT * FROM futures_positions WHERE id = ? AND user_id IS ?`).get(positionId, this.userId) as
      | FuturesPositionRow
      | undefined;
    if (!row) throw new Error(`position ${positionId} not found`);
    if (row.status === "closed") return row;

    const ticker = await this.futuresClient.ticker(row.symbol);
    const closeSide = row.side === "long" ? 4 : 2; // 4=close long, 2=close short
    await this.futuresClient.placeOrder({
      symbol: row.symbol,
      side: closeSide,
      vol: row.quantity,
      leverage: row.leverage,
      openType: row.open_type,
      type: "MARKET",
      externalOid: `man-close-${randomUUID().slice(0, 10)}`
    });

    const closePrice = ticker.fairPrice;
    const direction = row.side === "long" ? 1 : -1;
    const realizedPnlUsdt = (closePrice - row.entry_price) * row.quantity * row.contract_size * direction;
    const takerFeeRate = row.taker_fee_rate ?? 0.0006;
    const closeFeeUsdt = row.quantity * closePrice * row.contract_size * takerFeeRate;
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE futures_positions
         SET status = 'closed', close_price = ?, close_reason = ?, realized_pnl_usdt = ?, close_fee_usdt = ?, updated_at = ?, closed_at = ?
         WHERE id = ?`
      )
      .run(closePrice, reason, realizedPnlUsdt, closeFeeUsdt, now, now, positionId);

    return {
      ...row,
      status: "closed",
      close_price: closePrice,
      close_reason: reason,
      realized_pnl_usdt: realizedPnlUsdt,
      close_fee_usdt: closeFeeUsdt,
      closed_at: now
    };
  }

  async listOpen(): Promise<FuturesPositionView[]> {
    const rows = this.db
      .prepare(`SELECT * FROM futures_positions WHERE status = 'open' AND user_id IS ? ORDER BY created_at DESC`)
      .all(this.userId) as FuturesPositionRow[];
    return this.attachLivePnl(rows);
  }

  listClosed(limit = 100): FuturesPositionView[] {
    const rows = this.db
      .prepare(`SELECT * FROM futures_positions WHERE status = 'closed' AND user_id IS ? ORDER BY closed_at DESC LIMIT ?`)
      .all(this.userId, limit) as FuturesPositionRow[];
    return rows.map((row) => ({
      ...row,
      currentPrice: null,
      unrealizedPnlUsdt: null,
      unrealizedPnlPercent: null,
      totalFeeUsdt: totalFee(row)
    }));
  }

  private async attachLivePnl(rows: FuturesPositionRow[]): Promise<FuturesPositionView[]> {
    const views: FuturesPositionView[] = [];
    for (const row of rows) {
      try {
        const ticker = await this.futuresClient.ticker(row.symbol);
        const direction = row.side === "long" ? 1 : -1;
        const unrealizedPnlUsdt = (ticker.fairPrice - row.entry_price) * row.quantity * row.contract_size * direction;
        views.push({
          ...row,
          currentPrice: ticker.fairPrice,
          unrealizedPnlUsdt,
          unrealizedPnlPercent: (unrealizedPnlUsdt / row.margin_usdt) * 100,
          totalFeeUsdt: totalFee(row)
        });
      } catch (err) {
        logger.warn({ err, symbol: row.symbol }, "failed to fetch ticker for open position PnL");
        views.push({ ...row, currentPrice: null, unrealizedPnlUsdt: null, unrealizedPnlPercent: null, totalFeeUsdt: totalFee(row) });
      }
    }
    return views;
  }

  /** Realized PnL (USD and %) across positions closed since local midnight today. */
  todaysPnl(): { realizedPnlUsdt: number; realizedPnlPercent: number | null; tradesCount: number } {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(realized_pnl_usdt), 0) as pnl, COALESCE(SUM(margin_usdt), 0) as margin, COUNT(*) as trades
         FROM futures_positions WHERE status = 'closed' AND user_id IS ? AND closed_at >= ?`
      )
      .get(this.userId, startOfDay.getTime()) as { pnl: number; margin: number; trades: number };
    return {
      realizedPnlUsdt: row.pnl,
      realizedPnlPercent: row.margin > 0 ? (row.pnl / row.margin) * 100 : null,
      tradesCount: row.trades
    };
  }

  /** Polls open positions and auto-closes any that crossed their TP/SL price. */
  async monitor(): Promise<void> {
    const rows = this.db
      .prepare(`SELECT * FROM futures_positions WHERE status = 'open' AND user_id IS ?`)
      .all(this.userId) as FuturesPositionRow[];
    for (const row of rows) {
      if (row.take_profit_price == null && row.stop_loss_price == null) continue;
      try {
        const ticker = await this.futuresClient.ticker(row.symbol);
        const price = ticker.fairPrice;
        const hitTp =
          row.take_profit_price != null &&
          (row.side === "long" ? price >= row.take_profit_price : price <= row.take_profit_price);
        const hitSl =
          row.stop_loss_price != null &&
          (row.side === "long" ? price <= row.stop_loss_price : price >= row.stop_loss_price);
        if (hitTp) await this.close(row.id, "take_profit");
        else if (hitSl) await this.close(row.id, "stop_loss");
      } catch (err) {
        logger.error({ err, positionId: row.id }, "futures position TP/SL monitor failed");
      }
    }
  }
}
