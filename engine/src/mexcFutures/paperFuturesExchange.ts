import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FuturesRestClient } from "./futuresRestClient.js";
import type { FuturesExchangeClient } from "./futuresExchangeClient.js";
import type {
  FuturesAsset,
  FuturesContractDetail,
  FuturesKline,
  FuturesOrderResult,
  FuturesOrderState,
  FuturesOrderStatus,
  FuturesPlaceOrderParams,
  FuturesTicker
} from "./types.js";

interface PaperOrder {
  orderId: string;
  externalOid: string;
  symbol: string;
  side: FuturesPlaceOrderParams["side"];
  openType: FuturesPlaceOrderParams["openType"];
  leverage: number;
  price: number; // requested limit price
  vol: number;
  takerFeeRate: number;
  makerFeeRate: number;
  state: FuturesOrderState;
  dealVol: number;
  dealAvgPrice: number;
  createTime: number;
  updateTime: number;
}

export interface PaperFuturesExchangeOptions {
  /** Real MEXC futures client used only for public, unsigned market data
   *  (contractDetail/ticker/klines/allContracts) — safe to use even with
   *  empty API keys since those endpoints require no signing. */
  liveClient: FuturesRestClient;
  /** Dedicated (typically in-memory) db that FuturesPositionManager and
   *  FuturesPendingOrderManager are also constructed against in paper mode —
   *  assets() derives the simulated balance from the same futures_positions
   *  rows those classes already persist there, no separate ledger needed. */
  db: Database.Database;
  seedBalanceUsdt: number;
}

/**
 * Simulated futures exchange driven by real live MEXC prices. Mirrors
 * PaperExchange (engine/src/paper/paperExchange.ts) for spot: MARKET orders
 * fill instantly, LIMIT orders fill when the live price crosses them. No
 * real orders are ever sent to MEXC.
 */
export class PaperFuturesExchange implements FuturesExchangeClient {
  private readonly liveClient: FuturesRestClient;
  private readonly db: Database.Database;
  private readonly seedBalanceUsdt: number;
  private readonly pendingOrders = new Map<string, PaperOrder>();
  private readonly contractDetailCache = new Map<string, FuturesContractDetail>();

  constructor(opts: PaperFuturesExchangeOptions) {
    this.liveClient = opts.liveClient;
    this.db = opts.db;
    this.seedBalanceUsdt = opts.seedBalanceUsdt;
  }

  // --- Public market data: passthrough to the real client (unsigned, no keys needed) ---

  async contractDetail(symbol: string): Promise<FuturesContractDetail> {
    const cached = this.contractDetailCache.get(symbol);
    if (cached) return cached;
    const detail = await this.liveClient.contractDetail(symbol);
    this.contractDetailCache.set(symbol, detail);
    return detail;
  }

  ticker(symbol: string): Promise<FuturesTicker> {
    return this.liveClient.ticker(symbol);
  }

  klines(symbol: string, interval: string, limit?: number): Promise<FuturesKline[]> {
    return this.liveClient.klines(symbol, interval, limit);
  }

  allContracts(): Promise<{ symbol: string; baseCoin: string; quoteCoin: string; maxLeverage: number }[]> {
    return this.liveClient.allContracts();
  }

  // --- Simulated trading ---

  async placeOrder(params: FuturesPlaceOrderParams): Promise<FuturesOrderResult> {
    const orderId = `paper-${randomUUID()}`;
    if (params.type === "MARKET") {
      // Callers (FuturesPositionManager.open()/close()) already treat MARKET
      // fills as instant, using ticker.fairPrice directly, and never query
      // order status for MARKET orders — nothing further to simulate.
      return { orderId, externalOid: params.externalOid, symbol: params.symbol, state: "FILLED" };
    }

    const detail = await this.contractDetail(params.symbol);
    const now = Date.now();
    this.pendingOrders.set(orderId, {
      orderId,
      externalOid: params.externalOid,
      symbol: params.symbol,
      side: params.side,
      openType: params.openType,
      leverage: params.leverage,
      price: params.price!,
      vol: params.vol,
      takerFeeRate: detail.takerFeeRate,
      makerFeeRate: detail.takerFeeRate * 0.75, // no separate maker rate exposed by contractDetail; a reasonable simulated discount
      state: 2,
      dealVol: 0,
      dealAvgPrice: 0,
      createTime: now,
      updateTime: now
    });
    return { orderId, externalOid: params.externalOid, symbol: params.symbol, state: "NEW" };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.pendingOrders.get(orderId);
    if (!order || order.state !== 2) return;
    order.state = 4;
    order.updateTime = Date.now();
  }

  async getOrder(orderId: string): Promise<FuturesOrderStatus> {
    const order = this.pendingOrders.get(orderId);
    if (!order) throw new Error(`paper order ${orderId} not found`);
    await this.checkFill(order);
    return toOrderStatus(order);
  }

  async openOrders(symbol: string): Promise<FuturesOrderStatus[]> {
    const symbolOrders = [...this.pendingOrders.values()].filter((o) => o.symbol === symbol);
    await Promise.all(symbolOrders.map((o) => this.checkFill(o)));
    return symbolOrders.filter((o) => o.state === 2).map(toOrderStatus);
  }

  /** Same cross-detection logic as PaperExchange.updatePrice() for spot: a buy
   *  (open long / side=1) fills when price falls to/below the limit; a sell
   *  (open short / side=3) fills when price rises to/above it. Computed lazily
   *  against the real live price and frozen on first detected cross so repeated
   *  polls return a stable fill. */
  private async checkFill(order: PaperOrder): Promise<void> {
    if (order.state !== 2) return;
    const ticker = await this.liveClient.ticker(order.symbol);
    const crossed = order.side === 1 ? ticker.fairPrice <= order.price : ticker.fairPrice >= order.price;
    if (!crossed) return;
    order.state = 3;
    order.dealVol = order.vol;
    order.dealAvgPrice = ticker.fairPrice;
    order.updateTime = Date.now();
  }

  async assets(currency = "USDT"): Promise<FuturesAsset> {
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'closed' THEN realized_pnl_usdt - COALESCE(open_fee_usdt, 0) - COALESCE(close_fee_usdt, 0) ELSE 0 END), 0) AS closedPnl,
           COALESCE(SUM(CASE WHEN status = 'open' THEN margin_usdt ELSE 0 END), 0) AS lockedMargin
         FROM futures_positions`
      )
      .get() as { closedPnl: number; lockedMargin: number };

    const availableBalance = this.seedBalanceUsdt + row.closedPnl - row.lockedMargin;
    return {
      currency,
      availableBalance,
      positionMargin: row.lockedMargin,
      equity: availableBalance + row.lockedMargin
    };
  }
}

function toOrderStatus(order: PaperOrder): FuturesOrderStatus {
  return {
    orderId: order.orderId,
    symbol: order.symbol,
    externalOid: order.externalOid,
    state: order.state,
    side: order.side,
    openType: order.openType,
    orderType: "LIMIT",
    leverage: order.leverage,
    price: order.price,
    vol: order.vol,
    dealVol: order.dealVol,
    dealAvgPrice: order.dealAvgPrice,
    takerFeeRate: order.takerFeeRate,
    makerFeeRate: order.makerFeeRate,
    createTime: order.createTime,
    updateTime: order.updateTime
  };
}
