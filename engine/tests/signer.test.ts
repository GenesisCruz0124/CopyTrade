import { describe, it, expect } from "vitest";
import { signQueryString, toQueryString, buildSignedQuery } from "../src/mexc/signer.js";
import { createHmac } from "node:crypto";

describe("MEXC signer", () => {
  it("produces a deterministic hex HMAC-SHA256 signature over a query string", () => {
    const qs = "symbol=BTCUSDT&side=BUY&timestamp=1700000000000";
    const secret = "test-secret";
    const expected = createHmac("sha256", secret).update(qs).digest("hex");
    expect(signQueryString(qs, secret)).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    const qs = "symbol=BTCUSDT";
    expect(signQueryString(qs, "secret-a")).not.toBe(signQueryString(qs, "secret-b"));
  });

  it("builds a query string preserving key order and skipping undefined values", () => {
    const qs = toQueryString({ symbol: "BTCUSDT", orderId: undefined, side: "BUY" });
    expect(qs).toBe("symbol=BTCUSDT&side=BUY");
  });

  it("appends timestamp and a valid signature to the signed query", () => {
    const secret = "abc123";
    const signed = buildSignedQuery({ symbol: "BTCUSDT" }, secret, 1700000000000);
    expect(signed).toMatch(/^symbol=BTCUSDT&timestamp=1700000000000&signature=[0-9a-f]{64}$/);

    const [qsPart] = signed.split("&signature=");
    const signaturePart = signed.split("&signature=")[1];
    expect(signQueryString(qsPart, secret)).toBe(signaturePart);
  });
});
