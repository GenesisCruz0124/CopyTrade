import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { FuturesOrderStatusUnknownError } from "./futuresRestClient.js";
import type { FuturesExchangeClient } from "./futuresExchangeClient.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import { floorToStep } from "../mexc/symbolFilters.js";
import { logger } from "../logger.js";
import { buildFuturesPositionRow } from "./futuresPositionRowFactory.js";
import type { FuturesPositionManager } from "./futuresPositionManager.js";
import type { FuturesOrderStatus } from "./types.js";

const UNKNOWN_ORDER_ID_PREFIX = "unknown:";
/** Reject LIMIT prices deviating from the current mark price by more than this — fat-finger protection. */
const MAX_LIMIT_PRICE_DEVIATION_PCT = 50;

export interface OpenLimitOrderInput {
  symbol: string;
  side: "long" | "short";
  leverage: number;
  openType: "isolated" | "cross";
  sizing: { mode: "usd"; usdAmount: number } | { mode: "percent"; percent: number };
  limitPrice: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
}

export type FuturesPendingOrderStatus = "pending" | "partially_filled" | "filled" | "canceled" | "failed";

export interface FuturesPendingOrderRow {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  open_type: "isolated" | "cross";
  limit_price: number;
  quantity: number;
  contract_size: number;
  sizing_mode: "usd" | "percent";
  sizing_usd_amount: number | null;
  sizing_percent: number | null;
  margin_usdt: number;
  take_profit_percent: number | null;
  stop_loss_percent: number | null;
  risk_usdt: number | null;
  taker_fee_rate: number | null;
  order_id: string;
  external_oid: string;
  status: FuturesPendingOrderStatus;
  filled_quantity: number;
  filled_price: number | null;
  filled_at: number | null;
  position_id: string | null;
  cancel_reason: string | null;
  last_checked_at: number | null;
  last_check_error: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Tracks MEXC futures LIMIT orders from submission through fill/cancellation.
 * A sibling to FuturesPositionManager (not an extension of it) — a pending
 * LIMIT order has no real entry price/quantity yet, is cancelable, and can
 * partially fill, which is a fundamentally different lifecycle from an open
 * position. Once a pending order fills, a real futures_positions row is
 * created via the same buildFuturesPositionRow factory FuturesPositionManager
 * uses, and it rejoins existing machinery (monitor(), listOpen(), etc) unmodified.
 */
export class FuturesPendingOrderManager {
  constructor(
    private readonly db: Database.Database,
    private readonly futuresClient: FuturesExchangeClient,
    private readonly safety: SafetyRails,
    private readonly positions: FuturesPositionManager,
    private readonly maxLeverage: number = 20,
    /** See FuturesPositionManager's userId param — same scoping rationale. */
    private readonly userId: string | null = null
  ) {}

