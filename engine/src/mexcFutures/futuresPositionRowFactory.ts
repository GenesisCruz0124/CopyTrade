import type { FuturesPositionRow } from "./futuresPositionManager.js";

export interface BuildFuturesPositionRowInput {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  openType: "isolated" | "cross";
  entryPrice: number;
  quantity: number;
  contractSize: number;
  marginUsdt: number;
  takeProfitPercent?: number | null;
  stopLossPercent?: number | null;
  takerFeeRate: number;
  orderId: string | null;
  now: number;
}

/**
 * Computes TP/SL prices from percents against entryPrice, risk/fee amounts, and
 * assembles a futures_positions row. Shared by the instant-MARKET-fill path
 * (entryPrice = ticker.fairPrice, validated before order placement) and the
 * detected-LIMIT-fill path (entryPrice = the real fill price from getOrder).
 */
export function buildFuturesPositionRow(input: BuildFuturesPositionRowInput): FuturesPositionRow {
  if (input.takeProfitPercent != null && input.takeProfitPercent <= 0) {
    throw new Error("take-profit percent must be greater than 0");
  }
  if (input.stopLossPercent != null && (input.stopLossPercent <= 0 || input.stopLossPercent >= 100)) {
    throw new Error("stop-loss percent must be greater than 0 and less than 100");
  }

  const price = input.entryPrice;
  const takeProfitPrice =
    input.takeProfitPercent != null
      ? input.side === "long"
        ? price * (1 + input.takeProfitPercent / 100)
        : price * (1 - input.takeProfitPercent / 100)
      : null;
  const stopLossPrice =
    input.stopLossPercent != null
      ? input.side === "long"
        ? price * (1 - input.stopLossPercent / 100)
        : price * (1 + input.stopLossPercent / 100)
      : null;
  if (takeProfitPrice != null && takeProfitPrice <= 0) {
    throw new Error("take-profit percent is too large — would result in a non-positive price");
  }
  if (stopLossPrice != null && stopLossPrice <= 0) {
    throw new Error("stop-loss percent is too large — would result in a non-positive price");
  }
  if (
    takeProfitPrice != null &&
    stopLossPrice != null &&
    (input.side === "long"
      ? !(stopLossPrice < price && price < takeProfitPrice)
      : !(takeProfitPrice < price && price < stopLossPrice))
  ) {
    throw new Error("take-profit and stop-loss must be on the correct side of the current price");
  }

  const riskUsdt =
    input.stopLossPercent != null ? input.marginUsdt * input.leverage * (input.stopLossPercent / 100) : null;
  const openFeeUsdt = input.quantity * price * input.contractSize * input.takerFeeRate;

  return {
    id: input.id,
    symbol: input.symbol,
    side: input.side,
    leverage: input.leverage,
    open_type: input.openType,
    entry_price: price,
    quantity: input.quantity,
    contract_size: input.contractSize,
    margin_usdt: input.marginUsdt,
    take_profit_price: takeProfitPrice,
    stop_loss_price: stopLossPrice,
    risk_usdt: riskUsdt,
    taker_fee_rate: input.takerFeeRate,
    open_fee_usdt: openFeeUsdt,
    close_fee_usdt: null,
    status: "open",
    close_price: null,
    close_reason: null,
    realized_pnl_usdt: null,
    order_id: input.orderId,
    created_at: input.now,
    updated_at: input.now,
    closed_at: null
  };
}
