import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import {
  SignalMonitor,
  shouldEmitSignal,
  parseSignalMonitorSymbols
} from "../src/analysis/signalMonitor.js";
import type { MarketSignal } from "../src/analysis/signalEngine.js";
import type { Kline } from "../src/mexc/types.js";

function candlesFromCloses(closes: number[]): Kline[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      openTime: i * 60_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1000,
      closeTime: i * 60_000 + 59_999
    };
  });
}

const uptrend = () => candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + i * 3));
const downtrend = () => candlesFromCloses(Array.from({ length: 80 }, (_, i) => 340 - i * 3));
const flat = () => candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 0.05 : -0.05)));

function makeSignal(direction: MarketSignal["signal"], confidence: number): MarketSignal {
  return {
    symbol: "BTCUSDT",
    interval: "15m",
    signal: direction,
    confidence,
    score: 0,
    indicators: { price: 1, emaFast: 1, emaSlow: 1, rsi: 50, macd: 0, macdSignal: 0, macdHistogram: 0, atr: 1 },
    reasons: [],
    suggestedEntry: 1,
    stopLoss: 1,
    takeProfit: 1,
    riskRewardRatio: 2,
    candlesAnalyzed: 80,
    generatedAt: Date.now()
  };
}

describe("parseSignalMonitorSymbols", () => {
  it("splits, trims, uppercases, and drops blanks", () => {
    expect(parseSignalMonitorSymbols(" btcusdt, ethusdt ,, ")).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("returns an empty list for an empty string", () => {
    expect(parseSignalMonitorSymbols("")).toEqual([]);
  });
});

describe("shouldEmitSignal", () => {
  it("emits a fresh strong LONG", () => {
    expect(shouldEmitSignal(makeSignal("LONG", 80), undefined, 60)).toBe(true);
  });

  it("does not re-emit the same direction", () => {
    expect(shouldEmitSignal(makeSignal("LONG", 80), "LONG", 60)).toBe(false);
  });

  it("emits when the direction flips", () => {
    expect(shouldEmitSignal(makeSignal("SHORT", 80), "LONG", 60)).toBe(true);
  });

  it("suppresses signals below the confidence floor", () => {
    expect(shouldEmitSignal(makeSignal("LONG", 50), undefined, 60)).toBe(false);
  });

  it("never emits NEUTRAL", () => {
    expect(shouldEmitSignal(makeSignal("NEUTRAL", 90), undefined, 60)).toBe(false);
  });
});

describe("SignalMonitor.evaluate", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  const countSignalEvents = () =>
    (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'signal'`).get() as { n: number }).n;

  it("records a signal event for a strong trend", async () => {
    const monitor = new SignalMonitor(db, async () => uptrend(), {
      symbols: ["BTCUSDT"],
      interval: "15m",
      minConfidence: 40,
      pollSeconds: 300
    });
    const signal = await monitor.evaluate("BTCUSDT");
    expect(signal.signal).toBe("LONG");
    expect(countSignalEvents()).toBe(1);

    const row = db.prepare(`SELECT bot_id, message, data FROM events WHERE type = 'signal'`).get() as {
      bot_id: string | null;
      message: string;
      data: string;
    };
    expect(row.bot_id).toBeNull();
    expect(row.message).toContain("LONG BTCUSDT");
    expect(JSON.parse(row.data).symbol).toBe("BTCUSDT");
  });

  it("does not emit twice while the trend holds", async () => {
    const monitor = new SignalMonitor(db, async () => uptrend(), {
      symbols: ["BTCUSDT"],
      interval: "15m",
      minConfidence: 40,
      pollSeconds: 300
    });
    await monitor.evaluate("BTCUSDT");
    await monitor.evaluate("BTCUSDT");
    expect(countSignalEvents()).toBe(1);
  });

  it("emits again when the direction flips", async () => {
    let candles = uptrend();
    const monitor = new SignalMonitor(db, async () => candles, {
      symbols: ["BTCUSDT"],
      interval: "15m",
      minConfidence: 40,
      pollSeconds: 300
    });
    await monitor.evaluate("BTCUSDT"); // LONG
    candles = downtrend();
    const second = await monitor.evaluate("BTCUSDT"); // SHORT
    expect(second.signal).toBe("SHORT");
    expect(countSignalEvents()).toBe(2);
  });

  it("re-fires a direction after passing through NEUTRAL", async () => {
    let candles = uptrend();
    const monitor = new SignalMonitor(db, async () => candles, {
      symbols: ["BTCUSDT"],
      interval: "15m",
      minConfidence: 40,
      pollSeconds: 300
    });
    await monitor.evaluate("BTCUSDT"); // LONG (event 1)
    candles = flat();
    await monitor.evaluate("BTCUSDT"); // NEUTRAL -> resets state, no event
    candles = uptrend();
    await monitor.evaluate("BTCUSDT"); // LONG again (event 2)
    expect(countSignalEvents()).toBe(2);
  });

  it("suppresses signals under the confidence floor", async () => {
    const monitor = new SignalMonitor(db, async () => uptrend(), {
      symbols: ["BTCUSDT"],
      interval: "15m",
      minConfidence: 100, // unreachable
      pollSeconds: 300
    });
    await monitor.evaluate("BTCUSDT");
    expect(countSignalEvents()).toBe(0);
  });
});
