import { z } from "zod";

const leverageSchema = z.number().int().min(1).max(125);
const marginModeSchema = z.enum(["isolated", "cross"]);

export const gridConfigSchema = z.object({
  type: z.literal("grid"),
  symbol: z.string().min(1),
  lowerPrice: z.number().positive(),
  upperPrice: z.number().positive(),
  gridLevels: z.number().int().min(2).max(50),
  totalBudgetUsdt: z.number().positive(),
  mode: z.enum(["arithmetic", "geometric"]),
  dailyLossLimitUsdt: z.number().positive().optional(),
  confirmLive: z.boolean().optional().default(false)
});

export const futuresGridConfigSchema = gridConfigSchema.extend({
  type: z.literal("futures_grid"),
  leverage: leverageSchema,
  marginMode: marginModeSchema.optional().default("isolated")
});

export const dcaConfigSchema = z.object({
  type: z.literal("dca"),
  symbol: z.string().min(1),
  amountUsdt: z.number().positive(),
  interval: z.enum(["hourly", "daily", "weekly", "custom"]),
  cronExpression: z.string().optional(),
  dipMultiplier: z.number().positive().optional(),
  dipThresholdPct: z.number().positive().optional(),
  takeProfitPct: z.number().positive().optional(),
  orderStyle: z.enum(["market", "limitAtAsk"]).optional().default("market"),
  dailyLossLimitUsdt: z.number().positive().optional(),
  confirmLive: z.boolean().optional().default(false)
});

export const futuresDcaConfigSchema = dcaConfigSchema.extend({
  type: z.literal("futures_dca"),
  leverage: leverageSchema,
  marginMode: marginModeSchema.optional().default("isolated")
});

// MEXC's futures kline interval enum (distinct from spot's "15m"/"1h" strings) — restricted to
// the two timeframes that actually make sense for scalping, not the full kline enum.
const scalpIntervalSchema = z.enum(["Min1", "Min5"]);

export const futuresScalpConfigSchema = z.object({
  type: z.literal("futures_scalp"),
  symbol: z.string().min(1),
  leverage: leverageSchema,
  marginMode: marginModeSchema.optional().default("isolated"),
  riskUsdAmount: z.number().positive(),
  interval: scalpIntervalSchema.optional().default("Min1"),
  // Stricter than analyzeSignal's app-wide 20% default — 1-minute candles are noisier than the
  // 15m-1h timeframes the rest of the app tunes for, so scalping needs a higher confidence bar.
  confidenceThreshold: z.number().min(0).max(100).optional().default(35),
  atrStopMultiplier: z.number().positive().optional(),
  atrTakeProfitMultiplier: z.number().positive().optional(),
  exitOnSignalReversal: z.boolean().optional().default(true),
  dailyLossLimitUsdt: z.number().positive().optional(),
  confirmLive: z.boolean().optional().default(false)
});

export const botConfigSchema = z
  .discriminatedUnion("type", [
    gridConfigSchema,
    dcaConfigSchema,
    futuresGridConfigSchema,
    futuresDcaConfigSchema,
    futuresScalpConfigSchema
  ])
  .superRefine((cfg, ctx) => {
    if ((cfg.type === "dca" || cfg.type === "futures_dca") && cfg.interval === "custom" && !cfg.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cronExpression is required when interval is 'custom'",
        path: ["cronExpression"]
      });
    }
  });

export type BotConfigInput = z.infer<typeof botConfigSchema>;
