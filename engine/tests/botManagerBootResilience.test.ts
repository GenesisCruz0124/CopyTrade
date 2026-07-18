import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { BotManager, type FuturesDeps } from "../src/botManager.js";
import type { ExchangeClient } from "../src/exchange/ExchangeClient.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { FuturesTradingService } from "../src/mexcFutures/FuturesTradingService.js";

const fakeExchange = {} as unknown as ExchangeClient;
const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
const fakeFutures: FuturesDeps = {
  futuresClient: {} as unknown as FuturesExchangeClient,
  futuresTrading: {} as unknown as FuturesTradingService
};

function insertBot(
  db: Database.Database,
  overrides: { id: string; type: string; symbol: string; status: string; config: string }
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt,
       realized_pnl_usdt, market, created_at, updated_at)
     VALUES (@id, @type, @symbol, @status, @config, '{}', 1, 100, NULL, 0, 'futures', @created_at, @updated_at)`
  ).run({ ...overrides, created_at: now, updated_at: now });
}

describe("BotManager boot resilience", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("does not crash on the copy-trading pseudo-bot's empty config (regression: engine crash-looped in production)", () => {
    insertBot(db, { id: "copy-trading", type: "futures_dca", symbol: "COPY_TRADING", status: "running", config: "{}" });

    expect(() => new BotManager(db, fakeExchange, fakeSafety, undefined, fakeFutures)).not.toThrow();

    const row = db.prepare(`SELECT status FROM bots WHERE id = 'copy-trading'`).get() as { status: string };
    expect(row.status).toBe("running"); // untouched — it was never meant to run as a real strategy
  });

  it("pauses (rather than crashing on) a real bot whose config fails to start, and logs an event", () => {
    // A futures_dca bot with interval "custom" but no cronExpression — the exact
    // shape that threw "custom interval requires cronExpression" in production.
    insertBot(db, {
      id: "bad-bot",
      type: "futures_dca",
      symbol: "BTC_USDT",
      status: "running",
      config: JSON.stringify({ symbol: "BTC_USDT", amountUsdt: 10, interval: "custom" })
    });

    expect(() => new BotManager(db, fakeExchange, fakeSafety, undefined, fakeFutures)).not.toThrow();

    const row = db.prepare(`SELECT status FROM bots WHERE id = 'bad-bot'`).get() as { status: string };
    expect(row.status).toBe("paused");

    const event = db.prepare(`SELECT type, message FROM events WHERE bot_id = 'bad-bot'`).get() as
      | { type: string; message: string }
      | undefined;
    expect(event?.type).toBe("resume_failed");
    expect(event?.message).toMatch(/cronExpression/);
  });

  it("still resumes a normally-configured running bot", () => {
    insertBot(db, {
      id: "good-bot",
      type: "futures_dca",
      symbol: "BTC_USDT",
      status: "running",
      config: JSON.stringify({ symbol: "BTC_USDT", amountUsdt: 10, interval: "daily" })
    });

    expect(() => new BotManager(db, fakeExchange, fakeSafety, undefined, fakeFutures)).not.toThrow();

    const row = db.prepare(`SELECT status FROM bots WHERE id = 'good-bot'`).get() as { status: string };
    expect(row.status).toBe("running");
  });
});
