import { describe, it, expect } from "vitest";
import { normalizeFuturesSymbol } from "../src/mexcFutures/futuresSymbol.js";

describe("normalizeFuturesSymbol", () => {
  it("inserts the underscore before a USDT quote", () => {
    expect(normalizeFuturesSymbol("LINEAUSDT")).toBe("LINEA_USDT");
    expect(normalizeFuturesSymbol("BTCUSDT")).toBe("BTC_USDT");
  });

  it("leaves already-separated symbols unchanged (but uppercases)", () => {
    expect(normalizeFuturesSymbol("CROUS_USDT")).toBe("CROUS_USDT");
    expect(normalizeFuturesSymbol("btc_usdt")).toBe("BTC_USDT");
  });

  it("is idempotent", () => {
    expect(normalizeFuturesSymbol(normalizeFuturesSymbol("LINEAUSDT"))).toBe("LINEA_USDT");
  });

  it("handles USDC and USD quotes", () => {
    expect(normalizeFuturesSymbol("ETHUSDC")).toBe("ETH_USDC");
    expect(normalizeFuturesSymbol("BTCUSD")).toBe("BTC_USD");
  });

  it("trims and uppercases", () => {
    expect(normalizeFuturesSymbol("  linaUSDT ")).toBe("LINA_USDT");
  });

  it("leaves an unknown quote untouched rather than guessing", () => {
    expect(normalizeFuturesSymbol("FOOBAR")).toBe("FOOBAR");
  });

  it("does not crash on a bare quote or empty string", () => {
    expect(normalizeFuturesSymbol("USDT")).toBe("USDT");
    expect(normalizeFuturesSymbol("")).toBe("");
  });
});
