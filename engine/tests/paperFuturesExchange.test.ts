import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { runMigrations } from "../src/db/migrations.js";
import { PaperFuturesExchange } from "../src/mexcFutures/paperFuturesExchange.js";
import type { FuturesRestClient } from "../src/mexcFutures/futuresRestClient.js";
import type { FuturesContractDetail, FuturesTicker } from "../src/mexcFutures/types.js";

function fakeContractDetail(overrides: Partial<FuturesContractDetail> = {}): FuturesContractDetail {
  return {
    symbol: "DOGE_USDT",
    baseCoin: "DOGE",
    quoteCoin: "USDT",
    contractSize: 100,
    priceUnit: 0.00001,
    volUnit: 1,
    minVol: 1,
    maxVol: 1_000_000,
    minLeverage: 1,
    maxLeverage: 100,
    maintenanceMarginRate: 0.005,
    takerFeeRate: 0.0006,
    ...overrides
  };
}

function insertPosition(
  db: Database.Database,
  overrides: Partial<{
    status: "open" | "closed";
    margin_usdt: number;
    realized_pnl_usdt: number | null;
    open_fee_usdt: number | null;
    close_fee_usdt: number | null;
  }> = {}
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO futures_positions
       (id, symbol, side, leverage, open_type, entry_price, quantity, contract_size, margin_usdt,
        status, realized_pnl_usdt, open_fee_usdt, close_fee_usdt, order_id, created_at, updated_at)
     VALUES (@id, 'DOGE_USDT', 'long', 1, 'isolated', 0.07, 10, 100, @margin_usdt,
             @status, @realized_pnl_usdt, @open_fee_usdt, @close_fee_usdt, 'test', @now, @now)`
  ).run({
    id: randomUUID(),
    margin_usdt: 20,
    status: "open",
    realized_pnl_usdt: null,
    open_fee_usdt: null,
    close_fee_usdt: null,
    now,
    ...overrides
  });
}

describe("PaperFuturesExchange", () => {
  let db: Database.Database;
  let tickerPrice: number;
  let fakeLiveClient: FuturesRestClient;
  let exchange: PaperFuturesExchange;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    tickerPrice = 0.07388;

    fakeLiveClient = {
      contractDetail: async () => fakeContractDetail(),
      ticker: async (): Promise<FuturesTicker> => ({ symbol: "DOGE_USDT", lastPrice: tickerPrice, fairPrice: tickerPrice }),
      klines: async () => [],
      allContracts: async () => []
    } as unknown as FuturesRestClient;

    exchange = new PaperFuturesExchange({ liveClient: fakeLiveClient, db, seedBalanceUsdt: 50_000 });
  });

  it("fills a MARKET order instantly with no further tracking", async () => {
    const result = await exchange.placeOrder({
      symbol: "DOGE_USDT",
      side: 1,
      vol: 10,
      leverage: 1,
      openType: "isolated",
      type: "MARKET",
      externalOid: "test-market"
    });
    expect(result.orderId).toMatch(/^paper-/);
    // No pending state should exist for it — openOrders() must not include it.
    const open = await exchange.openOrders("DOGE_USDT");
    expect(open).toHaveLength(0);
  });

  it("keeps a LIMIT order pending until the live price crosses it", async () => {
    const result = await exchange.placeOrder({
      symbol: "DOGE_USDT",
      side: 1, // open long — fills when price falls to/below the limit
      vol: 10,
      leverage: 1,
      openType: "isolated",
      type: "LIMIT",
      price: 0.07, // below current tickerPrice (0.07388) — not crossed yet
      externalOid: "test-limit-pending"
    });

    const status = await exchange.getOrder(result.orderId);
    expect(status.state).toBe(2);
    expect(status.dealVol).toBe(0);

    const open = await exchange.openOrders("DOGE_USDT");
    expect(open.map((o) => o.orderId)).toContain(result.orderId);
  });

  it("fills a LIMIT order once the live price crosses it, and freezes the fill price", async () => {
    const result = await exchange.placeOrder({
      symbol: "DOGE_USDT",
      side: 1,
      vol: 10,
      leverage: 1,
      openType: "isolated",
      type: "LIMIT",
      price: 0.075, // above current tickerPrice (0.07388) — already crossed for a buy-limit
      externalOid: "test-limit-fill"
    });

    const status = await exchange.getOrder(result.orderId);
    expect(status.state).toBe(3);
    expect(status.dealVol).toBe(10);
    expect(status.dealAvgPrice).toBe(0.07388);

    // Price keeps moving, but the recorded fill must not change on a later poll.
    tickerPrice = 0.08;
    const statusAgain = await exchange.getOrder(result.orderId);
    expect(statusAgain.dealAvgPrice).toBe(0.07388);

    const open = await exchange.openOrders("DOGE_USDT");
    expect(open).toHaveLength(0);
  });

  it("cancels a still-pending LIMIT order", async () => {
    const result = await exchange.placeOrder({
      symbol: "DOGE_USDT",
      side: 1,
      vol: 10,
      leverage: 1,
      openType: "isolated",
      type: "LIMIT",
      price: 0.07,
      externalOid: "test-limit-cancel"
    });

    await exchange.cancelOrder(result.orderId);
    const status = await exchange.getOrder(result.orderId);
    expect(status.state).toBe(4);
  });

  it("computes available balance as seed + closed PnL - locked margin", async () => {
    insertPosition(db, { status: "open", margin_usdt: 20 });
    insertPosition(db, { status: "closed", realized_pnl_usdt: 5, open_fee_usdt: 0.01, close_fee_usdt: 0.01 });

    const asset = await exchange.assets("USDT");
    expect(asset.positionMargin).toBe(20);
    expect(asset.availableBalance).toBeCloseTo(50_000 + (5 - 0.01 - 0.01) - 20, 6);
    expect(asset.equity).toBeCloseTo(asset.availableBalance + 20, 6);
  });
});
