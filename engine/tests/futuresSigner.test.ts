import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signFuturesRequest, sortedQueryString } from "../src/mexcFutures/signer.js";

describe("MEXC futures signer", () => {
  it("signs accessKey + timestamp + paramsString with HMAC-SHA256, lowercase hex", () => {
    const accessKey = "ak123";
    const secretKey = "sk456";
    const timestamp = 1700000000000;
    const paramsString = "symbol=BTC_USDT&vol=1";

    const expected = createHmac("sha256", secretKey)
      .update(`${accessKey}${timestamp}${paramsString}`)
      .digest("hex")
      .toLowerCase();

    expect(signFuturesRequest(accessKey, secretKey, timestamp, paramsString)).toBe(expected);
  });

  it("produces different signatures for different secret keys", () => {
    const sig1 = signFuturesRequest("ak", "secret-a", 1700000000000, "symbol=BTC_USDT");
    const sig2 = signFuturesRequest("ak", "secret-b", 1700000000000, "symbol=BTC_USDT");
    expect(sig1).not.toBe(sig2);
  });
});

describe("sortedQueryString", () => {
  it("sorts keys alphabetically regardless of input order", () => {
    expect(sortedQueryString({ vol: 1, symbol: "BTC_USDT", leverage: 10 })).toBe("leverage=10&symbol=BTC_USDT&vol=1");
  });

  it("skips undefined values", () => {
    expect(sortedQueryString({ symbol: "BTC_USDT", orderId: undefined })).toBe("symbol=BTC_USDT");
  });
});
