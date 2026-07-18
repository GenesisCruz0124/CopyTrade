import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesPositionManager } from "../src/mexcFutures/futuresPositionManager.js";
import { FuturesPendingOrderManager } from "../src/mexcFutures/futuresPendingOrderManager.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";

function fakeFuturesClient(overrides: Partial<FuturesExchangeClient> = {}): FuturesExchangeClient {
  return {
    contractDetail: async () => ({
      symbol: "BTC_USDT",
      contractSize: 0.0001,
      priceUnit: 0.1,
      volUnit: 1,
      minVol: 1,
      maxVol: 1_000_000,
      maxLeverage: 125,
      takerFeeRate: 0.0006,
      makerFeeRate: 0.0002,
      maintenanceMarginRate: 0.005
    }),
    ticker: async () => ({ symbol: "BTC_USDT", fairPrice: 60000, lastPrice: 60000, indexPrice: 60000 }),
    assets: async () => ({ currency: "USDT", availableBalance: 10000, positionMargin: 0, frozenBalance: 0, equity: 10000 }),
    placeOrder: async () => ({ orderId: `order-${Math.random()}` }),
    cancelOrder: async () => {},
    getOrder: async () => {
      throw new Error("not used in this test");
    },
    openOrders: async () => [],
    ...overrides
  } as unknown as FuturesExchangeClient;
}

const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;

describe("per-user scoping of futures manual trading", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    for (const id of ["user-a", "user-b"]) {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, api_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, `${id}@example.com`, "hash", `${id}-token`, Date.now(), Date.now());
    }
  });

  it("only lists open positions belonging to the owning user", async () => {
    const client = fakeFuturesClient();
    const positionsA = new FuturesPositionManager(db, client, fakeSafety, 125, "user-a");
    const positionsB = new FuturesPositionManager(db, client, fakeSafety, 125, "user-b");

    await positionsA.open({ symbol: "BTC_USDT", side: "long", leverage: 5, openType: "isolated", sizing: { mode: "usd", usdAmount: 100 } });
    await positionsB.open({ symbol: "BTC_USDT", side: "short", leverage: 5, openType: "isolated", sizing: { mode: "usd", usdAmount: 200 } });

    const openA = await positionsA.listOpen();
    const openB = await positionsB.listOpen();
    expect(openA).toHaveLength(1);
    expect(openB).toHaveLength(1);
    expect(openA[0].side).toBe("long");
    expect(openB[0].side).toBe("short");
  });

  it("refuses to close another user's position", async () => {
    const client = fakeFuturesClient();
    const positionsA = new FuturesPositionManager(db, client, fakeSafety, 125, "user-a");
    const positionsB = new FuturesPositionManager(db, client, fakeSafety, 125, "user-b");

    const opened = await positionsA.open({
      symbol: "BTC_USDT",
      side: "long",
      leverage: 5,
      openType: "isolated",
      sizing: { mode: "usd", usdAmount: 100 }
    });

    await expect(positionsB.close(opened.id)).rejects.toThrow(/not found/);
    await expect(positionsA.close(opened.id)).resolves.toMatchObject({ status: "closed" });
  });

  it("legacy/unscoped runtime (userId null) never sees per-user positions and vice versa", async () => {
    const client = fakeFuturesClient();
    const legacy = new FuturesPositionManager(db, client, fakeSafety);
    const perUser = new FuturesPositionManager(db, client, fakeSafety, 125, "user-a");

    await legacy.open({ symbol: "BTC_USDT", side: "long", leverage: 5, openType: "isolated", sizing: { mode: "usd", usdAmount: 100 } });
    await perUser.open({ symbol: "BTC_USDT", side: "short", leverage: 5, openType: "isolated", sizing: { mode: "usd", usdAmount: 100 } });

    expect(await legacy.listOpen()).toHaveLength(1);
    expect(await perUser.listOpen()).toHaveLength(1);
    expect((await legacy.listOpen())[0].side).toBe("long");
    expect((await perUser.listOpen())[0].side).toBe("short");
  });

  it("scopes pending limit orders per user and refuses cross-user cancel", async () => {
    const client = fakeFuturesClient();
    const positionsA = new FuturesPositionManager(db, client, fakeSafety, 125, "user-a");
    const positionsB = new FuturesPositionManager(db, client, fakeSafety, 125, "user-b");
    const pendingA = new FuturesPendingOrderManager(db, client, fakeSafety, positionsA, 125, "user-a");
    const pendingB = new FuturesPendingOrderManager(db, client, fakeSafety, positionsB, 125, "user-b");

    const order = await pendingA.openLimit({
      symbol: "BTC_USDT",
      side: "long",
      leverage: 5,
      openType: "isolated",
      sizing: { mode: "usd", usdAmount: 100 },
      limitPrice: 59000
    });

    expect(pendingA.listPending()).toHaveLength(1);
    expect(pendingB.listPending()).toHaveLength(0);
    await expect(pendingB.cancelPending(order.id)).rejects.toThrow(/not found/);
  });
});
