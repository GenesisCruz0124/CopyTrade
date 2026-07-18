import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations.js";
import { FuturesRestClient } from "../mexcFutures/futuresRestClient.js";
import { PaperFuturesExchange } from "../mexcFutures/paperFuturesExchange.js";
import { FuturesTradingService } from "../mexcFutures/FuturesTradingService.js";
import { FuturesPositionManager } from "../mexcFutures/futuresPositionManager.js";
import { FuturesPendingOrderManager } from "../mexcFutures/futuresPendingOrderManager.js";
import type { FuturesExchangeClient } from "../mexcFutures/futuresExchangeClient.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import { decryptExchangeKeys, type UserRow } from "../auth/userService.js";
import { logger } from "../logger.js";

export interface UserFuturesRuntime {
  mode: "paper" | "live";
  futuresClient: FuturesExchangeClient;
  futuresTrading: FuturesTradingService;
  positions: FuturesPositionManager;
  pendingOrders: FuturesPendingOrderManager;
}

interface CacheEntry {
  cacheKey: string;
  runtime: UserFuturesRuntime;
  lastAccessedAt: number;
}

export interface UserFuturesRuntimeRegistryDeps {
  /** Shared main db — live-mode runtimes use it directly (rows scoped by user_id). */
  mainDb: Database.Database;
  /** Shared kill-switch/price-deviation gate — manual futures trading only reads
   *  its global isKillSwitchEngaged() flag, so one instance safely serves every user. */
  safety: SafetyRails;
  /** Real MEXC futures client used only for public, unsigned market data
   *  (contractDetail/ticker/klines) that paper-mode runtimes need — safe to
   *  share across users since it carries no per-user credentials. */
  publicFuturesClient: FuturesRestClient;
  maxFuturesLeverage: number;
  /** Runtimes idle longer than this are evicted on the next sweep to bound
   *  memory/open-handle growth at scale. Paper-mode state is discarded (a
   *  fresh paper balance/position set is rebuilt on next access); live-mode
   *  runtimes are stateless wrappers over the durable main db, so eviction
   *  never loses data there. */
  idleEvictionMs?: number;
}

const DEFAULT_IDLE_EVICTION_MS = 30 * 60 * 1000;

/**
 * Lazily builds and caches a per-user futures trading runtime (client +
 * manual position/pending-order managers), keyed off the user's current
 * futures_trading_mode and (encrypted) futures keys — changing either
 * invalidates the cache entry and rebuilds on next access.
 *
 * One shared background sweep (see startBackgroundLoop) drives TP/SL
 * monitoring and pending-order reconciliation across every cached runtime,
 * rather than each user owning its own timers — keeps timer/connection count
 * bounded as the user base grows instead of scaling linearly with logins.
 */
export class UserFuturesRuntimeRegistry {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: UserFuturesRuntimeRegistryDeps) {}

  getOrCreate(user: UserRow): UserFuturesRuntime {
    const cacheKey = [
      user.futures_trading_mode,
      user.mexc_futures_access_key_encrypted ?? "",
      user.mexc_futures_secret_key_encrypted ?? ""
    ].join("|");

    const existing = this.cache.get(user.id);
    if (existing && existing.cacheKey === cacheKey) {
      existing.lastAccessedAt = Date.now();
      return existing.runtime;
    }

    const runtime = this.build(user);
    this.cache.set(user.id, { cacheKey, runtime, lastAccessedAt: Date.now() });
    return runtime;
  }

  private build(user: UserRow): UserFuturesRuntime {
    const mode = user.futures_trading_mode;
    let futuresClient: FuturesExchangeClient;
    let db: Database.Database;
    let userId: string | null;

    if (mode === "live") {
      const keys = decryptExchangeKeys(user);
      if (!keys.mexcFuturesAccessKey || !keys.mexcFuturesSecretKey) {
        throw new Error("Set your MEXC futures API keys before switching to live trading");
      }
      futuresClient = new FuturesRestClient({
        accessKey: keys.mexcFuturesAccessKey,
        secretKey: keys.mexcFuturesSecretKey
      });
      // Shared main db holds every live user's rows — must filter by user_id.
      db = this.deps.mainDb;
      userId = user.id;
    } else {
      // Dedicated in-memory db per user, mirroring the engine's existing global
      // paper-mode setup — isolates simulated balances/positions for free, no
      // user_id filtering needed since nothing else ever reads this db.
      db = new Database(":memory:");
      runMigrations(db);
      futuresClient = new PaperFuturesExchange({
        liveClient: this.deps.publicFuturesClient,
        db,
        seedBalanceUsdt: user.futures_paper_seed_balance_usdt
      });
      userId = null;
    }

    const futuresTrading = new FuturesTradingService(futuresClient, this.deps.safety);
    const positions = new FuturesPositionManager(db, futuresClient, this.deps.safety, this.deps.maxFuturesLeverage, userId);
    const pendingOrders = new FuturesPendingOrderManager(
      db,
      futuresClient,
      this.deps.safety,
      positions,
      this.deps.maxFuturesLeverage,
      userId
    );

    logger.info({ userId: user.id, mode }, "built per-user futures runtime");
    return { mode, futuresClient, futuresTrading, positions, pendingOrders };
  }

  /** One shared tick driving every cached runtime's TP/SL monitor + pending-order
   *  reconcile, plus idle eviction. Returns the interval handle for shutdown. */
  startBackgroundLoop(intervalMs = 5000): NodeJS.Timeout {
    return setInterval(() => this.tick(), intervalMs);
  }

  private tick(): void {
    const idleLimit = this.deps.idleEvictionMs ?? DEFAULT_IDLE_EVICTION_MS;
    const now = Date.now();
    for (const [userId, entry] of this.cache) {
      if (now - entry.lastAccessedAt > idleLimit) {
        this.cache.delete(userId);
        continue;
      }
      entry.runtime.positions
        .monitor()
        .catch((err) => logger.error({ err, userId }, "per-user futures position monitor failed"));
      entry.runtime.pendingOrders
        .reconcilePending()
        .catch((err) => logger.error({ err, userId }, "per-user futures pending order reconcile failed"));
    }
  }
}
