import { describe, it, expect } from "vitest";
import { botConfigSchema } from "../src/config/botConfigSchema.js";

function baseScalpConfig(overrides: Record<string, unknown> = {}) {
  return {
    type: "futures_scalp",
    symbol: "BTC_USDT",
    leverage: 10,
    riskUsdAmount: 5,
    ...overrides
  };
}

describe("futuresScalpConfigSchema", () => {
  it("parses a valid config and applies defaults", () => {
    const parsed = botConfigSchema.parse(baseScalpConfig());
    expect(parsed.type).toBe("futures_scalp");
    if (parsed.type !== "futures_scalp") throw new Error("expected futures_scalp");
    expect(parsed.marginMode).toBe("isolated");
    expect(parsed.interval).toBe("Min1");
    expect(parsed.confidenceThreshold).toBe(35);
    expect(parsed.exitOnSignalReversal).toBe(true);
    expect(parsed.confirmLive).toBe(false);
  });

  it("rejects a missing riskUsdAmount", () => {
    const { riskUsdAmount, ...rest } = baseScalpConfig();
    expect(() => botConfigSchema.parse(rest)).toThrow();
  });

  it("rejects a blank symbol", () => {
    expect(() => botConfigSchema.parse(baseScalpConfig({ symbol: "" }))).toThrow();
  });

  it("rejects leverage outside 1-125", () => {
    expect(() => botConfigSchema.parse(baseScalpConfig({ leverage: 0 }))).toThrow();
    expect(() => botConfigSchema.parse(baseScalpConfig({ leverage: 126 }))).toThrow();
  });

  it("rejects an interval outside Min1/Min5", () => {
    expect(() => botConfigSchema.parse(baseScalpConfig({ interval: "Min15" }))).toThrow();
  });

  it("accepts explicit overrides for the scalp-specific tuning fields", () => {
    const parsed = botConfigSchema.parse(
      baseScalpConfig({
        marginMode: "cross",
        interval: "Min5",
        confidenceThreshold: 50,
        atrStopMultiplier: 0.8,
        atrTakeProfitMultiplier: 2,
        exitOnSignalReversal: false,
        dailyLossLimitUsdt: 20,
        confirmLive: true
      })
    );
    if (parsed.type !== "futures_scalp") throw new Error("expected futures_scalp");
    expect(parsed.marginMode).toBe("cross");
    expect(parsed.interval).toBe("Min5");
    expect(parsed.confidenceThreshold).toBe(50);
    expect(parsed.atrStopMultiplier).toBe(0.8);
    expect(parsed.atrTakeProfitMultiplier).toBe(2);
    expect(parsed.exitOnSignalReversal).toBe(false);
    expect(parsed.dailyLossLimitUsdt).toBe(20);
    expect(parsed.confirmLive).toBe(true);
  });
});
