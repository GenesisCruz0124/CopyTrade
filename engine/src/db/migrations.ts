import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      trading_mode TEXT NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
      futures_trading_mode TEXT NOT NULL DEFAULT 'paper' CHECK (futures_trading_mode IN ('paper', 'live')),
      futures_paper_seed_balance_usdt REAL NOT NULL DEFAULT 50000,
      mexc_api_key_encrypted TEXT,
      mexc_api_secret_encrypted TEXT,
      mexc_futures_access_key_encrypted TEXT,
      mexc_futures_secret_key_encrypted TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
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
      user_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copy_signals (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
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
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS futures_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
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

    CREATE TABLE IF NOT EXISTS futures_pending_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('long', 'short')),
      leverage REAL NOT NULL,
      open_type TEXT NOT NULL CHECK (open_type IN ('isolated', 'cross')),
      limit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      contract_size REAL NOT NULL,
      sizing_mode TEXT NOT NULL CHECK (sizing_mode IN ('usd', 'percent')),
      sizing_usd_amount REAL,
      sizing_percent REAL,
      margin_usdt REAL NOT NULL,
      take_profit_percent REAL,
      stop_loss_percent REAL,
      risk_usdt REAL,
      taker_fee_rate REAL,
      order_id TEXT NOT NULL,
      external_oid TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_filled', 'filled', 'canceled', 'failed')),
      filled_quantity REAL NOT NULL DEFAULT 0,
      filled_price REAL,
      filled_at INTEGER,
      position_id TEXT REFERENCES futures_positions(id),
      cancel_reason TEXT,
      last_checked_at INTEGER,
      last_check_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_futures_positions_status ON futures_positions(status);
    CREATE INDEX IF NOT EXISTS idx_futures_pending_orders_status ON futures_pending_orders(status);
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

  // Multi-user support: existing databases predate the `users` table and these
  // FK columns, so backfill them via ALTER TABLE. NULL is a valid FK value in
  // SQLite (no violation), so pre-existing rows simply stay unowned until
  // attributed to a user.
  addColumnIfMissing(db, "bots", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(db, "events", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(db, "copy_signals", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(db, "futures_positions", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(db, "futures_pending_orders", "user_id", "TEXT REFERENCES users(id)");
  // Archiving: hides a signal from the default feed without changing its status
  // (unlike REJECTED, which is terminal) — archived_at is nullable, so existing
  // databases predating this column just backfill everyone as "not archived".
  addColumnIfMissing(db, "copy_signals", "archived_at", "INTEGER");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_copy_signals_archived_at ON copy_signals(archived_at);
    CREATE INDEX IF NOT EXISTS idx_bots_user_id ON bots(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
    CREATE INDEX IF NOT EXISTS idx_copy_signals_user_id ON copy_signals(user_id);
    CREATE INDEX IF NOT EXISTS idx_futures_positions_user_id ON futures_positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_futures_pending_orders_user_id ON futures_pending_orders(user_id);
  `);
}

/** Generic "add this column if an existing database predates it" migration —
 *  safe for any nullable, non-CHECK'd column (plain ALTER TABLE ADD COLUMN). */
function addColumnIfMissing(db: Database.Database, table: string, column: string, columnDdl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDdl}`);
}

/** All of these are plain nullable REAL columns added after futures_positions already
 *  shipped — no CHECK constraint involved, so a simple ALTER TABLE covers each one. */
function migrateFuturesPositionsColumn(db: Database.Database, column: string): void {
  addColumnIfMissing(db, "futures_positions", column, "REAL");
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
