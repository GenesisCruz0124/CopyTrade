import { describe, it, expect } from "vitest";
import { PaperExchange } from "../src/paper/paperExchange.js";
import type { ExchangeInfo } from "../src/mexc/types.js";

const exchangeInfo: ExchangeInfo = {
  symbols: [
    {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tickSize: 0.01,
      stepSize: 0.0001,
      minNotional: 5,
      minQty: 0.0001,
      maxQty: 1000,
      pricePrecision: 2,
      quantityPrecision: 4
    }
  ]
};

function makeExchange(seed: Record<string, number> = { USDT: 10000, BTC: 1 }) {
  return new PaperExchange({
    seedBalances: seed,
    exchangeInfoProvider: async () => exchangeInfo,
    slippageBps: 10
  });
}

describe("PaperExchange", () => {
  it("does not fill a limit BUY order until price crosses it", async () => {
    const exchange = makeExchange();
    exchange.updatePrice("BTCUSDT", 50000);
    const order = await exchange.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: 49000,
      quantity: 0.01,
      clientOrderId: "c1"
    });
    expect(order.status).toBe("NEW");

    exchange.updatePrice("BTCUSDT", 49500);
    const stillOpen = await exchange.queryOrder("BTCUSDT", order.orderId);
    expect(stillOpen.status).toBe("NEW");

    exchange.updatePrice("BTCUSDT", 48900);
    const filled = await exchange.queryOrder("BTCUSDT", order.orderId);
    expect(filled.status).toBe("FILLED");
  });

  it("fills a limit SELL order once price rises to meet it", async () => {
    const exchange = makeExchange();
    exchange.updatePrice("BTCUSDT", 50000);
    const order = await exchange.placeOrder({
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: 51000,
      quantity: 0.01,
      clientOrderId: "c2"
    });
    exchange.updatePrice("BTCUSDT", 51500);
    const filled = await exchange.queryOrder("BTCUSDT", order.orderId);
    expect(filled.status).toBe("FILLED");
  });

  it("fills MARKET orders immediately with slippage applied", async () => {
    const exchange = makeExchange();
    exchange.updatePrice("BTCUSDT", 50000);
    const order = await exchange.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.01,
      clientOrderId: "c3"
    });
    expect(order.status).toBe("FILLED");
    expect(order.price).toBeCloseTo(50000 * 1.001, 1);
  });

  it("moves balances from free to locked, then to the counter asset, on a BUY fill", async () => {
    const exchange = makeExchange({ USDT: 10000, BTC: 0 });
    exchange.updatePrice("BTCUSDT", 50000);
    await exchange.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: 49000,
      quantity: 0.01,
      clientOrderId: "c4"
    });
    exchange.updatePrice("BTCUSDT", 48000);

    const account = await exchange.getAccountInfo();
    const usdt = account.balances.find((b) => b.asset === "USDT")!;
    const btc = account.balances.find((b) => b.asset === "BTC")!;
    expect(usdt.locked).toBeCloseTo(0);
    expect(usdt.free).toBeCloseTo(10000 - 49000 * 0.01);
    expect(btc.free).toBeCloseTo(0.01);
  });

  it("rejects a BUY order when balance is insufficient", async () => {
    const exchange = makeExchange({ USDT: 1, BTC: 0 });
    exchange.updatePrice("BTCUSDT", 50000);
    await expect(
      exchange.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: 49000, quantity: 1, clientOrderId: "c5" })
    ).rejects.toThrow(/Insufficient balance/);
  });

  it("releases locked funds when a limit order is cancelled", async () => {
    const exchange = makeExchange({ USDT: 10000, BTC: 0 });
    exchange.updatePrice("BTCUSDT", 50000);
    const order = await exchange.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: 49000,
      quantity: 0.01,
      clientOrderId: "c6"
    });
    await exchange.cancelOrder("BTCUSDT", order.orderId);
    const account = await exchange.getAccountInfo();
    const usdt = account.balances.find((b) => b.asset === "USDT")!;
    expect(usdt.locked).toBeCloseTo(0);
    expect(usdt.free).toBeCloseTo(10000);
  });
});
