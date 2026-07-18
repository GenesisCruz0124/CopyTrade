import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import { env, isLiveMode, isFuturesLiveMode } from "../config/env.js";
import { logger } from "../logger.js";
import { BotManager } from "../botManager.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import type { ExchangeClient } from "../exchange/ExchangeClient.js";
import { botConfigSchema } from "../config/botConfigSchema.js";
import { analyzeSignal, InsufficientCandlesError } from "../analysis/signalEngine.js";
import type { CopySignalService } from "../copySignals/copySignalService.js";
import type { FxRateService } from "../fx/fxRateService.js";
import type { FuturesDeps } from "../botManager.js";
import type { FuturesPositionManager, OpenPositionInput } from "../mexcFutures/futuresPositionManager.js";
import type { FuturesPendingOrderManager } from "../mexcFutures/futuresPendingOrderManager.js";
import type { FuturesExchangeClient } from "../mexcFutures/futuresExchangeClient.js";
import type { FuturesTradingService } from "../mexcFutures/FuturesTradingService.js";
import type { UserFuturesRuntimeRegistry } from "../runtime/userFuturesRuntime.js";
import { z } from "zod";
import {
  authenticateUser,
  EmailAlreadyRegisteredError,
  getUserByApiToken,
  InvalidCredentialsError,
  registerUser,
  toPublicUser,
  updateExchangeKeys,
  updateTradingMode,
  type UserRow
} from "../auth/userService.js";

declare module "fastify" {
  interface FastifyRequest {
    userRow?: UserRow;
  }
}

export interface ApiServerDeps {
  db: Database.Database;
  exchange: ExchangeClient;
  safety: SafetyRails;
  botManager: BotManager;
  startedAt: number;
  copySignals?: CopySignalService;
  fxRates?: FxRateService;
  futures?: FuturesDeps;
  futuresPositions?: FuturesPositionManager;
  futuresPendingOrders?: FuturesPendingOrderManager;
  /** When set, authenticated per-user requests (req.userRow) trade through their
   *  own runtime (own keys/mode) instead of the legacy global futures deps above. */
  userFuturesRuntimes?: UserFuturesRuntimeRegistry;
}

const openPositionSchema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["long", "short"]),
    leverage: z.number().positive(),
    openType: z.enum(["isolated", "cross"]).default("isolated"),
    amountUsd: z.number().positive().optional(),
    percentOfBalance: z.number().positive().max(100).optional(),
    takeProfitPercent: z.number().positive().optional(),
    stopLossPercent: z.number().positive().optional(),
    orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
    limitPrice: z.number().positive().optional()
  })
  .refine((v) => v.amountUsd != null || v.percentOfBalance != null, {
    message: "either amountUsd or percentOfBalance is required"
  })
  .refine((v) => v.orderType !== "LIMIT" || v.limitPrice != null, {
    message: "limitPrice is required when orderType is LIMIT"
  });

/**
 * Balances come back in native units per asset (BTC, ETH, USDT, ...) — summing
 * them directly is meaningless. Values each non-USDT asset at its current
 * USDT ticker price; assets with no direct USDT pair are excluded from the
 * total rather than guessed at.
 */
async function computeTotalValueUsdt(
  exchange: ExchangeClient,
  balances: { asset: string; free: number; locked: number }[]
): Promise<number> {
  let total = 0;
  for (const balance of balances) {
    const amount = balance.free + balance.locked;
    if (amount === 0) continue;
    if (balance.asset === "USDT" || balance.asset === "USD") {
      total += amount;
      continue;
    }
    try {
      const ticker = await exchange.getTickerPrice(`${balance.asset}USDT`);
      total += amount * ticker.price;
    } catch {
      // no direct USDT pair known for this asset — leave it out rather than guess
    }
  }
  return total;
}

function modeOf(): "paper" | "live" {
  return isLiveMode() ? "live" : "paper";
}

/** Futures mode is independent of spot's modeOf() — using modeOf() for futures
 *  responses previously mislabeled every real futures trade as "paper" whenever
 *  spot happened to be in paper mode (found live during testing 2026-07-16). */
function futuresModeOf(): "paper" | "live" {
  return isFuturesLiveMode() ? "live" : "paper";
}

interface FuturesRuntimeBundle {
  mode: "paper" | "live";
  futuresClient: FuturesExchangeClient;
  futuresTrading: FuturesTradingService;
  positions: FuturesPositionManager;
  pendingOrders: FuturesPendingOrderManager;
}

