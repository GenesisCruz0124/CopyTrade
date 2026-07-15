import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  MEXC_API_KEY: z.string().default(""),
  MEXC_API_SECRET: z.string().default(""),
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  API_AUTH_TOKEN: z.string().min(8, "API_AUTH_TOKEN must be set to a long random string"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DB_PATH: z.string().default("./data/copytrade.db"),
  MAX_ORDER_PRICE_DEVIATION_PCT: z.coerce.number().positive().default(5),
  DEFAULT_DAILY_LOSS_LIMIT_USDT: z.coerce.number().positive().default(50),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // --- MEXC Futures (contract.mexc.com) — separate key pair from Spot ---
  MEXC_FUTURES_ACCESS_KEY: z.string().default(""),
  MEXC_FUTURES_SECRET_KEY: z.string().default(""),
  MAX_FUTURES_LEVERAGE: z.coerce.number().positive().default(20),
  MIN_LIQUIDATION_DISTANCE_PCT: z.coerce.number().positive().default(15),

  // --- Discord signal channel + Claude vision extraction ---
  DISCORD_BOT_TOKEN: z.string().default(""),
  DISCORD_SIGNAL_CHANNEL_ID: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  SIGNAL_IMAGE_DIR: z.string().default("./data/copy-signal-images"),

  // --- Copy-trading position sizing ---
  COPY_TRADING_BUDGET_USDT: z.coerce.number().positive().default(100),
  COPY_TRADING_RISK_PCT_PER_TRADE: z.coerce.number().positive().default(2),
  COPY_TRADING_DEFAULT_LEVERAGE: z.coerce.number().positive().default(3),
  COPY_TRADING_MARGIN_MODE: z.enum(["isolated", "cross"]).default("isolated")
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isLiveMode = () => env.TRADING_MODE === "live";
export const isFuturesConfigured = () => !!env.MEXC_FUTURES_ACCESS_KEY && !!env.MEXC_FUTURES_SECRET_KEY;
export const isCopyTradingConfigured = () =>
  isFuturesConfigured() && !!env.DISCORD_BOT_TOKEN && !!env.DISCORD_SIGNAL_CHANNEL_ID && !!env.ANTHROPIC_API_KEY;
