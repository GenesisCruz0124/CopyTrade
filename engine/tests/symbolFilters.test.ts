import { describe, it, expect } from "vitest";
import { floorToStep, roundPriceToTick, roundQtyToStep, validateAndRoundOrder } from "../src/mexc/symbolFilters.js";
import type { SymbolFilter } from "../src/mexc/types.js";

const filter: SymbolFilter = {
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tickSize: 0.01,
  stepSize: 0.0001,
  minNotional: 5,
  minQty: 0.0001,
  maxQty: 1000,
  pricePrecision: 2,
  quantityPrecision: 4
};

describe("floorToStep", () => {
  it("floors to the nearest step multiple", () => {
    expect(floorToStep(1.23456, 0.01)).toBe(1.23);
    expect(floorToStep(1.23999, 0.01)).toBe(1.23);
  });

  it("never rounds up", () => {
    expect(floorToStep(1.239, 0.01)).toBeLessThanOrEqual(1.239);
  });

  it("returns the value unchanged when step is 0", () => {
    expect(floorToStep(1.23456, 0)).toBe(1.23456);
  });
});

describe("roundPriceToTick / roundQtyToStep", () => {
  it("rounds price down to tick size", () => {
    expect(roundPriceToTick(50123.456, filter)).toBe(50123.45);
  });

  it("rounds quantity down to step size", () => {
    expect(roundQtyToStep(0.123456, filter)).toBe(0.1234);
  });
});

describe("validateAndRoundOrder", () => {
  it("accepts a valid order and rounds it", () => {
    const result = validateAndRoundOrder(50123.456, 0.123456, filter);
    expect(result.ok).toBe(true);
    expect(result.price).toBe(50123.45);
    expect(result.quantity).toBe(0.1234);
  });

  it("rejects quantity below minQty", () => {
    const result = validateAndRoundOrder(50000, 0.00001, filter);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/minQty/);
  });

  it("rejects quantity above maxQty", () => {
    const result = validateAndRoundOrder(50000, 5000, filter);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/maxQty/);
  });

  it("rejects orders below minNotional", () => {
    const result = validateAndRoundOrder(1, 0.0001, filter);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/minNotional/);
  });
});