/**
 * Resolves which futures runtime a request trades through: the requesting
 * user's own (own keys/mode, built lazily by userFuturesRuntimes) when
 * authenticated with a per-user token, else the legacy engine-wide deps
 * (env-configured keys) for the admin/unscoped token — unchanged behavior
 * for existing single-tenant deployments.
 *
 * `null` means "futures isn't configured at all here" (feature unavailable —
 * some GET routes reply with an empty/zeroed body for this rather than an
 * error, matching pre-multi-user behavior). An `error` string means the
 * requesting user specifically misconfigured their own runtime (e.g. live
 * mode selected but no keys saved yet) — always worth surfacing as a 400,
 * never silently swallowed into an empty list.
 */
function resolveFuturesRuntime(deps: ApiServerDeps, req: FastifyRequest): FuturesRuntimeBundle | { error: string } | null {
  if (req.userRow) {
    if (!deps.userFuturesRuntimes) return null;
    try {
      return deps.userFuturesRuntimes.getOrCreate(req.userRow);
    } catch (err) {
      return { error: String(err instanceof Error ? err.message : err) };
    }
  }
  if (!deps.futures || !deps.futuresPositions || !deps.futuresPendingOrders) return null;
  return {
    mode: futuresModeOf(),
    futuresClient: deps.futures.futuresClient,
    futuresTrading: deps.futures.futuresTrading,
    positions: deps.futuresPositions,
    pendingOrders: deps.futuresPendingOrders
  };
}

/** For routes that must have a working runtime (writes, and reads with no
 *  sensible empty fallback). Sends the reply itself on failure and returns
 *  null so callers can just `if (!runtime) return;`. */
function getFuturesRuntimeOrReply(deps: ApiServerDeps, req: FastifyRequest, reply: FastifyReply): FuturesRuntimeBundle | null {
  const resolved = resolveFuturesRuntime(deps, req);
  if (resolved === null) {
    reply.code(400).send({ mode: futuresModeOf(), error: "futures trading is not configured on this engine" });
    return null;
  }
  if ("error" in resolved) {
    reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
    return null;
  }
  return resolved;
}

