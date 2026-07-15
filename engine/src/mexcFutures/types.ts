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
