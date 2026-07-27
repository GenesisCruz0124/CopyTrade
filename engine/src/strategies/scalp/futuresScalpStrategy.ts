import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ScalpConfig, ScalpPositionState } from "../types.js";
import type { FuturesExchangeClient } from "../../mexcFutures/futuresExchangeClient.js";
import type { FuturesTradingService } from "../../mexcFutures/FuturesTradingService.js";
import type { SafetyRails } from "../../safety/safetyRails.js";
import { analyzeSignal, InsufficientCandlesError } from "../../analysis/signalEngine.js";
import type { Kline } from "../../mexc/types.js";
import { logger } from "../../logger.js";

const TICK_INTERVAL_MS = 15_000;
const DEFAULT_ATR_STOP_MULTIPLIER = 1.0;
const DEFAULT_ATR_TAKE_PROFIT_MULTIPLIER = 1.5;
const DEFAULT_CONFIDENCE_THRESHOLD = 35;

export interface FuturesScalpStrategyDeps {
  db: Database.Database;
  futuresClient: FuturesExchangeClient;
  futuresTrading: FuturesTradingService;
  safety: SafetyRails;
}

/**
 * Fast in-and-out futures strategy: on a 15s self-timer (independent of the
 * shared 5s reconcileAll fill-detection cadence — both entry and exit orders
 * are MARKET, so they fill synchronously and never need reconciliation), it
 * either looks for a directional entry signal while flat, or watches an open
 * position's stop-loss/take-profit (and optionally a signal reversal) while
 * in one. Unlike FuturesGridStrategy/FuturesDcaStrategy, which only ever
 * open, this is the first strategy that closes its own positions.
 */
