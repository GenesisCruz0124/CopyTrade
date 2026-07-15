import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('grid', 'dca', 'futures_grid', 'futures_dca')),
      symbol TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'paused', 'stopped')),
      config TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT '{}',
      confirm_live INTEGER NOT NULL DEFAULT 0,
      allocated_usdt REAL NOT NULL DEFAULT 0,
      daily_loss_limit_usdt REAL,
      realized_pnl_usdt REAL NOT NULL DEFAULT 0,
      market TEXT NOT NULL DEFAULT 'spot' CHECK (market IN ('spot', 'futures')),
      leverage REAL,
      margin_mode TEXT CHECK (margin_mode IN ('isolated', 'cross')),
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

    CREATE TABLE IF NOT EXISTS copy_signals (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'discord',
      channel_message_id TEXT,
      image_path TEXT,
      symbol TEXT,
      side TEXT CHECK (side IN ('long', 'short')),
      leverage REAL,
      entry_price REAL,
      stop_loss REAL,
      take_profit REAL,
      confidence REAL,
      raw_extraction TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED')),
      order_id TEXT,
      failure_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS futures_positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('long', 'short')),
      leverage REAL NOT NULL,
      open_type TEXT NOT NULL CHECK (open_type IN ('isolated', 'cross')),
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      contract_size REAL NOT NULL,
      margin_usdt REAL NOT NULL,
      take_profit_price REAL,
      stop_loss_price REAL,
      risk_usdt REAL,
      taker_fee_rate REAL,
      open_fee_usdt REAL,
      close_fee_usdt REAL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      close_price REAL,
      close_reason TEXT,
      realized_pnl_usdt REAL,
      order_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_futures_positions_status ON futures_positions(status);
    CREATE INDEX IF NOT EXISTS idx_orders_bot_id ON orders(bot_id);
    CREATE INDEX IF NOT EXISTS idx_fills_bot_id ON fills(bot_id);
    CREATE INDEX IF NOT EXISTS idx_pnl_bot_id ON pnl_snapshots(bot_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_copy_signals_status ON copy_signals(status);
  `);

  migrateBotsTableForFutures(db);
  migrateFuturesPositionsColumn(db, "risk_usdt");
  migrateFuturesPositionsColumn(db, "taker_fee_rate");
  migrateFuturesPositionsColumn(db, "open_fee_usdt");
  migrateFuturesPositionsColumn(db, "close_fee_usdt");
}

/** All of these are plain nullable REAL columns added after futures_positions already
 *  shipped — no CHECK constraint involved, so a simple ALTER TABLE covers each one. */
function migrateFuturesPositionsColumn(db: Database.Database, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(futures_positions)`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE futures_positions ADD COLUMN ${column} REAL`);
}

/**
 * bots.type and bots.market may pre-date futures support (a DB created before
 * this migration). SQLite can't alter a CHECK constraint or add a CHECK'd
 * column after the fact, so detect the old schema and rebuild the table,
 * preserving all rows, rather than requiring a fresh database.
 */
function migrateBotsTableForFutures(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(bots)`).all() as { name: string }[];
  const hasMarketColumn = columns.some((c) => c.name === "market");
  if (hasMarketColumn) return;

  db.transaction(() => {
    db.exec(`ALTER TABLE bots RENAME TO bots_old`);
    db.exec(`
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('grid', 'dca', 'futures_grid', 'futures_dca')),
        symbol TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'paused', 'stopped')),
        config TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        confirm_live INTEGER NOT NULL DEFAULT 0,
        allocated_usdt REAL NOT NULL DEFAULT 0,
        daily_loss_limit_usdt REAL,
        realized_pnl_usdt REAL NOT NULL DEFAULT 0,
        market TEXT NOT NULL DEFAULT 'spot' CHECK (market IN ('spot', 'futures')),
        leverage REAL,
        margin_mode TEXT CHECK (margin_mode IN ('isolated', 'cross')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, created_at, updated_at)
      SELECT id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, created_at, updated_at FROM bots_old
    `);
    db.exec(`DROP TABLE bots_old`);
  })();
}
