import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesPendingOrderManager } from "../src/mexcFutures/futuresPendingOrderManager.js";
import { FuturesPositionManager } from "../src/mexcFutures/futuresPositionManager.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { FuturesContractDetail, FuturesPlaceOrderParams, FuturesTicker } from "../src/mexcFutures/types.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";

function contractDetail(overrides: Partial<FuturesContractDetail> = {}): FuturesContractDetail {
  return {
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
    takerFeeRate: 0.0006,
    ...overrides
  };
}

function ticker(fairPrice: number): FuturesTicker {
  return { symbol: "BTC_USDT", lastPrice: fairPrice, fairPrice, indexPrice: fairPrice } as FuturesTicker;
}

describe("FuturesPendingOrderManager.openLimit price rounding", () => {
  let db: Database.Database;
  let manager: FuturesPendingOrderManager;
  let placeOrderCalls: FuturesPlaceOrderParams[];

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    placeOrderCalls = [];

    const fakeFuturesClient: Partial<FuturesExchangeClient> = {
      contractDetail: async () => contractDetail(),
      ticker: async () => ticker(64692.99),
      placeOrder: async (params) => {
        placeOrderCalls.push(params);
        return { orderId: "order-1" };
      }
    };

    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    const positions = new FuturesPositionManager(db, fakeFuturesClient as FuturesExchangeClient, fakeSafety);
    manager = new FuturesPendingOrderManager(db, fakeFuturesClient as FuturesExchangeClient, fakeSafety, positions);
  });

  it("rounds an unrounded limit price to the contract's tick size before sending it to the exchange", async () => {
    // A signal's suggested entry (from spot candle closes) has no relationship to a
    // futures contract's priceUnit — this is exactly what produced MEXC error code=2015
    // ("Price or quantity precision error") when sent through unrounded.
    const row = await manager.openLimit({
      symbol: "BTC_USDT",
      side: "short",
      leverage: 10,
      openType: "cross",
      sizing: { mode: "usd", usdAmount: 33.47 },
      limitPrice: 64692.99
    });

    expect(placeOrderCalls).toHaveLength(1);
    expect(placeOrderCalls[0].price).toBeCloseTo(64692.9, 6);
    expect(row.limit_price).toBeCloseTo(64692.9, 6);
  });

  it("rejects a limit price that rounds to zero at the contract's precision", async () => {
    await expect(
      manager.openLimit({
        symbol: "BTC_USDT",
        side: "long",
        leverage: 10,
        openType: "cross",
        sizing: { mode: "usd", usdAmount: 10 },
        limitPrice: 0.05
      })
    ).rejects.toThrow("rounds to zero");
  });
});
