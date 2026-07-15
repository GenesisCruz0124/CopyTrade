import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExchangeClient } from "./exchange/ExchangeClient.js";
import type { SafetyRails } from "./safety/safetyRails.js";
import type { BotConfigInput } from "./config/botConfigSchema.js";
import { GridStrategy } from "./strategies/grid/gridStrategy.js";
import { DcaStrategy } from "./strategies/dca/dcaStrategy.js";
import { FuturesGridStrategy } from "./strategies/grid/futuresGridStrategy.js";
import { FuturesDcaStrategy } from "./strategies/dca/futuresDcaStrategy.js";
import type { GridConfig, DcaConfig } from "./strategies/types.js";
import { isLiveMode } from "./config/env.js";
import type { FuturesRestClient } from "./mexcFutures/futuresRestClient.js";
import type { FuturesTradingService } from "./mexcFutures/FuturesTradingService.js";
import { logger } from "./logger.js";

export interface BotRecord {
  id: string;
  type: "grid" | "dca" | "futures_grid" | "futures_dca";
  symbol: string;
  status: "running" | "paused" | "stopped";
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  confirmLive: boolean;
  allocatedUsdt: number;
  dailyLossLimitUsdt: number | null;
  realizedPnlUsdt: number;
  createdAt: number;
  updatedAt: number;
}

type AnyStrategy = GridStrategy | DcaStrategy | FuturesGridStrategy | FuturesDcaStrategy;

interface BotEntry {
  record: BotRecord;
  strategy: AnyStrategy;
}

export interface FuturesDeps {
  futuresClient: FuturesRestClient;
  futuresTrading: FuturesTradingService;
}

export class BotManager {
  private bots = new Map<string, BotEntry>();

  constructor(
    private readonly db: Database.Database,
    private readonly exchange: ExchangeClient,
    private readonly safety: SafetyRails,
    private readonly subscribeSymbol?: (symbol: string) => void,
    private readonly futures?: FuturesDeps
  ) {
    this.loadExistingBots();
  }

  private loadExistingBots(): void {
    const rows = this.db.prepare(`SELECT * FROM bots`).all() as any[];
    for (const row of rows) {
      const record = this.rowToRecord(row);
      const strategy = this.buildStrategy(record);
      this.bots.set(record.id, { record, strategy });
      if (record.status === "running" && (record.type === "grid" || record.type === "dca")) {
        this.subscribeSymbol?.(record.symbol);
      }
      if (record.status === "running") {
        this.restartRunningBotOnBoot(record, strategy);
      }
    }
  }

  /**
   * A bot whose DB status is "running" survives a process restart, but its
   * in-memory strategy does not — nothing was actually placing orders for it
   * until this ran. In paper mode the simulated exchange is always empty on
   * boot anyway, so re-placing orders here is both safe and necessary. In
   * live mode blindly re-placing orders on top of whatever's already open on
   * the real exchange would be dangerous, so we only warn and require a
   * manual stop/start there instead.
   */
  private restartRunningBotOnBoot(record: BotRecord, strategy: AnyStrategy): void {
    if (isLiveMode()) {
      logger.warn(
        { botId: record.id, type: record.type },
        "bot was running before restart; live mode does not auto-resume order placement — stop and start it manually to reconcile"
      );
      return;
    }
    if (strategy instanceof GridStrategy || strategy instanceof FuturesGridStrategy) {
      strategy.start().catch((err) => logger.error({ err, botId: record.id }, "failed to resume grid bot after restart"));
    } else if (strategy instanceof DcaStrategy || strategy instanceof FuturesDcaStrategy) {
      strategy.start();
    }
  }

  create(input: BotConfigInput): BotRecord {
    if (isLiveMode() && !input.confirmLive) {
      throw new Error("Live trading requires confirmLive: true on the bot config");
    }
    if ((input.type === "futures_grid" || input.type === "futures_dca") && !this.futures) {
      throw new Error("Futures trading is not configured on this engine (missing MEXC futures API credentials)");
    }

    const id = randomUUID();
    const now = Date.now();
    const allocatedUsdt =
      input.type === "grid" || input.type === "futures_grid" ? input.totalBudgetUsdt : input.amountUsdt * 100;

    const record: BotRecord = {
      id,
      type: input.type,
      symbol: input.symbol,
      status: "stopped",
      config: input,
      state: {},
      confirmLive: input.confirmLive ?? false,
      allocatedUsdt,
      dailyLossLimitUsdt: input.dailyLossLimitUsdt ?? null,
      realizedPnlUsdt: 0,
      createdAt: now,
      updatedAt: now
    };

    const market = input.type.startsWith("futures_") ? "futures" : "spot";
    const leverage = "leverage" in input ? input.leverage : null;
    const marginMode = "marginMode" in input ? input.marginMode : null;

    this.db
      .prepare(
        `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, market, leverage, margin_mode, created_at, updated_at)
         VALUES (@id, @type, @symbol, @status, @config, @state, @confirm_live, @allocated_usdt, @daily_loss_limit_usdt, @realized_pnl_usdt, @market, @leverage, @margin_mode, @created_at, @updated_at)`
      )
      .run({
        id: record.id,
        type: record.type,
        symbol: record.symbol,
        status: record.status,
        config: JSON.stringify(record.config),
        state: JSON.stringify(record.state),
        confirm_live: record.confirmLive ? 1 : 0,
        allocated_usdt: record.allocatedUsdt,
        daily_loss_limit_usdt: record.dailyLossLimitUsdt,
        realized_pnl_usdt: 0,
        market,
        leverage,
        margin_mode: marginMode,
        created_at: now,
        updated_at: now
      });

    const strategy = this.buildStrategy(record);
    this.bots.set(id, { record, strategy });
    if (record.type === "grid" || record.type === "dca") this.subscribeSymbol?.(record.symbol);
    return record;
  }

