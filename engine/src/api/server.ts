import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import { env, isLiveMode } from "../config/env.js";
import { logger } from "../logger.js";
import { BotManager } from "../botManager.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import type { ExchangeClient } from "../exchange/ExchangeClient.js";
import { botConfigSchema } from "../config/botConfigSchema.js";
import type { CopySignalService } from "../copySignals/copySignalService.js";
import type { FxRateService } from "../fx/fxRateService.js";
import type { FuturesDeps } from "../botManager.js";
import type { FuturesPositionManager, OpenPositionInput } from "../mexcFutures/futuresPositionManager.js";
import { z } from "zod";

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
    stopLossPercent: z.number().positive().optional()
  })
  .refine((v) => v.amountUsd != null || v.percentOfBalance != null, {
    message: "either amountUsd or percentOfBalance is required"
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

export function buildServer(deps: ApiServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.addHook("onRequest", async (req, reply) => {
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    if (token !== env.API_AUTH_TOKEN) {
      reply.code(401).send({ error: "unauthorized" });
    }
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

  app.get<{ Querystring: { since?: string } }>("/events", async (req, reply) => {
    const since = req.query.since ? Number(req.query.since) : 0;
    const events = deps.db
      .prepare(`SELECT * FROM events WHERE created_at > ? ORDER BY created_at ASC LIMIT 500`)
      .all(since);
    reply.send({ mode: modeOf(), events });
  });

  app.get("/futures/symbols", async (_req, reply) => {
    if (!deps.futures) {
      reply.code(400).send({ mode: modeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    try {
      const symbols = await deps.futures.futuresClient.allContracts();
      reply.send({ mode: modeOf(), symbols });
    } catch (err) {
      reply.code(502).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get("/futures/balance", async (_req, reply) => {
    if (!deps.futures) {
      reply.code(400).send({ mode: modeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    try {
      const asset = await deps.futures.futuresClient.assets("USDT");
      reply.send({ mode: modeOf(), balance: asset });
    } catch (err) {
      reply.code(502).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get<{ Params: { symbol: string } }>("/futures/price/:symbol", async (req, reply) => {
    if (!deps.futures) {
      reply.code(400).send({ mode: modeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    try {
      const ticker = await deps.futures.futuresClient.ticker(req.params.symbol);
      reply.send({ mode: modeOf(), symbol: ticker.symbol, price: ticker.fairPrice });
    } catch (err) {
      reply.code(502).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.get("/futures/positions", async (_req, reply) => {
    if (!deps.futuresPositions) {
      reply.send({ mode: modeOf(), positions: [] });
      return;
    }
    const positions = await deps.futuresPositions.listOpen();
    reply.send({ mode: modeOf(), positions });
  });

  app.get<{ Querystring: { limit?: string } }>("/futures/positions/history", async (req, reply) => {
    if (!deps.futuresPositions) {
      reply.send({ mode: modeOf(), positions: [] });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const positions = deps.futuresPositions.listClosed(limit);
    reply.send({ mode: modeOf(), positions });
  });

  app.post("/futures/positions", async (req, reply) => {
    if (!deps.futuresPositions) {
      reply.code(400).send({ mode: modeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    const parsed = openPositionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ mode: modeOf(), error: "invalid position request", details: parsed.error.flatten() });
      return;
    }
    if (isLiveMode() && !(req.body as { confirmLive?: boolean })?.confirmLive) {
      reply.code(400).send({ mode: modeOf(), error: "Live trading requires confirmLive: true" });
      return;
    }
    const v = parsed.data;
    const input: OpenPositionInput = {
      symbol: v.symbol,
      side: v.side,
      leverage: v.leverage,
      openType: v.openType,
      sizing: v.amountUsd != null ? { mode: "usd", usdAmount: v.amountUsd } : { mode: "percent", percent: v.percentOfBalance! },
      takeProfitPercent: v.takeProfitPercent,
      stopLossPercent: v.stopLossPercent
    };
    try {
      const position = await deps.futuresPositions.open(input);
      reply.code(201).send({ mode: modeOf(), position });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.post<{ Params: { id: string } }>("/futures/positions/:id/close", async (req, reply) => {
    if (!deps.futuresPositions) {
      reply.code(400).send({ mode: modeOf(), error: "futures trading is not configured on this engine" });
      return;
    }
    try {
      const position = await deps.futuresPositions.close(req.params.id);
      reply.send({ mode: modeOf(), position });
    } catch (err) {
      reply.code(400).send({ mode: modeOf(), error: String(err instanceof Error ? err.message : err) });
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
    reply.send({ mode: modeOf(), signals: deps.copySignals.list(status) });
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

  return app;
}

export async function startServer(deps: ApiServerDeps): Promise<FastifyInstance> {
  const app = buildServer(deps);
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST, mode: modeOf() }, "control API listening");
  return app;
}