  async openLimit(input: OpenLimitOrderInput): Promise<FuturesPendingOrderRow> {
    if (this.safety.isKillSwitchEngaged()) {
      throw new Error("kill switch engaged");
    }
    if (input.leverage < 1 || input.leverage > this.maxLeverage) {
      throw new Error(`leverage ${input.leverage}x outside allowed range 1-${this.maxLeverage}x`);
    }
    if (input.limitPrice <= 0) {
      throw new Error("limit price must be greater than 0");
    }

    const [detail, ticker] = await Promise.all([
      this.futuresClient.contractDetail(input.symbol),
      this.futuresClient.ticker(input.symbol)
    ]);
    if (input.leverage > detail.maxLeverage) {
      throw new Error(`leverage ${input.leverage}x exceeds contract max ${detail.maxLeverage}x`);
    }

    const deviationPct = (Math.abs(input.limitPrice - ticker.fairPrice) / ticker.fairPrice) * 100;
    if (deviationPct > MAX_LIMIT_PRICE_DEVIATION_PCT) {
      throw new Error(
        `limit price ${input.limitPrice} deviates ${deviationPct.toFixed(1)}% from the current price ${ticker.fairPrice} — refusing (max ${MAX_LIMIT_PRICE_DEVIATION_PCT}%)`
      );
    }

    let marginUsdt: number;
    if (input.sizing.mode === "usd") {
      marginUsdt = input.sizing.usdAmount;
    } else {
      const asset = await this.futuresClient.assets("USDT");
      marginUsdt = (input.sizing.percent / 100) * asset.availableBalance;
    }
    if (marginUsdt <= 0) throw new Error("computed margin amount is zero or negative");

    const notional = marginUsdt * input.leverage;
    const rawQty = notional / (input.limitPrice * detail.contractSize);
    const qty = floorToStep(rawQty, detail.volUnit || 1);
    if (qty < detail.minVol) throw new Error(`sized quantity ${qty} below contract minVol ${detail.minVol}`);
    if (qty > detail.maxVol) throw new Error(`sized quantity ${qty} exceeds contract maxVol ${detail.maxVol}`);

    // Dry validation of TP/SL against the requested limit price before submitting
    // anything — same fail-fast intent as FuturesPositionManager.open().
    buildFuturesPositionRow({
      id: randomUUID(),
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      openType: input.openType,
      entryPrice: input.limitPrice,
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
    const externalOid = `man-limit-${randomUUID().slice(0, 10)}`;
    let orderId: string;
    try {
      const result = await this.futuresClient.placeOrder({
        symbol: input.symbol,
        side,
        vol: qty,
        leverage: input.leverage,
        openType: input.openType,
        type: "LIMIT",
        price: input.limitPrice,
        externalOid
      });
      orderId = result.orderId;
    } catch (err) {
      if (!(err instanceof FuturesOrderStatusUnknownError)) throw err;
      // Submission's outcome is genuinely unknown (network/5xx failure after MEXC
      // may have already accepted it) — record a pending row anyway so reconcilePending()
      // can discover the real order via openOrders() matching externalOid.
      logger.warn({ externalOid }, "futures LIMIT order submission status unknown; recording pending row for reconcile");
      orderId = `${UNKNOWN_ORDER_ID_PREFIX}${externalOid}`;
    }

    const id = randomUUID();
    const now = Date.now();
    const row: FuturesPendingOrderRow = {
      id,
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      open_type: input.openType,
      limit_price: input.limitPrice,
      quantity: qty,
      contract_size: detail.contractSize,
      sizing_mode: input.sizing.mode,
      sizing_usd_amount: input.sizing.mode === "usd" ? input.sizing.usdAmount : null,
      sizing_percent: input.sizing.mode === "percent" ? input.sizing.percent : null,
      margin_usdt: marginUsdt,
      take_profit_percent: input.takeProfitPercent ?? null,
      stop_loss_percent: input.stopLossPercent ?? null,
      risk_usdt: input.stopLossPercent != null ? marginUsdt * input.leverage * (input.stopLossPercent / 100) : null,
      taker_fee_rate: detail.takerFeeRate,
      order_id: orderId,
      external_oid: externalOid,
      status: "pending",
      filled_quantity: 0,
      filled_price: null,
      filled_at: null,
      position_id: null,
      cancel_reason: null,
      last_checked_at: null,
      last_check_error: null,
      created_at: now,
      updated_at: now
    };

    this.insertRow(row);
    return row;
  }

  private insertRow(row: FuturesPendingOrderRow): void {
    this.db
      .prepare(
        `INSERT INTO futures_pending_orders
           (id, symbol, side, leverage, open_type, limit_price, quantity, contract_size, sizing_mode,
            sizing_usd_amount, sizing_percent, margin_usdt, take_profit_percent, stop_loss_percent, risk_usdt,
            taker_fee_rate, order_id, external_oid, status, filled_quantity, filled_price, filled_at,
            position_id, cancel_reason, last_checked_at, last_check_error, user_id, created_at, updated_at)
         VALUES (@id, @symbol, @side, @leverage, @open_type, @limit_price, @quantity, @contract_size, @sizing_mode,
                 @sizing_usd_amount, @sizing_percent, @margin_usdt, @take_profit_percent, @stop_loss_percent, @risk_usdt,
                 @taker_fee_rate, @order_id, @external_oid, @status, @filled_quantity, @filled_price, @filled_at,
                 @position_id, @cancel_reason, @last_checked_at, @last_check_error, @user_id, @created_at, @updated_at)`
      )
      .run({ ...row, user_id: this.userId });
  }

  listPending(): FuturesPendingOrderRow[] {
    return this.db
      .prepare(
        `SELECT * FROM futures_pending_orders WHERE status IN ('pending', 'partially_filled') AND user_id IS ? ORDER BY created_at DESC`
      )
      .all(this.userId) as FuturesPendingOrderRow[];
  }

  listHistory(limit = 100): FuturesPendingOrderRow[] {
    return this.db
      .prepare(
        `SELECT * FROM futures_pending_orders WHERE status IN ('filled', 'canceled', 'failed') AND user_id IS ? ORDER BY updated_at DESC LIMIT ?`
      )
      .all(this.userId, limit) as FuturesPendingOrderRow[];
  }

  async cancelPending(id: string): Promise<FuturesPendingOrderRow> {
    const row = this.getRow(id);
    if (!row) throw new Error(`pending order ${id} not found`);
    if (row.status !== "pending" && row.status !== "partially_filled") return row;
    if (row.order_id.startsWith(UNKNOWN_ORDER_ID_PREFIX)) {
      throw new Error("order id not yet resolved for this pending order — wait for the next reconcile tick and retry");
    }

    await this.futuresClient.cancelOrder(row.order_id);
    // Re-query to catch the cancel-vs-fill race: the order may have filled in
    // the moment before the cancel was processed.
    const status = await this.futuresClient.getOrder(row.order_id);
    return this.applyOrderStatus(row, status, "user");
  }

  /** Polls all pending/partially-filled rows for fills/cancellations. One row's
   *  failure never aborts the loop, mirroring FuturesPositionManager.monitor(). */
  async reconcilePending(): Promise<void> {
    const rows = this.listPending();
    for (const row of rows) {
      try {
        if (row.order_id.startsWith(UNKNOWN_ORDER_ID_PREFIX)) {
          await this.resolveUnknownOrderId(row);
          continue;
        }
        const status = await this.futuresClient.getOrder(row.order_id);
        this.applyOrderStatus(row, status, "exchange");
      } catch (err) {
        logger.error({ err, pendingOrderId: row.id }, "futures pending order reconcile failed");
        this.db
          .prepare(`UPDATE futures_pending_orders SET last_checked_at = ?, last_check_error = ? WHERE id = ?`)
          .run(Date.now(), String(err instanceof Error ? err.message : err), row.id);
      }
    }
  }

  private async resolveUnknownOrderId(row: FuturesPendingOrderRow): Promise<void> {
    const open = await this.futuresClient.openOrders(row.symbol);
    const match = open.find((o) => o.externalOid === row.external_oid);
    const now = Date.now();
    if (!match) {
      // Not among currently-open orders — either not yet visible, or it already
      // filled/failed and dropped off the open list. v1 best-effort: keep
      // waiting, surfaced via last_check_error for operator visibility.
      this.db
        .prepare(`UPDATE futures_pending_orders SET last_checked_at = ?, last_check_error = ? WHERE id = ?`)
        .run(now, "order id still unresolved — not found among open orders", row.id);
      return;
    }
    this.db
      .prepare(`UPDATE futures_pending_orders SET order_id = ?, last_checked_at = ?, last_check_error = NULL, updated_at = ? WHERE id = ?`)
      .run(match.orderId, now, now, row.id);
  }

  /** Applies a fetched order status to a pending row: detects fills (full or
   *  partial) and cancellations, creating a real futures_positions row on
   *  first fill. Returns the row's latest state after the update. */
  private applyOrderStatus(row: FuturesPendingOrderRow, status: FuturesOrderStatus, cancelReason: string): FuturesPendingOrderRow {
    const now = Date.now();

    if (status.dealVol > 0 && row.position_id == null) {
      this.handleFill(row, status, now);
      row = this.getRow(row.id)!;
    }

    if (status.state === 4 /* cancelled */ && row.status !== "filled") {
      const finalStatus: FuturesPendingOrderStatus = row.position_id != null ? "partially_filled" : "canceled";
      this.db
        .prepare(`UPDATE futures_pending_orders SET status = ?, cancel_reason = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`)
        .run(finalStatus, cancelReason, now, now, row.id);
      row = this.getRow(row.id)!;
    } else {
      this.db.prepare(`UPDATE futures_pending_orders SET last_checked_at = ? WHERE id = ?`).run(now, row.id);
    }

    return row;
  }

  /** v1 limitation: only the first detected fill increment becomes a position;
   *  subsequent partial-fill top-ups on the same order are not auto-merged. */
  private handleFill(row: FuturesPendingOrderRow, status: FuturesOrderStatus, now: number): void {
    if (this.safety.isKillSwitchEngaged()) {
      logger.warn(
        { pendingOrderId: row.id, symbol: row.symbol },
        "futures LIMIT order filled while kill switch engaged — recording the real fill anyway, cannot un-fill an exchange execution"
      );
    }

    const positionId = randomUUID();
    let positionRow;
    try {
      positionRow = buildFuturesPositionRow({
        id: positionId,
        symbol: row.symbol,
        side: row.side,
        leverage: row.leverage,
        openType: row.open_type,
        entryPrice: status.dealAvgPrice,
        quantity: status.dealVol,
        contractSize: row.contract_size,
        marginUsdt: row.margin_usdt,
        takeProfitPercent: row.take_profit_percent,
        stopLossPercent: row.stop_loss_percent,
        takerFeeRate: status.takerFeeRate || row.taker_fee_rate || 0.0006,
        orderId: row.order_id,
        now
      });
    } catch (err) {
      // The real fill price moved TP/SL onto the wrong side of the requested
      // percent (rare, fast-market edge case) — never let that lose track of a
      // real exchange fill; record the position without TP/SL and log loudly.
      logger.error(
        { err, pendingOrderId: row.id, symbol: row.symbol },
        "TP/SL invalid against real fill price; opening position without TP/SL"
      );
      positionRow = buildFuturesPositionRow({
        id: positionId,
        symbol: row.symbol,
        side: row.side,
        leverage: row.leverage,
        openType: row.open_type,
        entryPrice: status.dealAvgPrice,
        quantity: status.dealVol,
        contractSize: row.contract_size,
        marginUsdt: row.margin_usdt,
        takeProfitPercent: null,
        stopLossPercent: null,
        takerFeeRate: status.takerFeeRate || row.taker_fee_rate || 0.0006,
        orderId: row.order_id,
        now
      });
    }

    this.positions.insertRow(positionRow);

    const filledStatus: FuturesPendingOrderStatus = status.dealVol >= row.quantity ? "filled" : "partially_filled";
    this.db
      .prepare(
        `UPDATE futures_pending_orders
         SET position_id = ?, filled_quantity = ?, filled_price = ?, filled_at = ?, status = ?, last_checked_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(positionId, status.dealVol, status.dealAvgPrice, now, filledStatus, now, now, row.id);
  }

  private getRow(id: string): FuturesPendingOrderRow | undefined {
    return this.db.prepare(`SELECT * FROM futures_pending_orders WHERE id = ? AND user_id IS ?`).get(id, this.userId) as
      | FuturesPendingOrderRow
      | undefined;
  }
}
