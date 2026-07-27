import { describe, it, expect } from "vitest";

// Pure sizing math mirrored from FuturesScalpStrategy.tryEnter() — kept as a
// standalone function here so the formula is verifiable independent of the
// full strategy's async order-placement flow (covered separately in
// futuresScalpStrategy.test.ts).
function sizePosition(
  riskUsdAmount: number,
  suggestedEntry: number,
  stopLoss: number,
  takeProfit: number,
  contractSize: number,
  livePrice: number,
  positionType: "long" | "short"
) {
  const stopDist = Math.abs(suggestedEntry - stopLoss);
  const tpDist = Math.abs(takeProfit - suggestedEntry);
  const quantity = riskUsdAmount / (stopDist * contractSize);
  const stopLossPrice = positionType === "long" ? livePrice - stopDist : livePrice + stopDist;
  const takeProfitPrice = positionType === "long" ? livePrice + tpDist : livePrice - tpDist;
  return { quantity, stopLossPrice, takeProfitPrice };
}

describe("futures scalp position sizing", () => {
  it("derives quantity from riskUsdAmount / (stopDist * contractSize)", () => {
    // stopDist = 100, contractSize = 0.0001 -> risking $5 buys 5 / (100*0.0001) = 500 contracts
    const { quantity } = sizePosition(5, 60100, 60000, 60300, 0.0001, 60123, "long");
    expect(quantity).toBeCloseTo(5 / (100 * 0.0001), 6);
  });

  it("re-centers a long's stop/TP on the live price, not the stale candle close", () => {
    const { stopLossPrice, takeProfitPrice } = sizePosition(5, 60100, 60000, 60300, 0.0001, 60123, "long");
    // stopDist=100, tpDist=200, anchored on livePrice=60123
    expect(stopLossPrice).toBeCloseTo(60023, 6);
    expect(takeProfitPrice).toBeCloseTo(60323, 6);
  });

  it("re-centers a short's stop/TP on the live price with flipped direction", () => {
    const { stopLossPrice, takeProfitPrice } = sizePosition(5, 60100, 60200, 59900, 0.0001, 60077, "short");
    // stopDist=100, tpDist=200
    expect(stopLossPrice).toBeCloseTo(60177, 6);
    expect(takeProfitPrice).toBeCloseTo(59877, 6);
  });

  it("scales quantity linearly with riskUsdAmount", () => {
    const small = sizePosition(1, 60100, 60000, 60300, 0.0001, 60123, "long");
    const big = sizePosition(10, 60100, 60000, 60300, 0.0001, 60123, "long");
    expect(big.quantity).toBeCloseTo(small.quantity * 10, 6);
  });
});
