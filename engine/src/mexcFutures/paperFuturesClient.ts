import { randomUUID } from "node:crypto";
import type { FuturesExchangeClient } from "./futuresExchangeClient.js";
import type { FuturesAsset, FuturesOrderResult, FuturesOrderSide, FuturesPlaceOrderParams } from "./types.js";

interface OpenLot {
  quantity: number;
  entryPrice: number;
  contractSize: number;
  marginReserved: number;
}

/** MEXC contract order side: 1=open long, 2=close short, 3=open short, 4=close long (see types.ts). */
function decodeSide(side: FuturesOrderSide): { positionType: "long" | "short"; isOpen: boolean } {
  switch (side) {
    case 1:
      return { positionType: "long", isOpen: true };
    case 2:
      return { positionType: "short", isOpen: false };
    case 3:
      return { positionType: "short", isOpen: true };
    case 4:
      return { positionType: "long", isOpen: false };
  }
}

/**
 * Simulated futures client: contract details/tickers/the symbol list are
 * delegated to the real REST client (public, unauthenticated market data —
 * same approach as paper/paperExchange.ts for spot), but every order fills
 * instantly against an in-memory USDT balance instead of touching MEXC.
 * Tracks open lots per (symbol, side) so closes compute real realized PnL
 * rather than just approximating a margin refund.
 */
export class PaperFuturesClient implements FuturesExchangeClient {
  private availableBalance: number;
  private readonly openLots = new Map<string, OpenLot[]>();

  constructor(
    private readonly marketData: Pick<FuturesExchangeClient, "allContracts" | "contractDetail" | "ticker">,
    seedBalanceUsdt: number
  ) {
    this.availableBalance = seedBalanceUsdt;
  }

  allContracts(): ReturnType<FuturesExchangeClient["allContracts"]> {
    return this.marketData.allContracts();
  }

  contractDetail(symbol: string): ReturnType<FuturesExchangeClient["contractDetail"]> {
    return this.marketData.contractDetail(symbol);
  }

  ticker(symbol: string): ReturnType<FuturesExchangeClient["ticker"]> {
    return this.marketData.ticker(symbol);
  }

  /** currency is accepted for interface parity but unused — only USDT-margined contracts exist in this app. */
  async assets(currency = "USDT"): Promise<FuturesAsset> {
    const positionMargin = [...this.openLots.values()]
      .flat()
      .reduce((sum, lot) => sum + lot.marginReserved, 0);
    return {
      currency: "USDT",
      availableBalance: this.availableBalance,
      positionMargin,
      equity: this.availableBalance + positionMargin
    };
  }

  async placeOrder(params: FuturesPlaceOrderParams): Promise<FuturesOrderResult> {
    const [detail, ticker] = await Promise.all([
      this.marketData.contractDetail(params.symbol),
      this.marketData.ticker(params.symbol)
    ]);
    const fillPrice = params.price ?? ticker.fairPrice;
    const { positionType, isOpen } = decodeSide(params.side);
    const key = `${params.symbol}:${positionType}`;

    if (isOpen) {
      const margin = (params.vol * detail.contractSize * fillPrice) / params.leverage;
      if (margin > this.availableBalance) {
        throw new Error(
          `insufficient paper balance: need ${margin.toFixed(2)} USDT margin, have ${this.availableBalance.toFixed(2)}`
        );
      }
      this.availableBalance -= margin;
      const lots = this.openLots.get(key) ?? [];
      lots.push({ quantity: params.vol, entryPrice: fillPrice, contractSize: detail.contractSize, marginReserved: margin });
      this.openLots.set(key, lots);
    } else {
      const lots = this.openLots.get(key) ?? [];
      let remaining = params.vol;
      let refund = 0;
      const direction = positionType === "long" ? 1 : -1;

      while (remaining > 1e-9 && lots.length > 0) {
        const lot = lots[0];
        const closedQty = Math.min(remaining, lot.quantity);
        const pnl = (fillPrice - lot.entryPrice) * closedQty * lot.contractSize * direction;
        const marginPortion = lot.marginReserved * (closedQty / lot.quantity);
        refund += marginPortion + pnl;
        lot.quantity -= closedQty;
        lot.marginReserved -= marginPortion;
        remaining -= closedQty;
        if (lot.quantity <= 1e-9) lots.shift();
      }
      if (lots.length === 0) this.openLots.delete(key);

      // No matching lot (e.g. the engine restarted and lost its in-memory ledger,
      // or the account is closing more than this paper session ever opened) —
      // fall back to refunding at the current notional/leverage as a best effort.
      if (remaining > 1e-9) {
        refund += (remaining * detail.contractSize * fillPrice) / params.leverage;
      }
      this.availableBalance += refund;
    }

    return {
      orderId: `paper-${randomUUID()}`,
      externalOid: params.externalOid,
      symbol: params.symbol,
      state: "FILLED"
    };
  }
}
