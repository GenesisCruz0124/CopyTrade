import { describe, it, expect } from "vitest";
import { sma, ema, rsi, macd, atr } from "../src/analysis/indicators.js";

describe("sma", () => {
  it("averages the last `period` values", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([2, 4, 6, 8], 2)).toBe(7);
  });

  it("returns null when there is not enough data", () => {
    expect(sma([1, 2], 5)).toBeNull();
  });
});

describe("ema", () => {
  it("reacts faster than SMA to recent values", () => {
    const values = [10, 10, 10, 10, 10, 20];
    const emaValue = ema(values, 5)!;
    const smaValue = sma(values, 5)!;
    // The jump to 20 pulls the EMA above the equally-weighted SMA.
    expect(emaValue).toBeGreaterThan(smaValue);
  });

  it("equals the constant when all inputs are identical", () => {
    expect(ema([5, 5, 5, 5, 5, 5], 3)).toBeCloseTo(5);
  });
});

describe("rsi", () => {
  it("is 100 when every change is a gain", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)).toBe(100);
  });

  it("is low when the series only falls", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(closes, 14)!).toBeLessThan(5);
  });

  it("returns null without enough candles", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("macd", () => {
  it("has a positive line in a sustained uptrend", () => {
    // A steady uptrend keeps the fast EMA above the slow EMA, so the MACD line
    // stays positive. (On a perfectly linear ramp the histogram converges to ~0
    // as the signal line catches up, so we assert on the line, not the gap.)
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const result = macd(closes)!;
    expect(result).not.toBeNull();
    expect(result.macd).toBeGreaterThan(0);
  });

  it("has a positive histogram while momentum accelerates", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.1);
    const result = macd(closes)!;
    expect(result.histogram).toBeGreaterThan(0);
  });

  it("returns null without enough candles", () => {
    expect(macd([1, 2, 3, 4, 5])).toBeNull();
  });
});

describe("atr", () => {
  it("measures the average range in price units", () => {
    // Constant 10-wide candles => ATR converges to 10.
    const candles = Array.from({ length: 30 }, () => ({ high: 110, low: 100, close: 105 }));
    expect(atr(candles, 14)!).toBeCloseTo(10, 1);
  });

  it("returns null without enough candles", () => {
    expect(atr([{ high: 1, low: 0, close: 0.5 }], 14)).toBeNull();
  });
});
