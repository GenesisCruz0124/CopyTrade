import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { env, isLiveMode } from "../config/env.js";
import { logger } from "../logger.js";
import { BotManager } from "../botManager.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import type { ExchangeClient } from "../exchange/ExchangeClient.js";
import { botConfigSchema } from "../config/botConfigSchema.js";

export interface ApiServerDeps {
  db: Database.Database;
  exchange: ExchangeClient;
  safety: SafetyRails;
  botManager: BotManager;
  startedAt: number;
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
    reply.send({
      mode: modeOf(),
      uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
      balances: account.balances,
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

  app.get<{ Params: { id: string } }>("/bots/:id/pnl", async (req, reply) => {
    reply.send({ mode: modeOf(), series: deps.botManager.getPnlSeries(req.params.id) });
  });

  app.get<{ Querystring: { since?: string } }>("/events", async (req, reply) => {
    const since = req.query.since ? Number(req.query.since) : 0;
    const events = deps.db
      .prepare(`SELECT * FROM events WHERE created_at > ? ORDER BY created_at ASC LIMIT 500`)
      .all(since);
    reply.send({ mode: modeOf(), events });
  });

  app.post("/killswitch", async (_req, reply) => {
    await deps.safety.engageKillSwitch();
    reply.send({ mode: modeOf(), ok: true });
  });

  return app;
}

export async function startServer(deps: ApiServerDeps): Promise<FastifyInstance> {
  const app = buildServer(deps);
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST, mode: modeOf() }, "control API listening");
  return app;
}
