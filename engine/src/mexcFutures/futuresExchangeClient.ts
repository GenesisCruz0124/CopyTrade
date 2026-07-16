import type {
  FuturesAsset,
  FuturesContractDetail,
  FuturesKline,
  FuturesOrderResult,
  FuturesOrderStatus,
  FuturesPlaceOrderParams,
  FuturesTicker
} from "./types.js";

/**
 * Common interface implemented by both the live MEXC futures client and the
 * paper futures exchange, so position/order managers, strategies, and
 * copy-trading never know which one they're talking to — mirrors
 * ExchangeClient (engine/src/exchange/ExchangeClient.ts) for spot.
 */
export interface FuturesExchangeClient {
  contractDetail(symbol: string): Promise<FuturesContractDetail>;
  ticker(symbol: string): Promise<FuturesTicker>;
  klines(symbol: string, interval: string, limit?: number): Promise<FuturesKline[]>;
  allContracts(): Promise<{ symbol: string; baseCoin: string; quoteCoin: string; maxLeverage: number }[]>;
  assets(currency?: string): Promise<FuturesAsset>;
  placeOrder(params: FuturesPlaceOrderParams): Promise<FuturesOrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<FuturesOrderStatus>;
  openOrders(symbol: string): Promise<FuturesOrderStatus[]>;
}
