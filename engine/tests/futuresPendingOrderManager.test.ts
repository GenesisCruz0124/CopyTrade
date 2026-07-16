import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { runMigrations } from "../src/db/migrations.js";
import { FuturesPendingOrderManager, type FuturesPendingOrderRow } from "../src/mexcFutures/futuresPendingOrderManager.js";
import type { FuturesOrderStatus } from "../src/mexcFutures/types.js";
import type { FuturesRestClient } from "../src/mexcFutures/futuresRestClient.js";
import type { SafetyRails } from "../src/safety/safetyRails.js";
import { FuturesPositionManager, type FuturesPositionRow } from "../src/mexcFutures/futuresPositionManager.js";

function baseOrderStatus(overrides: Partial<FuturesOrderStatus> = {}): FuturesOrderStatus {
  return {
    orderId: "111",
    symbol: "DOGE_USDT",
    externalOid: "man-limit-abc",
    state: 2,
    side: 1,
    openType: "isolated",
    orderType: "LIMIT",
    leverage: 5,
    price: 0.05,
    vol: 10,
    dealVol: 0,
    dealAvgPrice: 0,
    takerFeeRate: 0.0008,
    makerFeeRate: 0.0006,
    createTime: Date.now(),
    updateTime: Date.now(),
    ...overrides
  };
}

