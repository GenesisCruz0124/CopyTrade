import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('grid', 'dca')),
      symbol TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'paused', 'stopped')),
      config TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '{}',
      confirm_live INTEGER NOT NULL DEFAULT 0,
      allocated_usdt REAL NOT NULL DEFAULT 0,
      daily_loss_limit_usdt REAL,
      realized_pnl_usdt REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
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

    CREATE TABLE IF NOT EXISTS fills (
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

    CREATE TABLE IF NOT EXISTS pnl_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id),
      realized_pnl_usdt REAL NOT NULL,
      unrealized_pnl_usdt REAL NOT NULL,
      equity_usdt REAL NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT REFERENCES bots(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_bot_id ON orders(bot_id);
    CREATE INDEX IF NOT EXISTS idx_fills_bot_id ON fills(bot_id);
    CREATE INDEX IF NOT EXISTS idx_pnl_bot_id ON pnl_snapshots(bot_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `);
}
