import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { env, isLiveMode, isFuturesConfigured, isCopyTradingConfigured } from "./config/env.js";
import { logger } from "./logger.js";
import { getDb } from "./db/index.js";
import { MexcRestClient } from "./mexc/restClient.js";
import { MexcWsClient } from "./mexc/wsClient.js";
import { RestPricePoller } from "./mexc/restPricePoller.js";
import { LiveExchangeClient } from "./exchange/LiveExchangeClient.js";
import { PaperExchange } from "./paper/paperExchange.js";
import type { ExchangeClient } from "./exchange/ExchangeClient.js";
import { SafetyRails } from "./safety/safetyRails.js";
import { BotManager, type FuturesDeps } from "./botManager.js";
import { startServer } from "./api/server.js";
import { FuturesRestClient } from "./mexcFutures/futuresRestClient.js";
import { FuturesTradingService } from "./mexcFutures/FuturesTradingService.js";
import { DiscordSignalListener } from "./discord/discordSignalListener.js";
import { SignalExtractor } from "./vision/signalExtractor.js";
import { CopySignalService } from "./copySignals/copySignalService.js";
import { FxRateService } from "./fx/fxRateService.js";

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
    defaultDailyLossLimitUsdt: env.DEFAULT_DAILY_LOSS_LIMIT_USDT,
    maxFuturesLeverage: env.MAX_FUTURES_LEVERAGE,
    minLiquidationDistancePct: env.MIN_LIQUIDATION_DISTANCE_PCT
  });

  const ws = new MexcWsClient({ restClient: isLiveMode() ? restClient : undefined });

  let pricePoller: RestPricePoller | undefined;
  if (exchange instanceof PaperExchange) {
    ws.onBookTicker((ticker) => exchange.updatePrice(ticker.symbol, (ticker.bidPrice + ticker.askPrice) / 2));

    // REST fallback: some MEXC WS market-data subscriptions get blocked for
    // datacenter/VPS IPs even though REST stays reachable. Without this, paper
    // bots on an affected host would never receive a price and silently never trade.
    pricePoller = new RestPricePoller({
      restClient,
      onPrice: (symbol, price) => exchange.updatePrice(symbol, price)
    });
    pricePoller.start();
  }

  let futures: FuturesDeps | undefined;
  if (isFuturesConfigured()) {
    const futuresClient = new FuturesRestClient({
      accessKey: env.MEXC_FUTURES_ACCESS_KEY,
      secretKey: env.MEXC_FUTURES_SECRET_KEY
    });
    const futuresTrading = new FuturesTradingService(futuresClient, safety);
    futures = { futuresClient, futuresTrading };
    logger.info("MEXC futures trading configured");
  } else {
    logger.info("MEXC_FUTURES_ACCESS_KEY/SECRET_KEY not set — futures bots disabled");
  }

  const botManager = new BotManager(
    db,
    exchange,
    safety,
    (symbol) => {
      ws.subscribeSymbol(symbol);
      pricePoller?.addSymbol(symbol);
    },
    futures
  );

  await ws.connect();

  // Neither paper nor live orders push fill notifications back to strategies yet,
  // so poll for fills on a short interval — this is what actually advances a grid
  // past its initial orders and lets DCA take-profit see its position.
  const reconcileTimer = setInterval(() => {
    botManager.reconcileAll().catch((err) => logger.error({ err }, "reconcileAll failed"));
  }, 5000);

  let copySignals: CopySignalService | undefined;
  let discordListener: DiscordSignalListener | undefined;
  if (isCopyTradingConfigured() && futures) {
    mkdirSync(env.SIGNAL_IMAGE_DIR, { recursive: true });
    copySignals = new CopySignalService(db, futures.futuresClient, futures.futuresTrading, {
      botId: "copy-trading",
      budgetUsdt: env.COPY_TRADING_BUDGET_USDT,
      riskPctPerTrade: env.COPY_TRADING_RISK_PCT_PER_TRADE,
      defaultLeverage: env.COPY_TRADING_DEFAULT_LEVERAGE,
      marginMode: env.COPY_TRADING_MARGIN_MODE
    });

    const extractor = new SignalExtractor({ apiKey: env.ANTHROPIC_API_KEY });
    discordListener = new DiscordSignalListener({
      botToken: env.DISCORD_BOT_TOKEN,
      channelId: env.DISCORD_SIGNAL_CHANNEL_ID,
      onImage: async (signal) => {
        const imagePath = join(env.SIGNAL_IMAGE_DIR, `${signal.channelMessageId}.png`);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(imagePath, signal.imageBuffer);

        const extraction = await extractor.extract(signal.imageBuffer, signal.contentType);
        copySignals!.createFromExtraction({ channelMessageId: signal.channelMessageId, imagePath, extraction });
      }
    });
    await discordListener.connect();
    logger.info("Discord copy-signal listener connected");
  } else {
    logger.info("copy trading not fully configured (needs futures + Discord + Anthropic) — copy-signal pipeline disabled");
  }

  const fxRates = new FxRateService();
  fxRates.start();

  const app = await startServer({ db, exchange, safety, botManager, startedAt: Date.now(), copySignals, fxRates });

  const shutdown = async () => {
    logger.info("shutting down");
    ws.close();
    pricePoller?.stop();
    clearInterval(reconcileTimer);
    fxRates.stop();
    discordListener?.close();
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
