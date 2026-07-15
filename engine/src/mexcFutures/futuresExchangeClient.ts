import type { FuturesAsset, FuturesContractDetail, FuturesOrderResult, FuturesPlaceOrderParams, FuturesTicker } from "./types.js";

/**
 * Shared surface between the real MEXC futures REST client and the
 * simulated paper client, so FuturesTradingService, FuturesPositionManager,
 * and the futures strategies are agnostic to which one they're talking to —
 * the futures equivalent of exchange/ExchangeClient.ts.
 */
export interface FuturesExchangeClient {
  allContracts(): Promise<{ symbol: string; baseCoin: string; quoteCoin: string; maxLeverage: number }[]>;
  contractDetail(symbol: string): Promise<FuturesContractDetail>;
  ticker(symbol: string): Promise<FuturesTicker>;
  placeOrder(params: FuturesPlaceOrderParams): Promise<FuturesOrderResult>;
  assets(currency?: string): Promise<FuturesAsset>;
}
