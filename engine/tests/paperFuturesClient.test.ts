import { describe, it, expect } from "vitest";
import { PaperFuturesClient } from "../src/mexcFutures/paperFuturesClient.js";
import type { FuturesContractDetail, FuturesTicker } from "../src/mexcFutures/types.js";

const detail: FuturesContractDetail = {
  symbol: "BTC_USDT",
  baseCoin: "BTC",
  quoteCoin: "USDT",
  contractSize: 0.0001,
  priceUnit: 0.1,
  volUnit: 1,
  minVol: 1,
  maxVol: 1_000_000,
  minLeverage: 1,
  maxLeverage: 125,
  maintenanceMarginRate: 0.005,
  takerFeeRate: 0.0006
};

function makeClient(price: number, seedBalanceUsdt = 10_000) {
  let currentPrice = price;
  const marketData = {
    allContracts: async () => [{ symbol: detail.symbol, baseCoin: detail.baseCoin, quoteCoin: detail.quoteCoin, maxLeverage: detail.maxLeverage }],
    contractDetail: async (): Promise<FuturesContractDetail> => detail,
    ticker: async (): Promise<FuturesTicker> => ({ symbol: detail.symbol, lastPrice: currentPrice, fairPrice: currentPrice })
  };
  return { client: new PaperFuturesClient(marketData, seedBalanceUsdt), setPrice: (p: number) => (currentPrice = p) };
}

describe("PaperFuturesClient", () => {
  it("never places a real order — placeOrder always resolves locally without hitting the wrapped client", async () => {
    const { client } = makeClient(50_000);
    const result = await client.placeOrder({
      symbol: detail.symbol,
      side: 1, // open long
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "t1"
    });
    expect(result.orderId).toMatch(/^paper-/);
    expect(result.state).toBe("FILLED");
  });

  it("reserves margin on open and reflects it in assets()", async () => {
    const { client } = makeClient(50_000, 10_000);
    // notional = 100 * 0.0001 * 50000 = 500, margin = notional/leverage = 500/10 = 50
    await client.placeOrder({
      symbol: detail.symbol,
      side: 1,
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "t1"
    });
    const assets = await client.assets("USDT");
    expect(assets.availableBalance).toBeCloseTo(10_000 - 50, 6);
    expect(assets.positionMargin).toBeCloseTo(50, 6);
    expect(assets.equity).toBeCloseTo(10_000, 6);
  });

  it("rejects an open order that would exceed the paper balance", async () => {
    const { client } = makeClient(50_000, 10);
    await expect(
      client.placeOrder({
        symbol: detail.symbol,
        side: 1,
        vol: 100,
        leverage: 10,
        openType: "isolated",
        type: "MARKET",
        externalOid: "t1"
      })
    ).rejects.toThrow(/insufficient paper balance/);
  });

  it("credits back margin plus realized profit when a long position closes higher", async () => {
    const { client, setPrice } = makeClient(50_000, 10_000);
    await client.placeOrder({
      symbol: detail.symbol,
      side: 1, // open long
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "open"
    });
    setPrice(51_000);
    await client.placeOrder({
      symbol: detail.symbol,
      side: 4, // close long
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "close"
    });
    // pnl = (51000 - 50000) * 100 * 0.0001 = 10; refund = margin(50) + pnl(10) = 60
    const assets = await client.assets("USDT");
    expect(assets.availableBalance).toBeCloseTo(10_000 + 10, 6);
    expect(assets.positionMargin).toBeCloseTo(0, 6);
  });

  it("debits realized loss when a long position closes lower", async () => {
    const { client, setPrice } = makeClient(50_000, 10_000);
    await client.placeOrder({
      symbol: detail.symbol,
      side: 1,
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "open"
    });
    setPrice(49_000);
    await client.placeOrder({
      symbol: detail.symbol,
      side: 4,
      vol: 100,
      leverage: 10,
      openType: "isolated",
      type: "MARKET",
      externalOid: "close"
    });
    // pnl = (49000 - 50000) * 100 * 0.0001 = -10; refund = margin(50) - 10 = 40
    const assets = await client.assets("USDT");
    expect(assets.availableBalance).toBeCloseTo(10_000 - 10, 6);
  });
});
