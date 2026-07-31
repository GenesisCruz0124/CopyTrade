import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesPositionManager, type FuturesPositionRow } from "../src/mexcFutures/futuresPositionManager.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { FuturesTicker } from "../src/mexcFutures/types.js";
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

function ticker(fairPrice: number): FuturesTicker {
  return { symbol: "BTC_USDT", lastPrice: fairPrice, fairPrice, indexPrice: fairPrice } as FuturesTicker;
}

describe("FuturesPositionManager.close when MEXC says the position is already gone", () => {
  let db: Database.Database;
  let positions: FuturesPositionManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("reconciles the local row to closed instead of throwing on MEXC error code=2009", async () => {
    const fakeFuturesClient: Partial<FuturesExchangeClient> = {
      ticker: async () => ticker(110),
      placeOrder: async () => {
        throw new Error('MEXC futures API error code=2009: "Position is nonexistent or closed"');
      }
    };
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient as FuturesExchangeClient, fakeSafety);

    const row = insertOpenPosition(db, { side: "long", entry_price: 100, quantity: 1, contract_size: 1 });
    const closed = await positions.close(row.id, "manual");

    expect(closed.status).toBe("closed");
    expect(closed.close_reason).toBe("already_closed");
    expect(closed.close_price).toBeCloseTo(110, 6);
    expect(closed.realized_pnl_usdt).toBeCloseTo(10, 6);
    expect(closed.close_fee_usdt).toBeNull();

    const persisted = db.prepare(`SELECT status, close_reason FROM futures_positions WHERE id = ?`).get(row.id) as {
      status: string;
      close_reason: string;
    };
    expect(persisted.status).toBe("closed");
    expect(persisted.close_reason).toBe("already_closed");
  });

  it("still throws on unrelated placeOrder failures", async () => {
    const fakeFuturesClient: Partial<FuturesExchangeClient> = {
      ticker: async () => ticker(110),
      placeOrder: async () => {
        throw new Error("MEXC futures API error code=9999: something else entirely");
      }
    };
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient as FuturesExchangeClient, fakeSafety);

    const row = insertOpenPosition(db);
    await expect(positions.close(row.id)).rejects.toThrow("code=9999");

    const persisted = db.prepare(`SELECT status FROM futures_positions WHERE id = ?`).get(row.id) as { status: string };
    expect(persisted.status).toBe("open");
  });

  it("places a real closing order and reports a real fee when the position still exists", async () => {
    let placeOrderCalled = false;
    const fakeFuturesClient: Partial<FuturesExchangeClient> = {
      ticker: async () => ticker(110),
      placeOrder: async () => {
        placeOrderCalled = true;
        return { orderId: "order-1" };
      }
    };
    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;
    positions = new FuturesPositionManager(db, fakeFuturesClient as FuturesExchangeClient, fakeSafety);

    const row = insertOpenPosition(db, { side: "long", entry_price: 100, quantity: 1, contract_size: 1, taker_fee_rate: 0.0006 });
    const closed = await positions.close(row.id, "manual");

    expect(placeOrderCalled).toBe(true);
    expect(closed.close_reason).toBe("manual");
    expect(closed.close_fee_usdt).toBeCloseTo(110 * 0.0006, 6);
  });
});
