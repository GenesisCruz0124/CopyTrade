export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "UNKNOWN";

export interface SymbolFilter {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number; // min price increment
  stepSize: number; // min quantity increment
  minNotional: number; // min price*qty
  minQty: number;
  maxQty: number;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface ExchangeInfo {
  symbols: SymbolFilter[];
}

export interface TickerPrice {
  symbol: string;
  price: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface AccountBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface AccountInfo {
  balances: AccountBalance[];
}

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  clientOrderId: string;
}

export interface OrderResult {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  status: OrderStatus;
  side: OrderSide;
  type: OrderType;
  price: number;
  origQty: number;
  executedQty: number;
}

export interface TradeResult {
  symbol: string;
  id: string;
  orderId: string;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  side: OrderSide;
  time: number;
}

export interface BookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
}
