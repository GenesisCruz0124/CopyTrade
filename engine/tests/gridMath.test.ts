import { describe, it, expect } from "vitest";
import {
  computeGridLevels,
  computeBudgetPerBuyLevel,
  validateGridRangeAgainstPrice,
  GridConfigError
} from "../src/strategies/grid/gridMath.js";

describe("computeGridLevels", () => {
  it("computes evenly spaced arithmetic levels", () => {
    const levels = computeGridLevels({ lowerPrice: 100, upperPrice: 200, gridLevels: 5, mode: "arithmetic" });
    expect(levels).toEqual([100, 125, 150, 175, 200]);
  });

  it("computes geometrically spaced levels with constant ratio", () => {
    const levels = computeGridLevels({ lowerPrice: 100, upperPrice: 1600, gridLevels: 5, mode: "geometric" });
    expect(levels[0]).toBeCloseTo(100);
    expect(levels[4]).toBeCloseTo(1600);
    const ratios = levels.slice(1).map((p, i) => p / levels[i]);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]);
  });

  it("rejects gridLevels below 2", () => {
    expect(() => computeGridLevels({ lowerPrice: 100, upperPrice: 200, gridLevels: 1, mode: "arithmetic" })).toThrow(
      GridConfigError
    );
  });

  it("rejects gridLevels above 50", () => {
    expect(() => computeGridLevels({ lowerPrice: 100, upperPrice: 200, gridLevels: 51, mode: "arithmetic" })).toThrow(
      GridConfigError
    );
  });

  it("rejects upperPrice <= lowerPrice", () => {
    expect(() => computeGridLevels({ lowerPrice: 200, upperPrice: 100, gridLevels: 5, mode: "arithmetic" })).toThrow(
      GridConfigError
    );
  });

  it("rejects non-positive prices", () => {
    expect(() => computeGridLevels({ lowerPrice: 0, upperPrice: 100, gridLevels: 5, mode: "arithmetic" })).toThrow(
      GridConfigError
    );
  });
});

describe("validateGridRangeAgainstPrice", () => {
  const baseConfig = {
    symbol: "BTCUSDT",
    lowerPrice: 100,
    upperPrice: 200,
    gridLevels: 5,
    totalBudgetUsdt: 1000,
    mode: "arithmetic" as const
  };

  it("passes when current price is inside the range", () => {
    expect(() => validateGridRangeAgainstPrice(baseConfig, 150)).not.toThrow();
  });

  it("throws when current price is at or below lowerPrice", () => {
    expect(() => validateGridRangeAgainstPrice(baseConfig, 100)).toThrow(GridConfigError);
    expect(() => validateGridRangeAgainstPrice(baseConfig, 50)).toThrow(GridConfigError);
  });

  it("throws when current price is at or above upperPrice", () => {
    expect(() => validateGridRangeAgainstPrice(baseConfig, 200)).toThrow(GridConfigError);
    expect(() => validateGridRangeAgainstPrice(baseConfig, 250)).toThrow(GridConfigError);
  });
});

describe("computeBudgetPerBuyLevel", () => {
  it("splits budget evenly across buy levels", () => {
    expect(computeBudgetPerBuyLevel(1000, 4)).toBe(250);
  });

  it("returns 0 when there are no buy levels", () => {
    expect(computeBudgetPerBuyLevel(1000, 0)).toBe(0);
  });
});
