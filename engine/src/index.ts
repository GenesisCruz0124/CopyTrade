import { env, isLiveMode } from "./config/env.js";
import { logger } from "./logger.js";
import { getDb } from "./db/index.js";
import { MexcRestClient } from "./mexc/restClient.js";
import { MexcWsClient } from "./mexc/wsClient.js";
import { LiveExchangeClient } from "./exchange/LiveExchangeClient.js";
import { PaperExchange } from "./paper/paperExchange.js";
import type { ExchangeClient } from "./exchange/ExchangeClient.js";
import { SafetyRails } from "./safety/safetyRails.js";
import { BotManager } from "./botManager.js";
import { startServer } from "./api/server.js";

async function main() {
  const db = getDb();
  const restClient = new MexcRestClient({ apiKey: env.MEXC_API_KEY, apiSecret: env.MEXC_API_SECRET });

  let exchange: ExchangeClient;
  if (isLiveMode()) {
    exchange = new LiveExchangeClient(restClient);
    logger.warn("TRADING_MODE=live — orders will be sent to MEXC for real");
  } else {
    exchange = new PaperExchange({
      seedBalances: { USDT: 1000 },
      exchangeInfoProvider: () => restClient.exchangeInfo(),
      klinesProvider: (symbol, interval, limit) => restClient.klines(symbol, interval, limit)
    });
    logger.info("running in paper mode — no real orders will be sent");
  }

  const safety = new SafetyRails({
    db,
    exchange,
    maxPriceDeviationPct: env.MAX_ORDER_PRICE_DEVIATION_PCT,
    defaultDailyLossLimitUsdt: env.DEFAULT_DAILY_LOSS_LIMIT_USDT
  });

  const ws = new MexcWsClient({ restClient: isLiveMode() ? restClient : undefined });
  if (exchange instanceof PaperExchange) {
    ws.onBookTicker((ticker) => exchange.updatePrice(ticker.symbol, (ticker.bidPrice + ticker.askPrice) / 2));
  }

  const botManager = new BotManager(db, exchange, safety, (symbol) => ws.subscribeSymbol(symbol));

  await ws.connect();

  const app = await startServer({ db, exchange, safety, botManager, startedAt: Date.now() });

  const shutdown = async () => {
    logger.info("shutting down");
    ws.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
