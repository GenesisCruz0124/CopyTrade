import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { CopySignalService } from "../src/copySignals/copySignalService.js";
import type { FuturesTradingService, PlaceFuturesOrderInput } from "../src/mexcFutures/FuturesTradingService.js";
import type { FuturesExchangeClient } from "../src/mexcFutures/futuresExchangeClient.js";
import type { ExtractedSignal } from "../src/vision/signalExtractor.js";
import type { FuturesOrderResult, FuturesTicker } from "../src/mexcFutures/types.js";

function baseExtraction(overrides: Partial<ExtractedSignal> = {}): ExtractedSignal {
  return {
    symbol: "JTO_USDT",
    side: "long",
    leverage: 5,
    entryPrice: null,
    stopLoss: 0.5992,
    takeProfit: 1.2087,
    confidence: 0.75,
    notes: "",
    ...overrides
  };
}

describe("CopySignalService.approve", () => {
  let db: Database.Database;
  let placedOrders: PlaceFuturesOrderInput[];
  let service: CopySignalService;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    placedOrders = [];

    const fakeFuturesTrading = {
      placeOrder: async (input: PlaceFuturesOrderInput): Promise<FuturesOrderResult> => {
        placedOrders.push(input);
        return { orderId: "order-1", externalOid: "ext-1", symbol: input.symbol, state: "NEW" };
      }
    } as unknown as FuturesTradingService;

    const fakeFuturesClient = {
      ticker: async (symbol: string): Promise<FuturesTicker> => ({ symbol, lastPrice: 0.5995, fairPrice: 0.5995 })
    } as unknown as FuturesExchangeClient;

    service = new CopySignalService(db, fakeFuturesClient, fakeFuturesTrading, {
      botId: "copy-trading",
      budgetUsdt: 1000,
      riskPctPerTrade: 2,
      defaultLeverage: 3,
      marginMode: "isolated"
    });
  });

  it("places a MARKET order sized against the live price when no entry price was extracted (e.g. a 'MARKET LONG' signal)", async () => {
    const signal = service.createFromExtraction({
      channelMessageId: "msg-1",
      imagePath: "/tmp/img.png",
      extraction: baseExtraction({ entryPrice: null })
    });

    const result = await service.approve(signal.id);

    expect(result.status).toBe("EXECUTED");
    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].type).toBe("MARKET");
    expect(placedOrders[0].price).toBeUndefined();
    // marginUsdt = 1000 * 2% = 20, notional = 20 * 5 = 100, quantity = 100 / 0.5995
    expect(placedOrders[0].quantity).toBeCloseTo(100 / 0.5995, 6);
  });

  it("places a LIMIT order at the extracted entry price when one was given", async () => {
    const signal = service.createFromExtraction({
      channelMessageId: "msg-2",
      imagePath: "/tmp/img.png",
      extraction: baseExtraction({ entryPrice: 0.6 })
    });

    const result = await service.approve(signal.id);

    expect(result.status).toBe("EXECUTED");
    expect(placedOrders).toHaveLength(1);
    expect(placedOrders[0].type).toBe("LIMIT");
    expect(placedOrders[0].price).toBe(0.6);
    expect(placedOrders[0].quantity).toBeCloseTo(100 / 0.6, 6);
  });

  it("still fails a signal missing symbol or side, without touching the live price", async () => {
    const signal = service.createFromExtraction({
      channelMessageId: "msg-3",
      imagePath: "/tmp/img.png",
      extraction: baseExtraction({ symbol: null, entryPrice: null })
    });

    await expect(service.approve(signal.id)).rejects.toThrow(/missing symbol or side/);
    expect(placedOrders).toHaveLength(0);
    expect(service.get(signal.id)!.status).toBe("FAILED");
  });
});