  private buildStrategy(record: BotRecord): AnyStrategy {
    switch (record.type) {
      case "grid":
        return new GridStrategy(record.id, record.config as unknown as GridConfig, {
          db: this.db,
          exchange: this.exchange,
          safety: this.safety
        });
      case "dca":
        return new DcaStrategy(record.id, record.config as unknown as DcaConfig, {
          db: this.db,
          exchange: this.exchange,
          safety: this.safety
        });
      case "futures_grid": {
        if (!this.futures) throw new Error("Futures trading is not configured on this engine");
        return new FuturesGridStrategy(record.id, record.config as unknown as GridConfig, {
          db: this.db,
          futuresClient: this.futures.futuresClient,
          futuresTrading: this.futures.futuresTrading
        });
      }
      case "futures_dca": {
        if (!this.futures) throw new Error("Futures trading is not configured on this engine");
        return new FuturesDcaStrategy(record.id, record.config as unknown as DcaConfig, {
          db: this.db,
          futuresClient: this.futures.futuresClient,
          futuresTrading: this.futures.futuresTrading
        });
      }
    }
  }

  async start(botId: string): Promise<void> {
    const entry = this.requireBot(botId);
    this.setStatus(botId, "running");
    if (entry.strategy instanceof GridStrategy || entry.strategy instanceof FuturesGridStrategy) {
      await entry.strategy.start();
    } else {
      entry.strategy.start();
    }
  }

  /** Polls every running grid/DCA bot for order fills. There is no push-based fill notification wired up yet. */
  async reconcileAll(): Promise<void> {
    for (const entry of this.bots.values()) {
      if (entry.record.status !== "running") continue;
      if ("reconcile" in entry.strategy) {
        await (entry.strategy as { reconcile: () => Promise<void> }).reconcile().catch((err) => {
          logger.error({ err, botId: entry.record.id }, "reconcile failed");
        });
      }
    }
  }

  pause(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy || entry.strategy instanceof FuturesDcaStrategy) entry.strategy.stop();
    this.setStatus(botId, "paused");
  }

  stop(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy || entry.strategy instanceof FuturesDcaStrategy) entry.strategy.stop();
    this.setStatus(botId, "stopped");
  }

  remove(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy || entry.strategy instanceof FuturesDcaStrategy) entry.strategy.stop();

    // orders/fills/pnl_snapshots/events all carry a foreign key on bot_id (foreign_keys=ON),
    // so the bot row can't be deleted until anything referencing it is gone first.
    const deleteBotAndChildren = this.db.transaction((id: string) => {
      this.db.prepare(`DELETE FROM fills WHERE bot_id = ?`).run(id);
      this.db.prepare(`DELETE FROM orders WHERE bot_id = ?`).run(id);
      this.db.prepare(`DELETE FROM pnl_snapshots WHERE bot_id = ?`).run(id);
      this.db.prepare(`DELETE FROM events WHERE bot_id = ?`).run(id);
      this.db.prepare(`DELETE FROM bots WHERE id = ?`).run(id);
    });
    deleteBotAndChildren(botId);
    this.bots.delete(botId);
  }

  list(): BotRecord[] {
    return [...this.bots.values()].map((e) => e.record);
  }

  get(botId: string): BotRecord | undefined {
    return this.bots.get(botId)?.record;
  }

  getTrades(botId: string) {
    return this.db.prepare(`SELECT * FROM fills WHERE bot_id = ? ORDER BY created_at DESC LIMIT 500`).all(botId);
  }

  getOpenOrders(botId: string) {
    return this.db
      .prepare(`SELECT * FROM orders WHERE bot_id = ? AND status IN ('NEW', 'PARTIALLY_FILLED') ORDER BY created_at DESC`)
      .all(botId);
  }

  getPnlSeries(botId: string) {
    return this.db.prepare(`SELECT * FROM pnl_snapshots WHERE bot_id = ? ORDER BY created_at ASC`).all(botId);
  }

  private setStatus(botId: string, status: BotRecord["status"]): void {
    const entry = this.requireBot(botId);
    entry.record.status = status;
    entry.record.updatedAt = Date.now();
    this.db.prepare(`UPDATE bots SET status = ?, updated_at = ? WHERE id = ?`).run(status, entry.record.updatedAt, botId);
  }

  private requireBot(botId: string): BotEntry {
    const entry = this.bots.get(botId);
    if (!entry) throw new Error(`Bot ${botId} not found`);
    return entry;
  }

  private rowToRecord(row: any): BotRecord {
    return {
      id: row.id,
      type: row.type,
      symbol: row.symbol,
      status: row.status,
      config: JSON.parse(row.config),
      state: JSON.parse(row.state),
      confirmLive: !!row.confirm_live,
      allocatedUsdt: row.allocated_usdt,
      dailyLossLimitUsdt: row.daily_loss_limit_usdt,
      realizedPnlUsdt: row.realized_pnl_usdt,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
