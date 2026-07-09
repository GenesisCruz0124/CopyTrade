import type {
  AccountInfo,
  ExchangeInfo,
  OrderResult,
  PlaceOrderParams,
  TickerPrice,
  TradeResult
} from "../mexc/types.js";

/**
 * Common interface implemented by both the live MEXC client and the paper
 * exchange, so strategies never know which one they're talking to.
 */
export interface ExchangeClient {
  readonly mode: "paper" | "live";
  getExchangeInfo(): Promise<ExchangeInfo>;
  getTickerPrice(symbol: string): Promise<TickerPrice>;
  getAccountInfo(): Promise<AccountInfo>;
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult>;
  queryOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult>;
  openOrders(symbol?: string): Promise<OrderResult[]>;
  myTrades(symbol: string): Promise<TradeResult[]>;
}
