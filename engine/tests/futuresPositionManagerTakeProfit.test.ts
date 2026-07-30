import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesPositionManager, type FuturesPositionRow } from "../src/mexcFutures/futuresPositionManager.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";

function insertOpenPosition(db: Database.Database, overrides: Partial<FuturesPositionRow> = {}): FuturesPositionRow {
  const now = Date.now();
  const row: FuturesPositionRow = {
    id: randomUUID(),
    symbol: "BTC_USDT",
    side: "long",
    leverage: 10,
    open_type: "isolated",
    entry_price: 100,
    quantity: 1,
    contract_size: 1,
    margin_usdt: 10,
    take_profit_price: null,
    stop_loss_price: null,
    risk_usdt: null,
    taker_fee_rate: 0.0006,
    open_fee_usdt: 0.06,
    close_fee_usdt: null,
    status: "open",
    close_price: null,
    close_reason: null,
    realized_pnl_usdt: null,
    order_id: null,
    created_at: now,
    updated_at: now,
    closed_at: null,
    ...overrides
  };
  db.prepare(
    `INSERT INTO futures_positions
       (id, symbol, side, leverage, open_type, entry_price, quantity, contract_size, margin_usdt,
        take_profit_price, stop_loss_price, risk_usdt, taker_fee_rate, open_fee_usdt, status, order_id, created_at, updated_at)
     VALUES (@id, @symbol, @side, @leverage, @open_type, @entry_price, @quantity, @contract_size, @margin_usdt,
             @take_profit_price, @stop_loss_price, @risk_usdt, @taker_fee_rate, @open_fee_usdt, @status, @order_id, @created_at, @updated_at)`
  ).run(row);
  return row;
}

describe("FuturesPositionManager.setTakeProfitByPnlPercent", () => {
  let db: Database.Database;
  let positions: FuturesPositionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const fakeFuturesClient = {} as unknown as FuturesExchangeClient;
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient, fakeSafety);
  });

  it("converts leveraged PnL% to a price-move% anchored on entry price (long)", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100 });
    const updated = await positions.setTakeProfitByPnlPercent(row.id, 10);
    // 10% PnL at 10x leverage = 1% price move -> 100 * 1.01 = 101
    expect(updated.take_profit_price).toBeCloseTo(101, 6);
  });

  it("converts leveraged PnL% to a price-move% anchored on entry price (short)", async () => {
    const row = insertOpenPosition(db, { side: "short", leverage: 5, entry_price: 200 });
    const updated = await positions.setTakeProfitByPnlPercent(row.id, 10);
    // 10% PnL at 5x leverage = 2% price move -> 200 * 0.98 = 196
    expect(updated.take_profit_price).toBeCloseTo(196, 6);
  });

  it("persists the new take-profit price to the database", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100 });
    await positions.setTakeProfitByPnlPercent(row.id, 10);
    const persisted = db.prepare(`SELECT take_profit_price FROM futures_positions WHERE id = ?`).get(row.id) as {
      take_profit_price: number;
    };
    expect(persisted.take_profit_price).toBeCloseTo(101, 6);
  });

  it("overwrites an existing take-profit price", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100, take_profit_price: 150 });
    const updated = await positions.setTakeProfitByPnlPercent(row.id, 20);
    expect(updated.take_profit_price).toBeCloseTo(102, 6);
  });

  it("rejects a non-positive percent", async () => {
    const row = insertOpenPosition(db);
    await expect(positions.setTakeProfitByPnlPercent(row.id, 0)).rejects.toThrow("greater than 0");
    await expect(positions.setTakeProfitByPnlPercent(row.id, -5)).rejects.toThrow("greater than 0");
  });

  it("rejects an unknown position id", async () => {
    await expect(positions.setTakeProfitByPnlPercent(randomUUID(), 10)).rejects.toThrow("not found");
  });

  it("rejects a position that's already closed", async () => {
    const row = insertOpenPosition(db, { status: "closed" });
    await expect(positions.setTakeProfitByPnlPercent(row.id, 10)).rejects.toThrow("already closed");
  });
});