export function buildServer(deps: ApiServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  const AUTH_EXEMPT_PATHS = new Set(["/auth/register", "/auth/login"]);

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (AUTH_EXEMPT_PATHS.has(path)) return;

    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (token === env.API_AUTH_TOKEN) {
      // Legacy/admin token: full unscoped access, no user attached.
      return;
    }
    const user = token ? getUserByApiToken(deps.db, token) : null;
    if (!user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    req.userRow = user;
  });

  app.get("/status", async (_req, reply) => {
    const account = await deps.exchange.getAccountInfo().catch(() => ({ balances: [] }));
    const totalValueUsdt = await computeTotalValueUsdt(deps.exchange, account.balances).catch(() => null);
    const phpRate = deps.fxRates?.getUsdToPhpRate() ?? null;
    reply.send({
      mode: modeOf(),
      uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
      balances: account.balances,
      totalValueUsdt,
      usdToPhpRate: phpRate,
      totalValuePhp: totalValueUsdt !== null && phpRate !== null ? totalValueUsdt * phpRate : null,
      killSwitchEngaged: deps.safety.isKillSwitchEngaged()
    });
  });

  app.get("/bots", async (_req, reply) => {
    reply.send({ mode: modeOf(), bots: deps.botManager.list() });
  });

  app.post("/bots", async (req, reply) => {
    const parsed = botConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ mode: modeOf(), error: "invalid config", details: parsed.error.flatten() });
      return;
    }
    try {
      const bot = deps.botManager.create(parsed.data);
      reply.code(201).send({ mode: modeOf(), bot });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/bots/:id/start", async (req, reply) => {
    try {
      await deps.botManager.start(req.params.id);
      reply.send({ mode: modeOf(), bot: deps.botManager.get(req.params.id) });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/bots/:id/pause", async (req, reply) => {
    try {
      deps.botManager.pause(req.params.id);
      reply.send({ mode: modeOf(), bot: deps.botManager.get(req.params.id) });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/bots/:id/stop", async (req, reply) => {
    try {
      deps.botManager.stop(req.params.id);
      reply.send({ mode: modeOf(), bot: deps.botManager.get(req.params.id) });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.delete<{ Params: { id: string } }>("/bots/:id", async (req, reply) => {
    try {
      deps.botManager.remove(req.params.id);
      reply.send({ mode: modeOf(), ok: true });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get<{ Params: { id: string } }>("/bots/:id/trades", async (req, reply) => {
    reply.send({ mode: modeOf(), trades: deps.botManager.getTrades(req.params.id) });
  });

  app.get<{ Params: { id: string } }>("/bots/:id/orders", async (req, reply) => {
    reply.send({ mode: modeOf(), orders: deps.botManager.getOpenOrders(req.params.id) });
  });

  app.get<{ Params: { id: string } }>("/bots/:id/pnl", async (req, reply) => {
    reply.send({ mode: modeOf(), series: deps.botManager.getPnlSeries(req.params.id) });
  });

  app.get<{ Params: { symbol: string } }>("/price/:symbol", async (req, reply) => {
    try {
      const ticker = await deps.exchange.getTickerPrice(req.params.symbol);
      reply.send({ mode: modeOf(), symbol: ticker.symbol, price: ticker.price });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { interval?: string; limit?: string } }>(
    "/klines/:symbol",
    async (req, reply) => {
      try {
        const interval = req.query.interval ?? "15m";
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const klines = await deps.exchange.getKlines(req.params.symbol, interval, limit);
        reply.send({ mode: modeOf(), symbol: req.params.symbol, klines });
      } catch (err) {
        reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
      }
    }
  );

  // Market-analysis signal: fetch candles for the pair and return a LONG/SHORT/
  // NEUTRAL futures signal with confidence, indicator breakdown, and an
  // ATR-based entry/stop-loss/take-profit bracket. Advisory only — it does not
  // place any orders. Interval accepts MEXC kline intervals (e.g. 5m,15m,1h,4h).
  const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
  app.get<{ Params: { symbol: string }; Querystring: { interval?: string } }>(
    "/signals/:symbol",
    async (req, reply) => {
      const symbol = req.params.symbol.toUpperCase();
      const interval = req.query.interval ?? "15m";
      if (!ALLOWED_INTERVALS.has(interval)) {
        reply.code(400).send({
          mode: modeOf(),
          error: `unsupported interval '${interval}'; allowed: ${[...ALLOWED_INTERVALS].join(", ")}`
        });
        return;
      }
      try {
        const candles = await deps.exchange.getKlines(symbol, interval, 200);
        const signal = analyzeSignal(symbol, interval, candles);
        reply.send({ mode: modeOf(), signal });
      } catch (err) {
        if (err instanceof InsufficientCandlesError) {
          reply.code(422).send({ mode: modeOf(), error: err.message });
          return;
        }
        reply.code(502).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
      }
    }
  );

  app.get<{ Querystring: { since?: string } }>("/events", async (req, reply) => {
    const since = req.query.since ? Number(req.query.since) : 0;
    const events = deps.db
      .prepare(`SELECT * FROM events WHERE created_at > ? ORDER BY created_at ASC LIMIT 500`)
      .all(since);
    reply.send({ mode: modeOf(), events });
  });

  app.get("/futures/symbols", async (_req, reply) => {
    if (!deps.futures) {
      reply.code(400).send({ mode: futuresModeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    try {
      const symbols = await deps.futures.futuresClient.allContracts();
      reply.send({ mode: futuresModeOf(), symbols });
    } catch (err) {
      reply.code(502).send({ mode: futuresModeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get("/futures/balance", async (req, reply) => {
    const runtime = getFuturesRuntimeOrReply(deps, req, reply);
    if (!runtime) return;
    try {
      const asset = await runtime.futuresClient.assets("USDT");
      reply.send({ mode: runtime.mode, balance: asset });
    } catch (err) {
      reply.code(502).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get<{ Params: { symbol: string } }>("/futures/price/:symbol", async (req, reply) => {
    const runtime = getFuturesRuntimeOrReply(deps, req, reply);
    if (!runtime) return;
    try {
      const ticker = await runtime.futuresClient.ticker(req.params.symbol);
      reply.send({ mode: runtime.mode, symbol: ticker.symbol, price: ticker.fairPrice });
    } catch (err) {
      reply.code(502).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    "/futures/klines/:symbol",
    async (req, reply) => {
      const runtime = getFuturesRuntimeOrReply(deps, req, reply);
      if (!runtime) return;
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const klines = await runtime.futuresClient.klines(req.params.symbol, "Min15", limit);
        reply.send({ mode: runtime.mode, symbol: req.params.symbol, klines });
      } catch (err) {
        reply.code(502).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
      }
    }
  );

  app.get("/futures/positions", async (req, reply) => {
    const resolved = resolveFuturesRuntime(deps, req);
    if (resolved === null) {
      reply.send({ mode: futuresModeOf(), positions: [] });
      return;
    }
    if ("error" in resolved) {
      reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
      return;
    }
    const positions = await resolved.positions.listOpen();
    reply.send({ mode: resolved.mode, positions });
  });

  app.get<{ Querystring: { limit?: string } }>("/futures/positions/history", async (req, reply) => {
    const resolved = resolveFuturesRuntime(deps, req);
    if (resolved === null) {
      reply.send({ mode: futuresModeOf(), positions: [] });
      return;
    }
    if ("error" in resolved) {
      reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const positions = resolved.positions.listClosed(limit);
    reply.send({ mode: resolved.mode, positions });
  });

  app.get("/futures/pnl/today", async (req, reply) => {
    const resolved = resolveFuturesRuntime(deps, req);
    if (resolved === null) {
      reply.send({ mode: futuresModeOf(), realizedPnlUsdt: 0, realizedPnlPercent: null, tradesCount: 0 });
      return;
    }
    if ("error" in resolved) {
      reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
      return;
    }
    reply.send({ mode: resolved.mode, ...resolved.positions.todaysPnl() });
  });

  app.post("/futures/positions", async (req, reply) => {
    const runtime = getFuturesRuntimeOrReply(deps, req, reply);
    if (!runtime) return;
    const parsed = openPositionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ mode: runtime.mode, error: "invalid position request", details: parsed.error.flatten() });
      return;
    }
    // Was previously gated on spot's isLiveMode() — meant a real futures order could
    // skip the confirmLive requirement whenever spot happened to be in paper mode
    // (found alongside the mode-mislabeling bug above). Must check futures' own mode.
    if (runtime.mode === "live" && !(req.body as { confirmLive?: boolean })?.confirmLive) {
      reply.code(400).send({ mode: runtime.mode, error: "Live trading requires confirmLive: true" });
      return;
    }
    const v = parsed.data;
    const sizing = v.amountUsd != null ? ({ mode: "usd", usdAmount: v.amountUsd } as const) : ({ mode: "percent", percent: v.percentOfBalance! } as const);

    if (v.orderType === "LIMIT") {
      try {
        const pendingOrder = await runtime.pendingOrders.openLimit({
          symbol: v.symbol,
          side: v.side,
          leverage: v.leverage,
          openType: v.openType,
          sizing,
          limitPrice: v.limitPrice!,
          takeProfitPercent: v.takeProfitPercent,
          stopLossPercent: v.stopLossPercent
        });
        reply.code(201).send({ mode: runtime.mode, pendingOrder });
      } catch (err) {
        reply.code(400).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
      }
      return;
    }

    const input: OpenPositionInput = {
      symbol: v.symbol,
      side: v.side,
      leverage: v.leverage,
      openType: v.openType,
      sizing,
      takeProfitPercent: v.takeProfitPercent,
      stopLossPercent: v.stopLossPercent
    };
    try {
      const position = await runtime.positions.open(input);
      reply.code(201).send({ mode: runtime.mode, position });
    } catch (err) {
      reply.code(400).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get("/futures/orders", async (req, reply) => {
    const resolved = resolveFuturesRuntime(deps, req);
    if (resolved === null) {
      reply.send({ mode: futuresModeOf(), orders: [] });
      return;
    }
    if ("error" in resolved) {
      reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
      return;
    }
    reply.send({ mode: resolved.mode, orders: resolved.pendingOrders.listPending() });
  });

  app.get<{ Querystring: { limit?: string } }>("/futures/orders/history", async (req, reply) => {
    const resolved = resolveFuturesRuntime(deps, req);
    if (resolved === null) {
      reply.send({ mode: futuresModeOf(), orders: [] });
      return;
    }
    if ("error" in resolved) {
      reply.code(400).send({ mode: req.userRow?.futures_trading_mode ?? futuresModeOf(), error: resolved.error });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    reply.send({ mode: resolved.mode, orders: resolved.pendingOrders.listHistory(limit) });
  });

  app.post<{ Params: { id: string } }>("/futures/orders/:id/cancel", async (req, reply) => {
    const runtime = getFuturesRuntimeOrReply(deps, req, reply);
    if (!runtime) return;
    try {
      const order = await runtime.pendingOrders.cancelPending(req.params.id);
      reply.send({ mode: runtime.mode, order });
    } catch (err) {
      reply.code(400).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/futures/positions/:id/close", async (req, reply) => {
    const runtime = getFuturesRuntimeOrReply(deps, req, reply);
    if (!runtime) return;
    try {
      const position = await runtime.positions.close(req.params.id);
      reply.send({ mode: runtime.mode, position });
    } catch (err) {
      reply.code(400).send({ mode: runtime.mode, error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post("/killswitch", async (_req, reply) => {
    await deps.safety.engageKillSwitch();
    reply.send({ mode: modeOf(), ok: true });
  });

  app.get<{ Querystring: { status?: string } }>("/copy-signals", async (req, reply) => {
    if (!deps.copySignals) {
      reply.send({ mode: modeOf(), signals: [] });
      return;
    }
    const status = req.query.status as any;
    reply.send({ mode: modeOf(), signals: await deps.copySignals.listWithPriceCheck(status) });
  });

  app.get<{ Params: { id: string } }>("/copy-signals/:id/image", async (req, reply) => {
    if (!deps.copySignals) {
      reply.code(404).send({ mode: modeOf(), error: "copy trading not configured" });
      return;
    }
    const signal = deps.copySignals.get(req.params.id);
    if (!signal?.image_path) {
      reply.code(404).send({ mode: modeOf(), error: "signal or image not found" });
      return;
    }
    try {
      const buffer = await readFile(signal.image_path);
      reply.type("image/png").send(buffer);
    } catch {
      reply.code(404).send({ mode: modeOf(), error: "image file missing" });
    }
  });

  app.post<{ Params: { id: string } }>("/copy-signals/:id/approve", async (req, reply) => {
    if (!deps.copySignals) {
      reply.code(400).send({ mode: modeOf(), error: "copy trading not configured" });
      return;
    }
    try {
      const signal = await deps.copySignals.approve(req.params.id);
      reply.send({ mode: modeOf(), signal });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/copy-signals/:id/reject", async (req, reply) => {
    if (!deps.copySignals) {
      reply.code(400).send({ mode: modeOf(), error: "copy trading not configured" });
      return;
    }
    try {
      const signal = deps.copySignals.reject(req.params.id);
      reply.send({ mode: modeOf(), signal });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  const credentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8, "password must be at least 8 characters")
  });

  app.post("/auth/register", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
      return;
    }
    try {
      const user = registerUser(deps.db, parsed.data.email, parsed.data.password);
      reply.code(201).send({ user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        reply.code(409).send({ error: err.message });
        return;
      }
      reply.code(500).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
      return;
    }
    try {
      const user = authenticateUser(deps.db, parsed.data.email, parsed.data.password);
      reply.send({ user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        reply.code(401).send({ error: err.message });
        return;
      }
      reply.code(500).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get("/me", async (req, reply) => {
    if (!req.userRow) {
      reply.code(404).send({ error: "not a per-user session (using legacy/admin token)" });
      return;
    }
    reply.send({ user: toPublicUser(req.userRow) });
  });

  const exchangeKeysSchema = z.object({
    mexcApiKey: z.string().nullable().optional(),
    mexcApiSecret: z.string().nullable().optional(),
    mexcFuturesAccessKey: z.string().nullable().optional(),
    mexcFuturesSecretKey: z.string().nullable().optional()
  });

  app.put("/me/exchange-keys", async (req, reply) => {
    if (!req.userRow) {
      reply.code(404).send({ error: "not a per-user session (using legacy/admin token)" });
      return;
    }
    const parsed = exchangeKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
      return;
    }
    const user = updateExchangeKeys(deps.db, req.userRow.id, parsed.data);
    reply.send({ user: toPublicUser(user) });
  });

  const tradingModeSchema = z.object({
    tradingMode: z.enum(["paper", "live"]).optional(),
    futuresTradingMode: z.enum(["paper", "live"]).optional()
  });

  app.put("/me/trading-mode", async (req, reply) => {
    if (!req.userRow) {
      reply.code(404).send({ error: "not a per-user session (using legacy/admin token)" });
      return;
    }
    const parsed = tradingModeSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
      return;
    }
    if (
      parsed.data.futuresTradingMode === "live" &&
      (!req.userRow.mexc_futures_access_key_encrypted || !req.userRow.mexc_futures_secret_key_encrypted)
    ) {
      reply.code(400).send({ error: "Save your MEXC futures API keys via PUT /me/exchange-keys before switching to live trading" });
      return;
    }
    const user = updateTradingMode(deps.db, req.userRow.id, parsed.data);
    reply.send({ user: toPublicUser(user) });
  });

  return app;
}

export async function startServer(deps: ApiServerDeps): Promise<FastifyInstance> {
  const app = buildServer(deps);
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST, mode: modeOf() }, "control API listening");
  return app;
}
