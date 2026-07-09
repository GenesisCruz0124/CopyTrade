import { z } from "zod";

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

export const botConfigSchema = z
  .discriminatedUnion("type", [gridConfigSchema, dcaConfigSchema])
  .superRefine((cfg, ctx) => {
    if (cfg.type === "dca" && cfg.interval === "custom" && !cfg.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cronExpression is required when interval is 'custom'",
        path: ["cronExpression"]
      });
    }
  });

export type BotConfigInput = z.infer<typeof botConfigSchema>;