describe("FuturesPositionManager.setTakeProfitByPrice", () => {
  let db: Database.Database;
  let positions: FuturesPositionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const fakeFuturesClient = {} as unknown as FuturesExchangeClient;
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient, fakeSafety);
  });

  it("sets the take-profit to exactly the given price", async () => {
    const row = insertOpenPosition(db, { entry_price: 100 });
    const updated = await positions.setTakeProfitByPrice(row.id, 123.45);
    expect(updated.take_profit_price).toBeCloseTo(123.45, 6);
  });

  it("overwrites an existing take-profit price", async () => {
    const row = insertOpenPosition(db, { take_profit_price: 150 });
    const updated = await positions.setTakeProfitByPrice(row.id, 200);
    expect(updated.take_profit_price).toBeCloseTo(200, 6);
  });

  it("rejects a non-positive price", async () => {
    const row = insertOpenPosition(db);
    await expect(positions.setTakeProfitByPrice(row.id, 0)).rejects.toThrow("greater than 0");
    await expect(positions.setTakeProfitByPrice(row.id, -5)).rejects.toThrow("greater than 0");
  });

  it("rejects a position that's already closed", async () => {
    const row = insertOpenPosition(db, { status: "closed" });
    await expect(positions.setTakeProfitByPrice(row.id, 123)).rejects.toThrow("already closed");
  });
});

describe("FuturesPositionManager.setStopLossByRiskUsd", () => {
  let db: Database.Database;
  let positions: FuturesPositionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const fakeFuturesClient = {} as unknown as FuturesExchangeClient;
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient, fakeSafety);
  });

  it("converts a dollar risk amount to a price-move% via margin * leverage (long)", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100, margin_usdt: 10 });
    // riskUsd=5 / (margin 10 * leverage 10) = 5% price move -> 100 * 0.95 = 95
    const updated = await positions.setStopLossByRiskUsd(row.id, 5);
    expect(updated.stop_loss_price).toBeCloseTo(95, 6);
    expect(updated.risk_usdt).toBeCloseTo(5, 6);
  });

  it("converts a dollar risk amount to a price-move% via margin * leverage (short)", async () => {
    const row = insertOpenPosition(db, { side: "short", leverage: 10, entry_price: 100, margin_usdt: 10 });
    const updated = await positions.setStopLossByRiskUsd(row.id, 5);
    expect(updated.stop_loss_price).toBeCloseTo(105, 6);
    expect(updated.risk_usdt).toBeCloseTo(5, 6);
  });

  it("rejects a risk amount implying a 100%+ price move", async () => {
    const row = insertOpenPosition(db, { leverage: 1, entry_price: 100, margin_usdt: 10 });
    await expect(positions.setStopLossByRiskUsd(row.id, 10)).rejects.toThrow("100% or more");
  });

  it("rejects a non-positive risk amount", async () => {
    const row = insertOpenPosition(db);
    await expect(positions.setStopLossByRiskUsd(row.id, 0)).rejects.toThrow("greater than 0");
  });

  it("rejects a position that's already closed", async () => {
    const row = insertOpenPosition(db, { status: "closed" });
    await expect(positions.setStopLossByRiskUsd(row.id, 5)).rejects.toThrow("already closed");
  });
});

describe("FuturesPositionManager.setStopLossByPrice", () => {
  let db: Database.Database;
  let positions: FuturesPositionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const fakeFuturesClient = {} as unknown as FuturesExchangeClient;
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient, fakeSafety);
  });

  it("sets the stop-loss to exactly the given price and backfills the implied risk_usdt (long)", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100, margin_usdt: 10 });
    const updated = await positions.setStopLossByPrice(row.id, 95);
    expect(updated.stop_loss_price).toBeCloseTo(95, 6);
    // 5% price move * margin 10 * leverage 10 = $5
    expect(updated.risk_usdt).toBeCloseTo(5, 6);
  });

  it("sets the stop-loss to exactly the given price and backfills the implied risk_usdt (short)", async () => {
    const row = insertOpenPosition(db, { side: "short", leverage: 10, entry_price: 100, margin_usdt: 10 });
    const updated = await positions.setStopLossByPrice(row.id, 105);
    expect(updated.stop_loss_price).toBeCloseTo(105, 6);
    expect(updated.risk_usdt).toBeCloseTo(5, 6);
  });

  it("leaves risk_usdt null when the price is on the wrong side of entry", async () => {
    const row = insertOpenPosition(db, { side: "long", leverage: 10, entry_price: 100, margin_usdt: 10 });
    const updated = await positions.setStopLossByPrice(row.id, 105);
    expect(updated.stop_loss_price).toBeCloseTo(105, 6);
    expect(updated.risk_usdt).toBeNull();
  });

  it("rejects a non-positive price", async () => {
    const row = insertOpenPosition(db);
    await expect(positions.setStopLossByPrice(row.id, 0)).rejects.toThrow("greater than 0");
  });

  it("rejects a position that's already closed", async () => {
    const row = insertOpenPosition(db, { status: "closed" });
    await expect(positions.setStopLossByPrice(row.id, 95)).rejects.toThrow("already closed");
  });
});
