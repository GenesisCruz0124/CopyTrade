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
