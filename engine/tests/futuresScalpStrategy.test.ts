import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesScalpStrategy } from "../src/strategies/scalp/futuresScalpStrategy.js";
import type { ScalpConfig } from "../src/strategies/types.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { FuturesTradingService, PlaceFuturesOrderInput } from "../src/mexcFutures/FuturesTradingService.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";
import type { FuturesContractDetail, FuturesKline, FuturesOrderResult, FuturesTicker } from "../src/mexcFutures/types.js";

const CONTRACT_DETAIL: FuturesContractDetail = {
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

/** Same shape as signalEngine.test.ts's candlesFromCloses, minus the spot-only closeTime field. */
function candlesFromCloses(closes: number[]): FuturesKline[] {
  return closes.map((close, i) => {
    const prev = i === 0 ? close : closes[i - 1];
    const open = prev;
    return { openTime: i * 60_000, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 };
  });
}

const UPTREND_CLOSES = Array.from({ length: 80 }, (_, i) => 100 + i); // -> LONG signal
const DOWNTREND_CLOSES = Array.from({ length: 80 }, (_, i) => 200 - i); // -> SHORT signal
const FLAT_CLOSES = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 0.05 : -0.05)); // -> NEUTRAL

/** Flushes the microtask queue enough times for tick()'s chained awaits
 *  (ticker/klines/contractDetail, all resolved-on-next-tick mocks) to settle
 *  after a fire-and-forget start(). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function insertBot(db: Database.Database, id: string, config: ScalpConfig, state: unknown = { position: null }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt,
       realized_pnl_usdt, market, created_at, updated_at)
     VALUES (@id, 'futures_scalp', @symbol, 'running', @config, @state, 1, 5000, NULL, 0, 'futures', @created_at, @updated_at)`
  ).run({
    id,
    symbol: config.symbol,
    config: JSON.stringify({ type: "futures_scalp", ...config }),
    state: JSON.stringify(state),
    created_at: now,
    updated_at: now
  });
}

function readBotState(db: Database.Database, id: string): { position: unknown } {
  const row = db.prepare(`SELECT state FROM bots WHERE id = ?`).get(id) as { state: string };
  return JSON.parse(row.state);
}

describe("FuturesScalpStrategy", () => {
  const botId = "scalp-bot-1";
  const config: ScalpConfig = {
    symbol: "BTC_USDT",
    leverage: 10,
    marginMode: "isolated",
    riskUsdAmount: 5,
    interval: "Min1",
    confidenceThreshold: 35,
    exitOnSignalReversal: true
  };

  let db: Database.Database;
  let placedOrders: PlaceFuturesOrderInput[];
  let tickerPrice: number;
  let klineCloses: number[];
  let recordedPnl: { botId: string; pnlUsdt: number }[];
  let fakeFuturesClient: FuturesExchangeClient;
  let fakeFuturesTrading: FuturesTradingService;
  let fakeSafety: SafetyRails;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    placedOrders = [];
    recordedPnl = [];
    tickerPrice = 60123;
    klineCloses = UPTREND_CLOSES;

    fakeFuturesClient = {
      contractDetail: async () => CONTRACT_DETAIL,
      ticker: async (): Promise<FuturesTicker> => ({ symbol: config.symbol, lastPrice: tickerPrice, fairPrice: tickerPrice }),
      klines: async (): Promise<FuturesKline[]> => candlesFromCloses(klineCloses),
      allContracts: async () => [],
      placeOrder: async () => {
        throw new Error("unused: FuturesScalpStrategy calls futuresTrading.placeOrder, not the raw client");
      },
      cancelOrder: async () => {},
      getOrder: async () => {
        throw new Error("not used in these tests");
      },
      openOrders: async () => []
    } as unknown as FuturesExchangeClient;

    fakeFuturesTrading = {
      placeOrder: async (input: PlaceFuturesOrderInput): Promise<FuturesOrderResult> => {
        placedOrders.push(input);
        return { orderId: `order-${placedOrders.length}`, externalOid: "ext", symbol: input.symbol, state: "FILLED" };
      }
    } as unknown as FuturesTradingService;

    fakeSafety = {
      recordRealizedPnl: (id: string, pnlUsdt: number) => {
        recordedPnl.push({ botId: id, pnlUsdt });
      }
    } as unknown as SafetyRails;
  });

  function buildStrategy(): FuturesScalpStrategy {
    return new FuturesScalpStrategy(botId, config, {
      db,
      futuresClient: fakeFuturesClient,
      futuresTrading: fakeFuturesTrading,
      safety: fakeSafety
    });
  }

  it("opens a long when flat and the signal is LONG, sizing quantity from riskUsdAmount", async () => {
    insertBot(db, botId, config);
    const strategy = buildStrategy();

    await strategy.tick();

    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].action).toBe("open");
    expect(placedOrders[0].positionType).toBe("long");
    expect(placedOrders[0].quantity).toBeGreaterThan(0);

    const order = db.prepare(`SELECT side, status, type FROM orders WHERE bot_id = ?`).get(botId) as {
      side: string;
      status: string;
      type: string;
    };
    expect(order.side).toBe("BUY");
    expect(order.status).toBe("FILLED");
    expect(order.type).toBe("MARKET");

    const state = readBotState(db, botId);
    expect(state.position).not.toBeNull();
  });

  it("opens a short when flat and the signal is SHORT", async () => {
    klineCloses = DOWNTREND_CLOSES;
    insertBot(db, botId, config);
    const strategy = buildStrategy();

    await strategy.tick();

    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].positionType).toBe("short");
    const order = db.prepare(`SELECT side FROM orders WHERE bot_id = ?`).get(botId) as { side: string };
    expect(order.side).toBe("SELL");
  });

  it("places no order when flat and the signal is NEUTRAL", async () => {
    klineCloses = FLAT_CLOSES;
    insertBot(db, botId, config);
    const strategy = buildStrategy();

    await strategy.tick();

    expect(placedOrders).toHaveLength(0);
    const state = readBotState(db, botId);
    expect(state.position).toBeNull();
  });

  it("closes an open long on a take-profit cross and records realized PnL", async () => {
    const position = {
      positionType: "long" as const,
      entryPrice: 60000,
      quantity: 10,
      contractSize: 0.0001,
      stopLossPrice: 59800,
      takeProfitPrice: 60200,
      leverage: 10,
      marginMode: "isolated" as const,
      entryOrderId: "prior-order",
      openedAt: Date.now()
    };
    insertBot(db, botId, config, { position });
    tickerPrice = 60250; // above takeProfitPrice
    const strategy = buildStrategy();

    strategy.start();
    await flush();
    strategy.stop();

    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].action).toBe("close");
    expect(placedOrders[0].positionType).toBe("long");

    expect(recordedPnl).toHaveLength(1);
    const expectedPnl = (60250 - 60000) * 10 * 0.0001;
    expect(recordedPnl[0].pnlUsdt).toBeCloseTo(expectedPnl, 6);

    const order = db.prepare(`SELECT side FROM orders WHERE bot_id = ?`).get(botId) as { side: string };
    expect(order.side).toBe("SELL"); // closing a long is a sell

    const state = readBotState(db, botId);
    expect(state.position).toBeNull();

    const event = db.prepare(`SELECT type, message FROM events WHERE bot_id = ? ORDER BY id DESC LIMIT 1`).get(botId) as {
      type: string;
      message: string;
    };
    expect(event.type).toBe("position_closed");
    expect(event.message).toMatch(/take_profit/);
  });

  it("closes an open long on a stop-loss cross", async () => {
    const position = {
      positionType: "long" as const,
      entryPrice: 60000,
      quantity: 10,
      contractSize: 0.0001,
      stopLossPrice: 59800,
      takeProfitPrice: 60200,
      leverage: 10,
      marginMode: "isolated" as const,
      entryOrderId: "prior-order",
      openedAt: Date.now()
    };
    insertBot(db, botId, config, { position });
    tickerPrice = 59750; // below stopLossPrice
    const strategy = buildStrategy();

    strategy.start();
    await flush();
    strategy.stop();

    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].action).toBe("close");
    const event = db.prepare(`SELECT message FROM events WHERE bot_id = ? ORDER BY id DESC LIMIT 1`).get(botId) as {
      message: string;
    };
    expect(event.message).toMatch(/stop_loss/);
  });

  it("exits on a signal reversal when exitOnSignalReversal is true and price hasn't hit TP/SL", async () => {
    const position = {
      positionType: "long" as const,
      entryPrice: 60000,
      quantity: 10,
      contractSize: 0.0001,
      stopLossPrice: 100, // far away, won't trigger
      takeProfitPrice: 1_000_000, // far away, won't trigger
      leverage: 10,
      marginMode: "isolated" as const,
      entryOrderId: "prior-order",
      openedAt: Date.now()
    };
    insertBot(db, botId, config, { position });
    tickerPrice = 60050; // between SL and TP
    klineCloses = DOWNTREND_CLOSES; // signal flips to SHORT while holding a long
    const strategy = buildStrategy();

    strategy.start();
    await flush();
    strategy.stop();

    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].action).toBe("close");
    const event = db.prepare(`SELECT message FROM events WHERE bot_id = ? ORDER BY id DESC LIMIT 1`).get(botId) as {
      message: string;
    };
    expect(event.message).toMatch(/signal_reversal/);
  });

  it("stays in position on a signal reversal when exitOnSignalReversal is false", async () => {
    const position = {
      positionType: "long" as const,
      entryPrice: 60000,
      quantity: 10,
      contractSize: 0.0001,
      stopLossPrice: 100,
      takeProfitPrice: 1_000_000,
      leverage: 10,
      marginMode: "isolated" as const,
      entryOrderId: "prior-order",
      openedAt: Date.now()
    };
    const noReversalConfig: ScalpConfig = { ...config, exitOnSignalReversal: false };
    insertBot(db, botId, noReversalConfig, { position });
    tickerPrice = 60050;
    klineCloses = DOWNTREND_CLOSES;
    const strategy = new FuturesScalpStrategy(botId, noReversalConfig, {
      db,
      futuresClient: fakeFuturesClient,
      futuresTrading: fakeFuturesTrading,
      safety: fakeSafety
    });

    strategy.start();
    await flush();
    strategy.stop();

    expect(placedOrders).toHaveLength(0);
    const state = readBotState(db, botId);
    expect(state.position).not.toBeNull();
  });

  it("start() resumes from a persisted position and goes straight to checkExit, never re-entering", async () => {
    const position = {
      positionType: "long" as const,
      entryPrice: 60000,
      quantity: 10,
      contractSize: 0.0001,
      stopLossPrice: 59800,
      takeProfitPrice: 60200,
      leverage: 10,
      marginMode: "isolated" as const,
      entryOrderId: "prior-order",
      openedAt: Date.now()
    };
    insertBot(db, botId, config, { position });
    tickerPrice = 60050; // between SL and TP, nothing should fire yet
    const strategy = buildStrategy();

    strategy.start();
    await Promise.resolve(); // let the immediate tick's fire-and-forget promise settle
    await new Promise((r) => setImmediate(r));

    // No entry attempted (would be action:"open") and no exit fired (price is between SL/TP).
    expect(placedOrders).toHaveLength(0);
    const state = readBotState(db, botId);
    expect(state.position).not.toBeNull();
    strategy.stop();
  });

  it("stop() clears the timer so no further ticks fire", async () => {
    vi.useFakeTimers();
    insertBot(db, botId, config);
    const strategy = buildStrategy();

    strategy.start();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate tick
    const countAfterStart = placedOrders.length;

    strategy.stop();
    await vi.advanceTimersByTimeAsync(60_000); // several 15s ticks worth of time
    expect(placedOrders.length).toBe(countAfterStart);

    vi.useRealTimers();
  });
});
