import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { buildServer, type ApiServerDeps } from "../src/api/server.js";
import { BotManager } from "../src/botManager.js";
import { SafetyRails } from "../src/safety/safetyRails.js";
import { UserFuturesRuntimeRegistry } from "../src/runtime/userFuturesRuntime.js";
import type { ExchangeClient } from "../src/exchange/ExchangeClient.js";
import type { FuturesRestClient } from "../src/mexcFutures/futuresRestClient.js";
import { env } from "../src/config/env.js";
import type { FastifyInstance } from "fastify";

const fakeExchange: ExchangeClient = {
  mode: "paper",
  getExchangeInfo: async () => ({ symbols: [] }),
  getTickerPrice: async () => ({ symbol: "BTCUSDT", price: 60000 }),
  getAccountInfo: async () => ({ balances: [] }),
  placeOrder: async () => {
    throw new Error("not used in these tests");
  },
  cancelOrder: async () => {
    throw new Error("not used in these tests");
  },
  queryOrder: async () => {
    throw new Error("not used in these tests");
  },
  openOrders: async () => [],
  myTrades: async () => [],
  getKlines: async () => []
};

const fakePublicFuturesClient = {
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
  assets: async () => ({ currency: "USDT", availableBalance: 50000, positionMargin: 0, frozenBalance: 0, equity: 50000 })
} as unknown as FuturesRestClient;

function buildTestServer(): { app: FastifyInstance; db: Database.Database } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const safety = new SafetyRails({
    db,
    exchange: fakeExchange,
    maxPriceDeviationPct: env.MAX_ORDER_PRICE_DEVIATION_PCT,
    defaultDailyLossLimitUsdt: env.DEFAULT_DAILY_LOSS_LIMIT_USDT,
    maxFuturesLeverage: env.MAX_FUTURES_LEVERAGE,
    minLiquidationDistancePct: env.MIN_LIQUIDATION_DISTANCE_PCT
  });
  const botManager = new BotManager(db, fakeExchange, safety);
  const userFuturesRuntimes = new UserFuturesRuntimeRegistry({
    mainDb: db,
    safety,
    publicFuturesClient: fakePublicFuturesClient,
    maxFuturesLeverage: env.MAX_FUTURES_LEVERAGE
  });

  const deps: ApiServerDeps = {
    db,
    exchange: fakeExchange,
    safety,
    botManager,
    startedAt: Date.now(),
    userFuturesRuntimes
  };
  return { app: buildServer(deps), db };
}

describe("multi-tenant server routes", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    ({ app } = buildTestServer());
  });

  it("rejects requests without a valid token", async () => {
    const res = await app.inject({ method: "GET", url: "/futures/positions" });
    expect(res.statusCode).toBe(401);
  });

  it("rate limits repeated login attempts from the same client", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "nobody@example.com", password: "wrong-password" }
      });
    for (let i = 0; i < 10; i++) {
      const res = await attempt();
      expect(res.statusCode).toBe(401); // wrong credentials, but not yet rate-limited
    }
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
  });

  it("accepts the legacy admin token and returns the graceful empty-futures default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/futures/positions",
      headers: { authorization: `Bearer ${env.API_AUTH_TOKEN}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: "paper", positions: [] });
  });

  it("registers, logs in, and serves /me for a new user", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "trader@example.com", password: "password123" }
    });
    expect(register.statusCode).toBe(201);
    const { user } = register.json();
    expect(user.tradingMode).toBe("paper");
    expect(user.futuresTradingMode).toBe("paper");

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${user.apiToken}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("trader@example.com");
  });

  it("isolates two users' paper futures positions from each other", async () => {
    const userA = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a@example.com", password: "password123" } })
    ).json().user;
    const userB = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "b@example.com", password: "password123" } })
    ).json().user;

    const openA = await app.inject({
      method: "POST",
      url: "/futures/positions",
      headers: { authorization: `Bearer ${userA.apiToken}` },
      payload: { symbol: "BTC_USDT", side: "long", leverage: 5, openType: "isolated", amountUsd: 100 }
    });
    expect(openA.statusCode).toBe(201);

    const listA = await app.inject({
      method: "GET",
      url: "/futures/positions",
      headers: { authorization: `Bearer ${userA.apiToken}` }
    });
    const listB = await app.inject({
      method: "GET",
      url: "/futures/positions",
      headers: { authorization: `Bearer ${userB.apiToken}` }
    });
    expect(listA.json().positions).toHaveLength(1);
    expect(listB.json().positions).toHaveLength(0);
  });

  it("blocks switching futures trading mode to live without saved keys", async () => {
    const user = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "nokeys@example.com", password: "password123" } })
    ).json().user;

    const res = await app.inject({
      method: "PUT",
      url: "/me/trading-mode",
      headers: { authorization: `Bearer ${user.apiToken}` },
      payload: { futuresTradingMode: "live" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/exchange-keys/);
  });

  it("allows switching to live once exchange keys are saved", async () => {
    const user = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "live@example.com", password: "password123" } })
    ).json().user;

    const savedKeys = await app.inject({
      method: "PUT",
      url: "/me/exchange-keys",
      headers: { authorization: `Bearer ${user.apiToken}` },
      payload: { mexcFuturesAccessKey: "access", mexcFuturesSecretKey: "secret" }
    });
    expect(savedKeys.json().user.hasFuturesKeys).toBe(true);

    const switched = await app.inject({
      method: "PUT",
      url: "/me/trading-mode",
      headers: { authorization: `Bearer ${user.apiToken}` },
      payload: { futuresTradingMode: "live" }
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().user.futuresTradingMode).toBe("live");
  });
});
