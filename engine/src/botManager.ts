import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExchangeClient } from "./exchange/ExchangeClient.js";
import type { SafetyRails } from "./safety/safetyRails.js";
import type { BotConfigInput } from "./config/botConfigSchema.js";
import { GridStrategy } from "./strategies/grid/gridStrategy.js";
import { DcaStrategy } from "./strategies/dca/dcaStrategy.js";
import type { GridConfig, DcaConfig } from "./strategies/types.js";
import { isLiveMode } from "./config/env.js";

export interface BotRecord {
  id: string;
  type: "grid" | "dca";
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

interface BotEntry {
  record: BotRecord;
  strategy: GridStrategy | DcaStrategy;
}

export class BotManager {
  private bots = new Map<string, BotEntry>();

  constructor(
    private readonly db: Database.Database,
    private readonly exchange: ExchangeClient,
    private readonly safety: SafetyRails,
    private readonly subscribeSymbol?: (symbol: string) => void
  ) {
    this.loadExistingBots();
  }

  private loadExistingBots(): void {
    const rows = this.db.prepare(`SELECT * FROM bots`).all() as any[];
    for (const row of rows) {
      const record = this.rowToRecord(row);
      const strategy = this.buildStrategy(record);
      this.bots.set(record.id, { record, strategy });
      if (record.status === "running") this.subscribeSymbol?.(record.symbol);
    }
  }

  create(input: BotConfigInput): BotRecord {
    if (isLiveMode() && !input.confirmLive) {
      throw new Error("Live trading requires confirmLive: true on the bot config");
    }

    const id = randomUUID();
    const now = Date.now();
    const allocatedUsdt = input.type === "grid" ? input.totalBudgetUsdt : input.amountUsdt * 100;

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

    this.db
      .prepare(
        `INSERT INTO bots (id, type, symbol, status, config, state, confirm_live, allocated_usdt, daily_loss_limit_usdt, realized_pnl_usdt, created_at, updated_at)
         VALUES (@id, @type, @symbol, @status, @config, @state, @confirm_live, @allocated_usdt, @daily_loss_limit_usdt, @realized_pnl_usdt, @created_at, @updated_at)`
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
        created_at: now,
        updated_at: now
      });

    const strategy = this.buildStrategy(record);
    this.bots.set(id, { record, strategy });
    this.subscribeSymbol?.(record.symbol);
    return record;
  }

  private buildStrategy(record: BotRecord): GridStrategy | DcaStrategy {
    if (record.type === "grid") {
      return new GridStrategy(record.id, record.config as unknown as GridConfig, {
        db: this.db,
        exchange: this.exchange,
        safety: this.safety
      });
    }
    return new DcaStrategy(record.id, record.config as unknown as DcaConfig, {
      db: this.db,
      exchange: this.exchange,
      safety: this.safety
    });
  }

  async start(botId: string): Promise<void> {
    const entry = this.requireBot(botId);
    this.setStatus(botId, "running");
    if (entry.strategy instanceof GridStrategy) {
      await entry.strategy.start();
    } else {
      entry.strategy.start();
    }
  }

  pause(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy) entry.strategy.stop();
    this.setStatus(botId, "paused");
  }

  stop(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy) entry.strategy.stop();
    this.setStatus(botId, "stopped");
  }

  remove(botId: string): void {
    const entry = this.requireBot(botId);
    if (entry.strategy instanceof DcaStrategy) entry.strategy.stop();
    this.db.prepare(`DELETE FROM bots WHERE id = ?`).run(botId);
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
