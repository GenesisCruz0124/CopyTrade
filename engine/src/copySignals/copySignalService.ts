import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import type { ExtractedSignal } from "../vision/signalExtractor.js";
import type { FuturesTradingService } from "../mexcFutures/FuturesTradingService.js";
import type { FuturesExchangeClient } from "../mexcFutures/futuresExchangeClient.js";
import { normalizeFuturesSymbol } from "../mexcFutures/futuresSymbol.js";

export interface CopySignalRow {
  id: string;
  source: string;
  channel_message_id: string | null;
  image_path: string | null;
  symbol: string | null;
  side: "long" | "short" | null;
  leverage: number | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number | null;
  raw_extraction: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";
  order_id: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface CopyTradingConfig {
  botId: string; // the dedicated pseudo-bot id copy trades are attributed to
  budgetUsdt: number;
  riskPctPerTrade: number; // e.g. 2 = 2% of budgetUsdt margin per trade
  defaultLeverage: number;
  marginMode: "isolated" | "cross";
}

export type PriceCheck = "valid" | "tp_hit" | "sl_hit" | "unknown";

export interface CopySignalWithPriceCheck extends CopySignalRow {
  current_price: number | null;
  price_check: PriceCheck;
  price_note: string | null;
}

/**
 * Turns a vision-extracted Discord signal into a PENDING row for the
 * Android app to review, then — once a human approves it — sizes and
 * places the futures order. Nothing is ever auto-executed.
 */
export class CopySignalService {
  constructor(
    private readonly db: Database.Database,
    private readonly futuresClient: FuturesExchangeClient,
    private readonly futuresTrading: FuturesTradingService,
    private readonly config: CopyTradingConfig
  ) {
    this.ensurePseudoBot();
  }

