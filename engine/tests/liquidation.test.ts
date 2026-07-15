import { describe, it, expect } from "vitest";
import { estimateLiquidationPrice, liquidationDistancePct } from "../src/mexcFutures/liquidation.js";

describe("estimateLiquidationPrice", () => {
  it("puts a long's liquidation price below entry", () => {
    const liq = estimateLiquidationPrice(50000, 10, 0.005, "long");
    expect(liq).toBeLessThan(50000);
  });

  it("puts a short's liquidation price above entry", () => {
    const liq = estimateLiquidationPrice(50000, 10, 0.005, "short");
    expect(liq).toBeGreaterThan(50000);
  });

  it("moves liquidation closer to entry as leverage increases", () => {
    const liqLowLev = estimateLiquidationPrice(50000, 5, 0.005, "long");
    const liqHighLev = estimateLiquidationPrice(50000, 50, 0.005, "long");
    expect(liqHighLev).toBeGreaterThan(liqLowLev); // higher leverage -> liquidation closer to entry for a long
  });
});

describe("liquidationDistancePct", () => {
  it("is symmetric in magnitude between long and short at the same leverage", () => {
    const longDist = liquidationDistancePct(50000, 10, 0.005, "long");
    const shortDist = liquidationDistancePct(50000, 10, 0.005, "short");
    expect(longDist).toBeCloseTo(shortDist, 5);
  });

  it("shrinks as leverage increases", () => {
    const distLow = liquidationDistancePct(50000, 5, 0.005, "long");
    const distHigh = liquidationDistancePct(50000, 50, 0.005, "long");
    expect(distHigh).toBeLessThan(distLow);
  });

  it("is roughly 1/leverage * 100 for small maintenance margin rates", () => {
    const dist = liquidationDistancePct(50000, 10, 0.0, "long");
    expect(dist).toBeCloseTo(10, 1); // 1/10 = 10%
  });
});
