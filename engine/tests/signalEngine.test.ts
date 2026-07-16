import { describe, it, expect } from "vitest";
import { analyzeSignal, InsufficientCandlesError } from "../src/analysis/signalEngine.js";
import type { Kline } from "../src/mexc/types.js";

/** Build a candle series from a list of closes, with small high/low wicks. */
function candlesFromCloses(closes: number[]): Kline[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const open = prev;
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

describe("analyzeSignal", () => {
  it("returns LONG for a sustained uptrend", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const signal = analyzeSignal("BTCUSDT", "15m", candlesFromCloses(closes));
    expect(signal.signal).toBe("LONG");
    expect(signal.score).toBeGreaterThan(0);
    expect(signal.confidence).toBeGreaterThan(0);
    // Bracket must sit the right side of entry for a long.
    expect(signal.stopLoss).toBeLessThan(signal.suggestedEntry);
    expect(signal.takeProfit).toBeGreaterThan(signal.suggestedEntry);
    expect(signal.riskRewardRatio).toBeGreaterThan(0);
  });

  it("returns SHORT for a sustained downtrend", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 200 - i);
    const signal = analyzeSignal("BTCUSDT", "15m", candlesFromCloses(closes));
    expect(signal.signal).toBe("SHORT");
    expect(signal.score).toBeLessThan(0);
    // Bracket flips for a short: stop above entry, target below.
    expect(signal.stopLoss).toBeGreaterThan(signal.suggestedEntry);
    expect(signal.takeProfit).toBeLessThan(signal.suggestedEntry);
    expect(signal.riskRewardRatio).toBeGreaterThan(0);
  });

  it("returns NEUTRAL for a flat, directionless market", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 0.05 : -0.05));
    const signal = analyzeSignal("BTCUSDT", "15m", candlesFromCloses(closes));
    expect(signal.signal).toBe("NEUTRAL");
    expect(signal.riskRewardRatio).toBeNull();
  });

  it("throws InsufficientCandlesError when given too few candles", () => {
    const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
    expect(() => analyzeSignal("BTCUSDT", "15m", candlesFromCloses(closes))).toThrow(
      InsufficientCandlesError
    );
  });

  it("reports the indicators and reasons it used", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const signal = analyzeSignal("BTCUSDT", "15m", candlesFromCloses(closes));
    expect(signal.indicators.rsi).toBeGreaterThan(50);
    expect(signal.indicators.atr).toBeGreaterThan(0);
    expect(signal.reasons.length).toBeGreaterThan(0);
    expect(signal.candlesAnalyzed).toBe(80);
  });

  it("scales confidence with trend strength", () => {
    const strong = analyzeSignal(
      "BTCUSDT",
      "15m",
      candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + i * 3))
    );
    const weak = analyzeSignal(
      "BTCUSDT",
      "15m",
      candlesFromCloses(Array.from({ length: 80 }, (_, i) => 100 + i * 0.05))
    );
    expect(strong.confidence).toBeGreaterThanOrEqual(weak.confidence);
  });
});
