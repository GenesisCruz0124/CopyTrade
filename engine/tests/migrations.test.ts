import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";

describe("bots table migration for futures_scalp", () => {
  it("rebuilds a pre-scalp bots table (rebuilt for futures grid/dca, predating scalp) so futures_scalp inserts succeed and existing rows survive", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Simulate a database that already went through the futures migration
    // (has user_id/market/leverage/margin_mode) but predates futures_scalp.
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        api_token TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        trading_mode TEXT NOT NULL DEFAULT 'paper',
        futures_trading_mode TEXT NOT NULL DEFAULT 'paper',
        futures_paper_seed_balance_usdt REAL NOT NULL DEFAULT 50000,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('grid', 'dca', 'futures_grid', 'futures_dca')),
        symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        config TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        confirm_live INTEGER NOT NULL DEFAULT 0,
        allocated_usdt REAL NOT NULL DEFAULT 0,
        daily_loss_limit_usdt REAL,
        realized_pnl_usdt REAL NOT NULL DEFAULT 0,
        market TEXT NOT NULL DEFAULT 'spot',
        leverage REAL,
        margin_mode TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare(
      `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, realized_pnl_usdt, market, created_at, updated_at)
       VALUES ('pre-existing-bot', 'futures_dca', 'BTC_USDT', 'running', '{}', '{}', 1, 100, 0, 'futures', ?, ?)`
    ).run(now, now);

    runMigrations(db);

    // Old row survived the rebuild intact.
    const preserved = db.prepare(`SELECT * FROM bots WHERE id = 'pre-existing-bot'`).get() as { type: string; status: string };
    expect(preserved.type).toBe("futures_dca");
    expect(preserved.status).toBe("running");

    // The new type is now accepted.
    expect(() =>
      db
        .prepare(
          `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, realized_pnl_usdt, market, created_at, updated_at)
           VALUES ('new-scalp-bot', 'futures_scalp', 'ETH_USDT', 'stopped', '{}', '{}', 0, 5000, 0, 'futures', ?, ?)`
        )
        .run(now, now)
    ).not.toThrow();

    // A genuinely invalid type is still rejected by the CHECK constraint.
    expect(() =>
      db
        .prepare(
          `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, realized_pnl_usdt, market, created_at, updated_at)
           VALUES ('bad-bot', 'not_a_real_type', 'ETH_USDT', 'stopped', '{}', '{}', 0, 5000, 0, 'futures', ?, ?)`
        )
        .run(now, now)
    ).toThrow();
  });

  it("is a no-op on a fresh database that already has futures_scalp from the base CREATE TABLE", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow(); // idempotent on a second run too
  });
});

describe("dangling bots_old foreign key repair", () => {
  it("leaves orders/fills/pnl_snapshots/events usable after a bots-table rebuild, even with pre-existing rows", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Same pre-scalp shape as the migration test above — this is what triggers
    // migrateBotsTableForScalp's rename-based rebuild, which is what corrupts
    // orders/fills/pnl_snapshots/events if left unrepaired.
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        api_token TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'user',
        trading_mode TEXT NOT NULL DEFAULT 'paper',
        futures_trading_mode TEXT NOT NULL DEFAULT 'paper',
        futures_paper_seed_balance_usdt REAL NOT NULL DEFAULT 50000,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('grid', 'dca', 'futures_grid', 'futures_dca')),
        symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped',
        config TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        confirm_live INTEGER NOT NULL DEFAULT 0,
        allocated_usdt REAL NOT NULL DEFAULT 0,
        daily_loss_limit_usdt REAL,
        realized_pnl_usdt REAL NOT NULL DEFAULT 0,
        market TEXT NOT NULL DEFAULT 'spot',
        leverage REAL,
        margin_mode TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL REFERENCES bots(id),
        client_order_id TEXT NOT NULL UNIQUE,
        exchange_order_id TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        type TEXT NOT NULL CHECK (type IN ('LIMIT', 'MARKET')),
        price REAL,
        quantity REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'NEW',
        grid_level INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE fills (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        bot_id TEXT NOT NULL REFERENCES bots(id),
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        quote_qty REAL NOT NULL,
        commission REAL NOT NULL DEFAULT 0,
        commission_asset TEXT,
        trade_id TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    const now = Date.now();
    db.prepare(
      `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, realized_pnl_usdt, market, created_at, updated_at)
       VALUES ('pre-existing-bot', 'futures_dca', 'BTC_USDT', 'running', '{}', '{}', 1, 100, 0, 'futures', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO orders (id, bot_id, client_order_id, symbol, side, type, quantity, created_at, updated_at)
       VALUES ('pre-existing-order', 'pre-existing-bot', 'coid-1', 'BTC_USDT', 'BUY', 'MARKET', 1, ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO fills (id, order_id, bot_id, symbol, side, price, quantity, quote_qty, created_at)
       VALUES ('pre-existing-fill', 'pre-existing-order', 'pre-existing-bot', 'BTC_USDT', 'BUY', 100, 1, 100, ?)`
    ).run(now);

    runMigrations(db);

    // Old rows in the FK-affected tables survived the repair intact.
    expect((db.prepare(`SELECT * FROM orders WHERE id = 'pre-existing-order'`).get() as { bot_id: string }).bot_id).toBe(
      "pre-existing-bot"
    );
    expect((db.prepare(`SELECT * FROM fills WHERE id = 'pre-existing-fill'`).get() as { bot_id: string }).bot_id).toBe(
      "pre-existing-bot"
    );

    // The bug: these used to throw "no such table: main.bots_old".
    expect(() =>
      db
        .prepare(
          `INSERT INTO orders (id, bot_id, client_order_id, symbol, side, type, quantity, created_at, updated_at)
           VALUES ('new-order', 'pre-existing-bot', 'coid-2', 'BTC_USDT', 'BUY', 'MARKET', 1, ?, ?)`
        )
        .run(now, now)
    ).not.toThrow();
    expect(() => db.prepare(`DELETE FROM fills WHERE bot_id = 'pre-existing-bot'`).run()).not.toThrow();
    expect(() => db.prepare(`DELETE FROM orders WHERE bot_id = 'pre-existing-bot'`).run()).not.toThrow();
    expect(() => db.prepare(`DELETE FROM bots WHERE id = 'pre-existing-bot'`).run()).not.toThrow();

    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("is a no-op when there is nothing to repair", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow(); // idempotent
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