export class FuturesScalpStrategy {
  private position: ScalpPositionState | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly botId: string,
    private readonly config: ScalpConfig,
    private readonly deps: FuturesScalpStrategyDeps
  ) {}

  start(): void {
    this.position = this.loadPersistedPosition();
    this.runTick();
    this.timer = setInterval(() => this.runTick(), TICK_INTERVAL_MS);
    this.emitEvent("scalp_started", `Scalping started for ${this.config.symbol} on ${this.config.interval}`);
  }

  private runTick(): void {
    void this.tick().catch((err) => {
      logger.error({ err, botId: this.botId }, "futures scalp tick failed");
      this.emitEvent("scalp_error", String(err instanceof Error ? err.message : err));
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.position) {
      await this.checkExit();
    } else {
      await this.tryEnter();
    }
  }

  private async tryEnter(): Promise<void> {
    const { futuresClient, futuresTrading } = this.deps;

    let signal;
    try {
      const rawCandles = await futuresClient.klines(this.config.symbol, this.config.interval, 200);
      // analyzeSignal wants mexc/types.js's Kline (spot shape, which carries an
      // unused closeTime field futures klines don't have) — closeTime is never
      // read anywhere in analysis/, so backfilling it from openTime is safe.
      const candles: Kline[] = rawCandles.map((k) => ({ ...k, closeTime: k.openTime }));
      signal = analyzeSignal(this.config.symbol, this.config.interval, candles, {
        atrStopMultiplier: this.config.atrStopMultiplier ?? DEFAULT_ATR_STOP_MULTIPLIER,
        atrTakeProfitMultiplier: this.config.atrTakeProfitMultiplier ?? DEFAULT_ATR_TAKE_PROFIT_MULTIPLIER,
        signalThreshold: (this.config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD) / 100
      });
    } catch (err) {
      if (err instanceof InsufficientCandlesError) return; // not enough history yet, quietly wait
      throw err;
    }

    if (signal.signal === "NEUTRAL") return;

    const positionType = signal.signal === "LONG" ? "long" : "short";
    const [ticker, detail] = await Promise.all([
      futuresClient.ticker(this.config.symbol),
      futuresClient.contractDetail(this.config.symbol)
    ]);

    const stopDist = Math.abs(signal.suggestedEntry - signal.stopLoss);
    const tpDist = Math.abs(signal.takeProfit - signal.suggestedEntry);
    if (stopDist <= 0) return; // degenerate ATR bracket, nothing sane to size against

    const quantity = this.config.riskUsdAmount / (stopDist * detail.contractSize);
    // Re-center the bracket on the live price, not the (slightly stale) candle
    // close analyzeSignal used — the entry is a MARKET order filling near the
    // live price, same convention FuturesPositionManager.open() already uses.
    const entryPrice = ticker.fairPrice;
    const stopLossPrice = positionType === "long" ? entryPrice - stopDist : entryPrice + stopDist;
    const takeProfitPrice = positionType === "long" ? entryPrice + tpDist : entryPrice - tpDist;

    try {
      const result = await futuresTrading.placeOrder({
        botId: this.botId,
        symbol: this.config.symbol,
        positionType,
        action: "open",
        leverage: this.config.leverage,
        openType: this.config.marginMode,
        quantity,
        type: "MARKET"
      });

      this.position = {
        positionType,
        entryPrice,
        quantity,
        contractSize: detail.contractSize,
        stopLossPrice,
        takeProfitPrice,
        leverage: this.config.leverage,
        marginMode: this.config.marginMode,
        entryOrderId: result.orderId,
        openedAt: Date.now()
      };
      this.persistState();
      this.persistOrder(positionType === "long" ? "BUY" : "SELL", entryPrice, quantity, result.orderId);
      this.emitEvent(
        "position_opened",
        `Opened ${positionType} ${quantity.toFixed(6)} contracts on ${this.config.symbol} @ ${entryPrice} (confidence ${signal.confidence}%)`
      );
    } catch (err) {
      this.emitEvent("order_rejected", `Scalp entry skipped: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  private async checkExit(): Promise<void> {
    const position = this.position;
    if (!position) return;
    const { futuresClient } = this.deps;

    const ticker = await futuresClient.ticker(this.config.symbol);
    const price = ticker.fairPrice;
    const hitTp = position.positionType === "long" ? price >= position.takeProfitPrice : price <= position.takeProfitPrice;
    const hitSl = position.positionType === "long" ? price <= position.stopLossPrice : price >= position.stopLossPrice;
    let reason: string | null = hitTp ? "take_profit" : hitSl ? "stop_loss" : null;

    if (!reason && this.config.exitOnSignalReversal) {
      reason = await this.checkSignalReversal(position.positionType);
    }

    if (!reason) return;
    await this.closePosition(position, price, reason);
  }

  /** Only exits on a flip to the opposite direction, never on NEUTRAL — NEUTRAL
   *  is the common resting state between directional signals (SignalMonitor
   *  treats it the same way), so exiting on every dip to it would make the
   *  bot far too trigger-happy. */
  private async checkSignalReversal(currentSide: "long" | "short"): Promise<string | null> {
    try {
      const rawCandles = await this.deps.futuresClient.klines(this.config.symbol, this.config.interval, 200);
      const candles: Kline[] = rawCandles.map((k) => ({ ...k, closeTime: k.openTime }));
      const signal = analyzeSignal(this.config.symbol, this.config.interval, candles, {
        atrStopMultiplier: this.config.atrStopMultiplier ?? DEFAULT_ATR_STOP_MULTIPLIER,
        atrTakeProfitMultiplier: this.config.atrTakeProfitMultiplier ?? DEFAULT_ATR_TAKE_PROFIT_MULTIPLIER,
        signalThreshold: (this.config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD) / 100
      });
      const reversed =
        (currentSide === "long" && signal.signal === "SHORT") || (currentSide === "short" && signal.signal === "LONG");
      return reversed ? "signal_reversal" : null;
    } catch (err) {
      if (err instanceof InsufficientCandlesError) return null;
      throw err;
    }
  }

  private async closePosition(position: ScalpPositionState, price: number, reason: string): Promise<void> {
    // action:"close" bypasses SafetyRails.checkOrder entirely (verified in
    // FuturesTradingService.placeOrder — the check only runs on "open") so a
    // paused/kill-switched bot can always de-risk out of an open position.
    await this.deps.futuresTrading.placeOrder({
      botId: this.botId,
      symbol: this.config.symbol,
      positionType: position.positionType,
      action: "close",
      leverage: position.leverage,
      openType: position.marginMode,
      quantity: position.quantity,
      type: "MARKET"
    });

    const direction = position.positionType === "long" ? 1 : -1;
    const realizedPnlUsdt = (price - position.entryPrice) * position.quantity * position.contractSize * direction;

    this.persistOrder(position.positionType === "long" ? "SELL" : "BUY", price, position.quantity, null);
    this.persistFill(position.positionType === "long" ? "SELL" : "BUY", price, position.quantity);
    this.deps.safety.recordRealizedPnl(this.botId, realizedPnlUsdt);

    this.position = null;
    this.persistState();
    this.emitEvent(
      "position_closed",
      `Closed ${position.positionType} @ ${price} (${reason}), pnl=${realizedPnlUsdt.toFixed(4)} USDT`
    );
  }

  private loadPersistedPosition(): ScalpPositionState | null {
    const row = this.deps.db.prepare(`SELECT state FROM bots WHERE id = ?`).get(this.botId) as
      | { state: string }
      | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.state) as { position?: ScalpPositionState | null };
      return parsed.position ?? null;
    } catch {
      return null;
    }
  }

  private persistState(): void {
    this.deps.db
      .prepare(`UPDATE bots SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ position: this.position }), Date.now(), this.botId);
  }

  private persistOrder(side: "BUY" | "SELL", price: number, quantity: number, exchangeOrderId: string | null): void {
    const now = Date.now();
    const clientOrderId = `scalp-${this.botId}-${randomUUID().slice(0, 8)}`;
    this.deps.db
      .prepare(
        `INSERT INTO orders (id, bot_id, client_order_id, exchange_order_id, symbol, side, type, price, quantity, status, created_at, updated_at)
         VALUES (@id, @bot_id, @client_order_id, @exchange_order_id, @symbol, @side, 'MARKET', @price, @quantity, 'FILLED', @created_at, @updated_at)`
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

  private persistFill(side: "BUY" | "SELL", price: number, quantity: number): void {
    const order = this.deps.db
      .prepare(`SELECT id FROM orders WHERE bot_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(this.botId) as { id: string } | undefined;
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
        side,
        price,
        quantity,
        quote_qty: price * quantity,
        created_at: Date.now()
      });
  }

  private emitEvent(type: string, message: string): void {
    this.deps.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (?, ?, ?, NULL, ?)`)
      .run(this.botId, type, message, Date.now());
  }
}