function insertPendingRow(db: Database.Database, overrides: Partial<FuturesPendingOrderRow> = {}): FuturesPendingOrderRow {
  const now = Date.now();
  const row: FuturesPendingOrderRow = {
    id: randomUUID(),
    symbol: "DOGE_USDT",
    side: "long",
    leverage: 5,
    open_type: "isolated",
    limit_price: 0.05,
    quantity: 10,
    contract_size: 10,
    sizing_mode: "usd",
    sizing_usd_amount: 20,
    sizing_percent: null,
    margin_usdt: 20,
    take_profit_percent: 10,
    stop_loss_percent: 5,
    risk_usdt: 10,
    taker_fee_rate: 0.0006,
    order_id: "111",
    external_oid: "man-limit-abc",
    status: "pending",
    filled_quantity: 0,
    filled_price: null,
    filled_at: null,
    position_id: null,
    cancel_reason: null,
    last_checked_at: null,
    last_check_error: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
  db.prepare(
    `INSERT INTO futures_pending_orders
       (id, symbol, side, leverage, open_type, limit_price, quantity, contract_size, sizing_mode,
        sizing_usd_amount, sizing_percent, margin_usdt, take_profit_percent, stop_loss_percent, risk_usdt,
        taker_fee_rate, order_id, external_oid, status, filled_quantity, filled_price, filled_at,
        position_id, cancel_reason, last_checked_at, last_check_error, created_at, updated_at)
     VALUES (@id, @symbol, @side, @leverage, @open_type, @limit_price, @quantity, @contract_size, @sizing_mode,
             @sizing_usd_amount, @sizing_percent, @margin_usdt, @take_profit_percent, @stop_loss_percent, @risk_usdt,
             @taker_fee_rate, @order_id, @external_oid, @status, @filled_quantity, @filled_price, @filled_at,
             @position_id, @cancel_reason, @last_checked_at, @last_check_error, @created_at, @updated_at)`
  ).run(row);
  return row;
}

function getRow(db: Database.Database, id: string): FuturesPendingOrderRow {
  return db.prepare(`SELECT * FROM futures_pending_orders WHERE id = ?`).get(id) as FuturesPendingOrderRow;
}

describe("FuturesPendingOrderManager.reconcilePending", () => {
  let db: Database.Database;
  let insertedPositions: FuturesPositionRow[];
  let getOrderResponses: FuturesOrderStatus[];
  let manager: FuturesPendingOrderManager;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    insertedPositions = [];
    getOrderResponses = [];

    const fakeFuturesClient = {
      getOrder: async () => {
        const next = getOrderResponses.shift();
        if (!next) throw new Error("no queued getOrder response");
        return next;
      },
      openOrders: async () => [],
      cancelOrder: async () => {}
    } as unknown as FuturesRestClient;

    const fakeSafety = { isKillSwitchEngaged: () => false } as unknown as SafetyRails;

    // Real FuturesPositionManager (not a mock) so insertRow() actually writes to
    // futures_positions — the pending-order row's position_id has a real FK to it.
    const positions = new FuturesPositionManager(db, fakeFuturesClient, fakeSafety);
    const realInsertRow = positions.insertRow.bind(positions);
    positions.insertRow = (row: FuturesPositionRow) => {
      insertedPositions.push(row);
      realInsertRow(row);
    };

    manager = new FuturesPendingOrderManager(db, fakeFuturesClient, fakeSafety, positions);
  });

  it("leaves a still-open, unfilled order as pending", async () => {
    const row = insertPendingRow(db);
    getOrderResponses.push(baseOrderStatus({ state: 2, dealVol: 0 }));

    await manager.reconcilePending();

    const after = getRow(db, row.id);
    expect(after.status).toBe("pending");
    expect(after.last_checked_at).not.toBeNull();
    expect(insertedPositions).toHaveLength(0);
  });

  it("creates a position and marks partially_filled on a partial fill", async () => {
    const row = insertPendingRow(db, { quantity: 10 });
    getOrderResponses.push(baseOrderStatus({ state: 2, dealVol: 4, dealAvgPrice: 0.0501 }));

    await manager.reconcilePending();

    const after = getRow(db, row.id);
    expect(after.status).toBe("partially_filled");
    expect(after.filled_quantity).toBe(4);
    expect(after.filled_price).toBe(0.0501);
    expect(after.position_id).not.toBeNull();
    expect(insertedPositions).toHaveLength(1);
    expect(insertedPositions[0].quantity).toBe(4);
    expect(insertedPositions[0].entry_price).toBe(0.0501);
  });

  it("creates a position and marks filled on a full fill", async () => {
    const row = insertPendingRow(db, { quantity: 10 });
    getOrderResponses.push(baseOrderStatus({ state: 3, dealVol: 10, dealAvgPrice: 0.0499 }));

    await manager.reconcilePending();

    const after = getRow(db, row.id);
    expect(after.status).toBe("filled");
    expect(after.filled_quantity).toBe(10);
    expect(after.position_id).not.toBeNull();
    expect(insertedPositions).toHaveLength(1);
  });

  it("marks canceled when the exchange reports state=4 with no fill", async () => {
    const row = insertPendingRow(db);
    getOrderResponses.push(baseOrderStatus({ state: 4, dealVol: 0 }));

    await manager.reconcilePending();

    const after = getRow(db, row.id);
    expect(after.status).toBe("canceled");
    expect(insertedPositions).toHaveLength(0);
  });

  it("does not re-create a position when polling an already-processed fill again", async () => {
    const row = insertPendingRow(db, { quantity: 10 });
    getOrderResponses.push(baseOrderStatus({ state: 3, dealVol: 10, dealAvgPrice: 0.05 }));
    await manager.reconcilePending();
    expect(insertedPositions).toHaveLength(1);

    // Second poll tick: order still reports the same filled state (as MEXC would
    // continue to for a completed order) — must not double-create a position.
    getOrderResponses.push(baseOrderStatus({ state: 3, dealVol: 10, dealAvgPrice: 0.05 }));
    await manager.reconcilePending();

    expect(insertedPositions).toHaveLength(1);
    const after = getRow(db, row.id);
    expect(after.status).toBe("filled");
  });

  it("opens the position without TP/SL if the real fill price invalidates the requested percent", async () => {
    // side=long, stopLossPercent=5 means SL price = entry * 0.95. If the fill price
    // is extremely close to zero relative to the percent maths this won't normally
    // break, so instead force the pathological case via an absurd stopLossPercent
    // that the pre-submission dry-check wouldn't have caught differently — here we
    // simulate it by directly setting an out-of-range percent on the stored row.
    const row = insertPendingRow(db, { quantity: 10, stop_loss_percent: 150 });
    getOrderResponses.push(baseOrderStatus({ state: 3, dealVol: 10, dealAvgPrice: 0.05 }));

    await manager.reconcilePending();

    const after = getRow(db, row.id);
    expect(after.status).toBe("filled");
    expect(insertedPositions).toHaveLength(1);
    // Fallback nulls out both TP and SL (not just the offending one) — recording
    // the real fill untouched matters more than preserving a partial TP/SL setup.
    expect(insertedPositions[0].stop_loss_price).toBeNull();
    expect(insertedPositions[0].take_profit_price).toBeNull();
  });
});
