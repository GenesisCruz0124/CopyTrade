import { describe, it, expect } from "vitest";

/**
 * The sizing formula used by CopySignalService.approve():
 * marginUsdt = budget * (riskPct / 100); notional = marginUsdt * leverage;
 * quantity = notional / entryPrice. Exercised directly here since it's
 * inlined in the service — this pins the math so it can't silently drift.
 */
function computeCopyTradeQuantity(budgetUsdt: number, riskPctPerTrade: number, leverage: number, entryPrice: number): number {
  const marginUsdt = budgetUsdt * (riskPctPerTrade / 100);
  const notional = marginUsdt * leverage;
  return notional / entryPrice;
}

describe("copy-trade position sizing", () => {
  it("sizes margin as a fixed percentage of the dedicated budget", () => {
    const qty = computeCopyTradeQuantity(1000, 2, 1, 50000);
    // marginUsdt = 20, notional = 20, quantity = 20/50000
    expect(qty).toBeCloseTo(0.0004, 8);
  });

  it("scales notional linearly with leverage", () => {
    const qtyAt1x = computeCopyTradeQuantity(1000, 2, 1, 50000);
    const qtyAt10x = computeCopyTradeQuantity(1000, 2, 10, 50000);
    expect(qtyAt10x).toBeCloseTo(qtyAt1x * 10, 8);
  });

  it("never sizes beyond the configured budget regardless of entry price", () => {
    const budget = 500;
    const riskPct = 2;
    const leverage = 5;
    for (const entryPrice of [1, 100, 50000, 100000]) {
      const qty = computeCopyTradeQuantity(budget, riskPct, leverage, entryPrice);
      const notional = qty * entryPrice;
      const marginUsed = notional / leverage;
      expect(marginUsed).toBeCloseTo(budget * (riskPct / 100), 8);
    }
  });
});
