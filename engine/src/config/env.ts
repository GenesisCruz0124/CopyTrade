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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
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
