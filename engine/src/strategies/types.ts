export type GridMode = "arithmetic" | "geometric";

export interface GridConfig {
  symbol: string;
  lowerPrice: number;
  upperPrice: number;
  gridLevels: number; // 2-50
  totalBudgetUsdt: number;
  mode: GridMode;
}

export type DcaInterval = "hourly" | "daily" | "weekly" | "custom";

export interface DcaConfig {
  symbol: string;
  amountUsdt: number;
  interval: DcaInterval;
  cronExpression?: string; // required when interval === "custom"
  dipMultiplier?: number; // e.g. 2 => buy 2x when 24h change < -dipThresholdPct
  dipThresholdPct?: number; // e.g. 5 => trigger when 24h change < -5%
  takeProfitPct?: number; // sell accumulated position at this % gain
  orderStyle?: "market" | "limitAtAsk";
}

export interface GridLevelState {
  level: number;
  price: number;
  side: "BUY" | "SELL";
  status: "PENDING" | "OPEN" | "FILLED";
  clientOrderId?: string;
  orderId?: string;
}
