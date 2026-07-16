import { describe, it, expect } from "vitest";
import { FuturesRestClient } from "../src/mexcFutures/futuresRestClient.js";

function fakeFetch(responseBody: string, status = 200): typeof fetch {
  return (async () => new Response(responseBody, { status })) as unknown as typeof fetch;
}

describe("FuturesRestClient big-integer order ID handling", () => {
  // MEXC order IDs are 18-19 digit integers, beyond Number.MAX_SAFE_INTEGER
  // (2^53-1 = 9007199254740991). A naive response.json() silently rounds
  // them, corrupting the ID — verified live 2026-07-16 when a corrupted ID
  // couldn't be found by a later getOrder() lookup.
  const bigOrderId = "832535434919189038";

  it("placeOrder preserves the full-precision order ID from a bare-number response", async () => {
    const client = new FuturesRestClient({
      accessKey: "ak",
      secretKey: "sk",
      fetchImpl: fakeFetch(`{"success":true,"code":0,"data":${bigOrderId}}`)
    });

    const result = await client.placeOrder({
      symbol: "DOGE_USDT",
      side: 1,
      vol: 2,
      leverage: 1,
      openType: "isolated",
      type: "LIMIT",
      price: 0.0741,
      externalOid: "test-oid"
    });

    expect(result.orderId).toBe(bigOrderId);
    // sanity: confirms the digits weren't silently altered (no trailing-zero rounding,
    // which is what float precision loss would produce for this specific value)
    expect(result.orderId.endsWith("038")).toBe(true);
  });

  it("getOrder preserves the full-precision order ID field from the response body", async () => {
    const client = new FuturesRestClient({
      accessKey: "ak",
      secretKey: "sk",
      fetchImpl: fakeFetch(
        `{"success":true,"code":0,"data":{"orderId":${bigOrderId},"symbol":"DOGE_USDT","externalOid":"test-oid","state":2,"side":1,"openType":1,"orderType":1,"leverage":1,"price":0.0741,"vol":2,"dealVol":0,"dealAvgPrice":0,"takerFeeRate":0.0008,"makerFeeRate":0.0006,"createTime":1700000000000,"updateTime":1700000000000}}`
      )
    });

    const status = await client.getOrder(bigOrderId);
    expect(status.orderId).toBe(bigOrderId);
  });
});
