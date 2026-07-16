export type FuturesOpenType = "isolated" | "cross";

/** MEXC contract order side: 1=open long, 2=close short, 3=open short, 4=close long */
export type FuturesOrderSide = 1 | 2 | 3 | 4;

export interface FuturesContractDetail {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  contractSize: number;
  priceUnit: number; // tick size
  volUnit: number; // step size (in contracts)
  minVol: number;
  maxVol: number;
  minLeverage: number;
  maxLeverage: number;
  maintenanceMarginRate: number;
  takerFeeRate: number;
}

export interface FuturesTicker {
  symbol: string;
  lastPrice: number;
  fairPrice: number; // mark price, used for liquidation math
}

export interface FuturesKline {
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FuturesPlaceOrderParams {
  symbol: string;
  side: FuturesOrderSide;
  vol: number; // quantity in contracts
  leverage: number;
  openType: FuturesOpenType;
  price?: number; // omit for market orders
  type: "LIMIT" | "MARKET";
  externalOid: string; // client order id, for idempotency
}

export interface FuturesOrderResult {
  orderId: string;
  externalOid: string;
  symbol: string;
  state: string;
}

/**
 * MEXC contract order-state enum (from GET /private/order/get/{id} and
 * GET /private/order/list/open_orders/{symbol}). state=2 (uncompleted/pending)
 * was verified live; 1/3/4/5 are per MEXC's published contract API docs and
 * are consistent with the field naming/behavior observed for state=2.
 */
export type FuturesOrderState = 1 | 2 | 3 | 4 | 5; // 1=uninformed 2=uncompleted 3=completed 4=cancelled 5=invalid

export interface FuturesOrderStatus {
  orderId: string;
  symbol: string;
  externalOid: string;
  state: FuturesOrderState;
  side: FuturesOrderSide;
  openType: FuturesOpenType;
  orderType: "LIMIT" | "MARKET";
  leverage: number;
  price: number; // originally-submitted limit price
  vol: number; // requested quantity, in contracts
  dealVol: number; // cumulative filled quantity so far
  dealAvgPrice: number; // average fill price (0 until any fill occurs)
  takerFeeRate: number;
  makerFeeRate: number;
  createTime: number;
  updateTime: number;
}

export interface FuturesPosition {
  symbol: string;
  positionId: string;
  holdVol: number; // contracts held
  openAvgPrice: number;
  leverage: number;
  openType: FuturesOpenType;
  liquidatePrice: number;
  positionType: 1 | 2; // 1=long, 2=short
}

export interface FuturesAsset {
  currency: string;
  availableBalance: number;
  positionMargin: number;
  equity: number;
}
