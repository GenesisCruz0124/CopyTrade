import { describe, it, expect } from "vitest";
import { MexcRestClient } from "../src/mexc/restClient.js";

function fakeFetchCapturingUrl(capturedUrls: string[]): typeof fetch {
  return (async (url: string) => {
    capturedUrls.push(url);
    return new Response("[]");
  }) as unknown as typeof fetch;
}

describe("MexcRestClient.klines interval mapping", () => {
  // MEXC's spot kline interval enum doesn't accept the conventional "1h" shorthand —
  // it 400s with "Invalid interval" (code -1121) unless you send "60m". Verified live
  // 2026-07-26 via the Market signals screen. Every other interval we offer (5m, 15m,
  // 4h, 1d) already matches MEXC's enum as-is.
  it("translates '1h' to MEXC's '60m' before sending the request", async () => {
    const capturedUrls: string[] = [];
    const client = new MexcRestClient({
      apiKey: "ak",
      apiSecret: "sk",
      fetchImpl: fakeFetchCapturingUrl(capturedUrls)
    });

    await client.klines("BTCUSDT", "1h", 100);

    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toContain("interval=60m");
    expect(capturedUrls[0]).not.toContain("interval=1h");
  });

  it("passes other intervals through unchanged", async () => {
    const capturedUrls: string[] = [];
    const client = new MexcRestClient({
      apiKey: "ak",
      apiSecret: "sk",
      fetchImpl: fakeFetchCapturingUrl(capturedUrls)
    });

    await client.klines("BTCUSDT", "15m", 100);

    expect(capturedUrls[0]).toContain("interval=15m");
  });
});
