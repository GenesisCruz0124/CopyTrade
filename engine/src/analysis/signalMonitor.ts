import type Database from "better-sqlite3";
import { analyzeSignal, InsufficientCandlesError } from "./signalEngine.js";
import type { MarketSignal, SignalDirection } from "./signalEngine.js";
import type { Kline } from "../mexc/types.js";
import { logger } from "../logger.js";

export type KlinesProvider = (symbol: string, interval: string, limit: number) => Promise<Kline[]>;

export interface SignalMonitorOptions {
  /** Pairs to watch, e.g. ["BTCUSDT", "ETHUSDT"]. Empty disables the monitor. */
  symbols: string[];
  interval: string;
  /** Only emit an event when confidence is at least this (0-100). */
  minConfidence: number;
  /** How often to re-evaluate every symbol, in seconds. */
  pollSeconds: number;
}

/**
 * Decide whether a freshly computed signal warrants emitting an event. We fire
 * only on a *change* in direction (and only for LONG/SHORT above the confidence
 * floor) so a persistent trend doesn't spam an identical event every tick.
 * NEUTRAL never emits — it resets the watch so the next directional flip fires.
 */
export function shouldEmitSignal(
  signal: MarketSignal,
  lastEmitted: SignalDirection | undefined,
  minConfidence: number
): boolean {
  if (signal.signal === "NEUTRAL") return false;
  if (signal.confidence < minConfidence) return false;
  return signal.signal !== lastEmitted;
}

/**
 * Periodically analyzes a watchlist of pairs and records a `signal` event in the
 * events feed whenever a strong LONG/SHORT signal appears (or flips). Advisory
 * only — it never places orders. Surfaces through the existing `/events` API.
 */
export class SignalMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private readonly lastDirection = new Map<string, SignalDirection>();

  constructor(
    private readonly db: Database.Database,
    private readonly klines: KlinesProvider,
    private readonly options: SignalMonitorOptions
  ) {}

  start(): void {
    if (this.options.symbols.length === 0) return;
    // Evaluate once shortly after startup, then on the poll interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.pollSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    for (const symbol of this.options.symbols) {
      try {
        await this.evaluate(symbol);
      } catch (err) {
        if (err instanceof InsufficientCandlesError) {
          logger.warn({ symbol }, "signal monitor: not enough candles yet");
        } else {
          logger.error({ err, symbol }, "signal monitor: evaluation failed");
        }
      }
    }
  }

  /**
   * Analyze one symbol; record an event if it crosses into a new strong signal.
   * Returns the computed signal (for tests), or null if it couldn't be analyzed.
   */
  async evaluate(symbol: string): Promise<MarketSignal> {
    const candles = await this.klines(symbol, this.options.interval, 200);
    const signal = analyzeSignal(symbol, this.options.interval, candles);
    const last = this.lastDirection.get(symbol);

    if (shouldEmitSignal(signal, last, this.options.minConfidence)) {
      this.record(signal);
      this.lastDirection.set(symbol, signal.signal);
    } else if (signal.signal === "NEUTRAL") {
      // Trend resolved — clear state so the next directional signal re-fires.
      this.lastDirection.delete(symbol);
    }
    return signal;
  }

  private record(signal: MarketSignal): void {
    const message = `${signal.signal} ${signal.symbol} @ ${signal.interval} (${signal.confidence}% confidence)`;
    this.db
      .prepare(`INSERT INTO events (bot_id, type, message, data, created_at) VALUES (NULL, 'signal', ?, ?, ?)`)
      .run(message, JSON.stringify(signal), Date.now());
    logger.info({ symbol: signal.symbol, signal: signal.signal, confidence: signal.confidence }, "signal event recorded");
  }
}

/** Parse a comma-separated symbol list from config into normalized pairs. */
export function parseSignalMonitorSymbols(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}