  private ensurePseudoBot(): void {
    const existing = this.db.prepare(`SELECT id FROM bots WHERE id = ?`).get(this.config.botId);
    if (existing) return;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, market, leverage, margin_mode, created_at, updated_at)
         VALUES (@id, 'futures_dca', 'COPY_TRADING', 'running', '{}', '{}', 1, @allocated_usdt, NULL, 0, 'futures', @leverage, @margin_mode, @created_at, @updated_at)`
      )
      .run({
        id: this.config.botId,
        allocated_usdt: this.config.budgetUsdt,
        leverage: this.config.defaultLeverage,
        margin_mode: this.config.marginMode,
        created_at: now,
        updated_at: now
      });
  }

  createFromExtraction(params: {
    channelMessageId: string;
    imagePath: string | null;
    extraction: ExtractedSignal;
  }): CopySignalRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO copy_signals (id, source, channel_message_id, image_path, symbol, side, leverage, entry_price, stop_loss, take_profit, confidence, raw_extraction, status, created_at, updated_at)
         VALUES (@id, 'discord', @channel_message_id, @image_path, @symbol, @side, @leverage, @entry_price, @stop_loss, @take_profit, @confidence, @raw_extraction, 'PENDING', @created_at, @updated_at)`
      )
      .run({
        id,
        channel_message_id: params.channelMessageId,
        image_path: params.imagePath,
        symbol: params.extraction.symbol ? normalizeFuturesSymbol(params.extraction.symbol) : null,
        side: params.extraction.side,
        leverage: params.extraction.leverage,
        entry_price: params.extraction.entryPrice,
        stop_loss: params.extraction.stopLoss,
        take_profit: params.extraction.takeProfit,
        confidence: params.extraction.confidence,
        raw_extraction: JSON.stringify(params.extraction),
        created_at: now,
        updated_at: now
      });
    logger.info({ id, symbol: params.extraction.symbol, confidence: params.extraction.confidence }, "copy signal created, pending review");
    return this.get(id)!;
  }

  list(status?: CopySignalRow["status"]): CopySignalRow[] {
    if (status) {
      return this.db.prepare(`SELECT * FROM copy_signals WHERE status = ? ORDER BY created_at DESC`).all(status) as CopySignalRow[];
    }
    return this.db.prepare(`SELECT * FROM copy_signals ORDER BY created_at DESC LIMIT 200`).all() as CopySignalRow[];
  }

  get(id: string): CopySignalRow | undefined {
    return this.db.prepare(`SELECT * FROM copy_signals WHERE id = ?`).get(id) as CopySignalRow | undefined;
  }

  /**
   * Same as list(), plus a live-price sanity check for each PENDING signal so the
   * reviewer can see whether the call has already played out (hit TP) or already
   * been invalidated (blown through SL) before they approve/reject it.
   */
  async listWithPriceCheck(status?: CopySignalRow["status"]): Promise<CopySignalWithPriceCheck[]> {
    const rows = this.list(status);
    const results: CopySignalWithPriceCheck[] = [];
    for (const row of rows) {
      if (row.status !== "PENDING" || !row.symbol || !row.side) {
        results.push({ ...row, current_price: null, price_check: "unknown", price_note: null });
        continue;
      }
      // Defensive normalize so signals stored before symbol normalization
      // (or from other sources) resolve to a valid MEXC contract, and so the app
      // shows/copies the canonical BASE_USDT symbol.
      const contractSymbol = normalizeFuturesSymbol(row.symbol);
      try {
        const ticker = await this.futuresClient.ticker(contractSymbol);
        results.push({
          ...row,
          symbol: contractSymbol,
          current_price: ticker.fairPrice,
          ...this.evaluatePriceCheck(row, ticker.fairPrice)
        });
      } catch (err) {
        results.push({
          ...row,
          symbol: contractSymbol,
          current_price: null,
          price_check: "unknown",
          price_note: `failed to fetch live price: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }
    return results;
  }

  private evaluatePriceCheck(row: CopySignalRow, price: number): { price_check: PriceCheck; price_note: string | null } {
    const sl = row.stop_loss;
    const tp = row.take_profit;
    const slHit = row.side === "long" ? sl != null && price <= sl : sl != null && price >= sl;
    const tpHit = row.side === "long" ? tp != null && price >= tp : tp != null && price <= tp;

    if (slHit) {
      return {
        price_check: "sl_hit",
        price_note: `price (${price}) has already reached the stop-loss/invalidation level (${sl}) — the signal may no longer be valid`
      };
    }
    if (tpHit) {
      return {
        price_check: "tp_hit",
        price_note: `price (${price}) has already reached the take-profit level (${tp}) — the move may already be played out`
      };
    }
    return { price_check: "valid", price_note: null };
  }

  reject(id: string): CopySignalRow {
    const row = this.requireRow(id);
    this.updateStatus(id, "REJECTED");
    return { ...row, status: "REJECTED" };
  }

  /** Sizes the position as a fixed % of the dedicated copy-trading budget and places the order. */
  async approve(id: string): Promise<CopySignalRow> {
    const row = this.requireRow(id);
    if (row.status !== "PENDING") throw new Error(`copy signal ${id} is not pending (status=${row.status})`);
    if (!row.symbol || !row.side) {
      this.updateStatus(id, "FAILED", "missing required fields (symbol/side) after extraction");
      throw new Error("cannot approve a signal missing symbol or side");
    }

    this.updateStatus(id, "APPROVED");

    const leverage = row.leverage ?? this.config.defaultLeverage;
    const marginUsdt = this.config.budgetUsdt * (this.config.riskPctPerTrade / 100);
    const notional = marginUsdt * leverage;

    try {
      // A signal with no explicit entry price (e.g. "MARKET LONG $JTO" — a market
      // call, not a level to wait for) can't size against a null price or freeze a
      // stale one into a LIMIT order — size against the current live price instead
      // and place a market order, matching what the signal actually called for.
      const orderType: "LIMIT" | "MARKET" = row.entry_price != null ? "LIMIT" : "MARKET";
      const contractSymbol = normalizeFuturesSymbol(row.symbol);
      const entryPrice = row.entry_price ?? (await this.futuresClient.ticker(contractSymbol)).fairPrice;
      const quantity = notional / entryPrice;

      const result = await this.futuresTrading.placeOrder({
        botId: this.config.botId,
        symbol: contractSymbol,
        positionType: row.side,
        action: "open",
        leverage,
        openType: this.config.marginMode,
        quantity,
        price: orderType === "LIMIT" ? entryPrice : undefined,
        type: orderType
      });
      this.db
        .prepare(`UPDATE copy_signals SET status = 'EXECUTED', order_id = ?, updated_at = ? WHERE id = ?`)
        .run(result.orderId, Date.now(), id);
      logger.info({ id, orderId: result.orderId, quantity, leverage }, "copy signal executed");
    } catch (err) {
      const reason = String(err instanceof Error ? err.message : err);
      this.updateStatus(id, "FAILED", reason);
      logger.error({ id, err }, "copy signal execution failed");
      throw err;
    }

    return this.get(id)!;
  }

  private updateStatus(id: string, status: CopySignalRow["status"], failureReason?: string): void {
    this.db
      .prepare(`UPDATE copy_signals SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?`)
      .run(status, failureReason ?? null, Date.now(), id);
  }

  private requireRow(id: string): CopySignalRow {
    const row = this.get(id);
    if (!row) throw new Error(`copy signal ${id} not found`);
    return row;
  }
}
