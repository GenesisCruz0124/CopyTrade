import { randomUUID } from "node:crypto";
import type { FuturesExchangeClient } from "./futuresExchangeClient.js";
import type { SafetyRails } from "../safety/safetyRails.js";
import type { FuturesOrderResult } from "./types.js";
import { floorToStep } from "../mexc/symbolFilters.js";

export interface PlaceFuturesOrderInput {
  botId: string;
  symbol: string;
  positionType: "long" | "short";
  action: "open" | "close";
  leverage: number;
  openType: "isolated" | "cross";
  quantity: number; // in contracts
  price?: number; // omit for market
  type: "LIMIT" | "MARKET";
}

/**
 * Wraps the raw futures REST client with contract-detail lookups, symbol
 * rounding, and a mandatory safety-rail check before every order — the
 * futures equivalent of exchange/LiveExchangeClient.ts + safety wiring.
 */
export class FuturesTradingService {
  constructor(
    private readonly futuresClient: FuturesExchangeClient,
    private readonly safety: SafetyRails
  ) {}

  async placeOrder(input: PlaceFuturesOrderInput): Promise<FuturesOrderResult> {
    const [detail, ticker] = await Promise.all([
      this.futuresClient.contractDetail(input.symbol),
      this.futuresClient.ticker(input.symbol)
    ]);

    const referencePrice = input.price ?? ticker.fairPrice;
    const roundedPrice = floorToStep(referencePrice, detail.priceUnit);
    const roundedQty = floorToStep(input.quantity, detail.volUnit || 1);

    if (roundedQty < detail.minVol) {
      throw new Error(`quantity ${roundedQty} below contract minVol ${detail.minVol}`);
    }
    if (roundedQty > detail.maxVol) {
      throw new Error(`quantity ${roundedQty} exceeds contract maxVol ${detail.maxVol}`);
    }
    if (input.leverage < detail.minLeverage || input.leverage > detail.maxLeverage) {
      throw new Error(`leverage ${input.leverage}x outside contract range ${detail.minLeverage}-${detail.maxLeverage}x`);
    }

    if (input.action === "open") {
      const check = await this.safety.checkOrder(input.botId, {
        symbol: input.symbol,
        side: input.positionType === "long" ? "BUY" : "SELL",
        price: roundedPrice,
        quantity: roundedQty,
        futures: {
          leverage: input.leverage,
          positionType: input.positionType,
          maintenanceMarginRate: detail.maintenanceMarginRate,
          marketPrice: ticker.fairPrice
        }
      });
      if (!check.allowed) {
        throw new Error(`Safety rail blocked futures order: ${check.reason}`);
      }
    }

    const side = this.toOrderSide(input.positionType, input.action);
    const externalOid = `fut-${input.botId}-${randomUUID().slice(0, 8)}`;

    return this.futuresClient.placeOrder({
      symbol: input.symbol,
      side,
      vol: roundedQty,
      leverage: input.leverage,
      openType: input.openType,
      price: input.type === "LIMIT" ? roundedPrice : undefined,
      type: input.type,
      externalOid
    });
  }

  private toOrderSide(positionType: "long" | "short", action: "open" | "close"): 1 | 2 | 3 | 4 {
    if (positionType === "long") return action === "open" ? 1 : 4;
    return action === "open" ? 3 : 2;
  }
}
