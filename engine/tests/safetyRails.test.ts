import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { SafetyRails } from "../src/safety/safetyRails.js";
import type { ExchangeClient } from "../src/exchange/ExchangeClient.js";
import type { AccountInfo, ExchangeInfo, OrderResult, TickerPrice, TradeResult } from "../src/mexc/types.js";

function makeExchange(overrides: Partial<ExchangeClient> = {}): ExchangeClient {
  const exchangeInfo: ExchangeInfo = {
    symbols: [
      {
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
      }
    ]
  };
  const accountInfo: AccountInfo = {
    balances: [
      { asset: "USDT", free: 1000, locked: 0 },
      { asset: "BTC", free: 1, locked: 0 }
    ]
  };
  const ticker: TickerPrice = { symbol: "BTCUSDT", price: 50000 };

  return {
    mode: "paper",
    getExchangeInfo: async () => exchangeInfo,
    getTickerPrice: async () => ticker,
    getAccountInfo: async () => accountInfo,
    placeOrder: async () => ({} as OrderResult),
    cancelOrder: async () => ({} as OrderResult),
    queryOrder: async () => ({} as OrderResult),
    openOrders: async () => [],
    myTrades: async () => [] as TradeResult[],
    getKlines: async () => [],
    ...overrides
  };
}

function insertBot(db: Database.Database, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, created_at, updated_at)
     VALUES (@id, @type, @symbol, @status, @config, @state, @confirm_live, @allocated_usdt, @daily_loss_limit_usdt, @realized_pnl_usdt, @created_at, @updated_at)`
  ).run({
    id: "bot-1",
    type: "grid",
    symbol: "BTCUSDT",
    status: "running",
    config: "{}",
    state: "{}",
    confirm_live: 0,
    allocated_usdt: 500,
    daily_loss_limit_usdt: null,
    realized_pnl_usdt: 0,
    created_at: now,
    updated_at: now,
    ...overrides
  });
}

describe("SafetyRails.checkOrder", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("allows a well-formed order within budget and price bounds", async () => {
    insertBot(db);
    const rails = new SafetyRails({
      db,
      exchange: makeExchange(),
      maxPriceDeviationPct: 5,
      defaultDailyLossLimitUsdt: 50
    });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 0.001 });
    expect(result.allowed).toBe(true);
  });

  it("rejects orders when the bot is not running", async () => {
    insertBot(db, { status: "paused" });
    const rails = new SafetyRails({ db, exchange: makeExchange(), maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 0.001 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/paused/);
  });

  it("rejects orders that exceed the bot's budget cap", async () => {
    insertBot(db, { allocated_usdt: 10 });
    const rails = new SafetyRails({ db, exchange: makeExchange(), maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 1 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget/);
  });

  it("rejects orders priced too far from market", async () => {
    insertBot(db);
    const rails = new SafetyRails({ db, exchange: makeExchange(), maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 60000, quantity: 0.001 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deviates/);
  });

  it("rejects orders when balance is insufficient", async () => {
    insertBot(db, { allocated_usdt: 100000 });
    const exchange = makeExchange({
      getAccountInfo: async () => ({ balances: [{ asset: "USDT", free: 1, locked: 0 }] })
    });
    const rails = new SafetyRails({ db, exchange, maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 1 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/balance/);
  });

  it("pauses the bot and rejects further orders once the daily loss limit is hit", async () => {
    insertBot(db, { daily_loss_limit_usdt: 20 });
    db.prepare(
      `INSERT INTO pnl_snapshots (bot_id, realized_pnl_usdt, unrealized_pnl_usdt, equity_usdt, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run("bot-1", -25, 0, 475, Date.now());

    const rails = new SafetyRails({ db, exchange: makeExchange(), maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 0.001 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily loss/);

    const bot = db.prepare(`SELECT status FROM bots WHERE id = 'bot-1'`).get() as { status: string };
    expect(bot.status).toBe("paused");
  });

  it("rejects all orders once the kill switch is engaged", async () => {
    insertBot(db);
    const rails = new SafetyRails({ db, exchange: makeExchange(), maxPriceDeviationPct: 5, defaultDailyLossLimitUsdt: 50 });
    await rails.engageKillSwitch();
    const result = await rails.checkOrder("bot-1", { symbol: "BTCUSDT", side: "BUY", price: 50000, quantity: 0.001 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/kill switch/);
  });
});

describe("SafetyRails.checkOrder — futures", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("allows a futures order within max leverage and liquidation distance", async () => {
    insertBot(db, { allocated_usdt: 100000 });
    const rails = new SafetyRails({
      db,
      exchange: makeExchange(),
      maxPriceDeviationPct: 5,
      defaultDailyLossLimitUsdt: 50,
      maxFuturesLeverage: 20,
      minLiquidationDistancePct: 5
    });
    const result = await rails.checkOrder("bot-1", {
      symbol: "BTC_USDT",
      side: "BUY",
      price: 50000,
      quantity: 0.01,
      futures: { leverage: 5, positionType: "long", maintenanceMarginRate: 0.005, marketPrice: 50000 }
    });
    expect(result.allowed).toBe(true);
  });

  it("rejects futures orders that exceed the configured max leverage", async () => {
    insertBot(db, { allocated_usdt: 100000 });
    const rails = new SafetyRails({
      db,
      exchange: makeExchange(),
      maxPriceDeviationPct: 5,
      defaultDailyLossLimitUsdt: 50,
      maxFuturesLeverage: 20,
      minLiquidationDistancePct: 5
    });
    const result = await rails.checkOrder("bot-1", {
      symbol: "BTC_USDT",
      side: "BUY",
      price: 50000,
      quantity: 0.01,
      futures: { leverage: 50, positionType: "long", maintenanceMarginRate: 0.005, marketPrice: 50000 }
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/leverage/);
  });

  it("rejects futures orders whose liquidation distance is too tight", async () => {
    insertBot(db, { allocated_usdt: 100000 });
    const rails = new SafetyRails({
      db,
      exchange: makeExchange(),
      maxPriceDeviationPct: 5,
      defaultDailyLossLimitUsdt: 50,
      maxFuturesLeverage: 125,
      minLiquidationDistancePct: 15
    });
    const result = await rails.checkOrder("bot-1", {
      symbol: "BTC_USDT",
      side: "BUY",
      price: 50000,
      quantity: 0.01,
      futures: { leverage: 100, positionType: "long", maintenanceMarginRate: 0.005, marketPrice: 50000 }
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/liquidation/);
  });

  it("uses the caller-supplied marketPrice for the deviation check instead of the spot exchange client", async () => {
    insertBot(db, { allocated_usdt: 100000 });
    const rails = new SafetyRails({
      db,
      exchange: makeExchange(),
      maxPriceDeviationPct: 5,
      defaultDailyLossLimitUsdt: 50
    });
    const result = await rails.checkOrder("bot-1", {
      symbol: "BTC_USDT",
      side: "BUY",
      price: 50000,
      quantity: 0.01,
      futures: { leverage: 5, positionType: "long", maintenanceMarginRate: 0.005, marketPrice: 60000 }
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/deviates/);
  });
});
