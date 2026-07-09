import type { ExchangeClient } from "./ExchangeClient.js";
import type { MexcRestClient } from "../mexc/restClient.js";
import type {
  AccountInfo,
  ExchangeInfo,
  OrderResult,
  PlaceOrderParams,
  TickerPrice,
  TradeResult
} from "../mexc/types.js";

/** Thin adapter so the live MEXC REST client satisfies the shared ExchangeClient interface. */
export class LiveExchangeClient implements ExchangeClient {
  readonly mode = "live" as const;

  constructor(private readonly rest: MexcRestClient) {}

  getExchangeInfo(): Promise<ExchangeInfo> {
    return this.rest.exchangeInfo();
  }

  getTickerPrice(symbol: string): Promise<TickerPrice> {
    return this.rest.tickerPrice(symbol);
  }

  getAccountInfo(): Promise<AccountInfo> {
    return this.rest.accountInfo();
  }

  placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    return this.rest.placeOrder(params);
  }

  cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    return this.rest.cancelOrder(symbol, orderId, clientOrderId);
  }

  queryOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    return this.rest.queryOrder(symbol, orderId, clientOrderId);
  }

  openOrders(symbol?: string): Promise<OrderResult[]> {
    return this.rest.openOrders(symbol);
  }

  myTrades(symbol: string): Promise<TradeResult[]> {
    return this.rest.myTrades(symbol);
  }
}
