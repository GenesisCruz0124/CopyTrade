import { randomUUID } from "node:crypto";
import type { ExchangeClient } from "../exchange/ExchangeClient.js";
import type {
  AccountBalance,
  AccountInfo,
  ExchangeInfo,
  OrderResult,
  OrderStatus,
  PlaceOrderParams,
  TickerPrice,
  TradeResult
} from "../mexc/types.js";
import { validateAndRoundOrder } from "../mexc/symbolFilters.js";

interface PaperOrder {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  price: number;
  origQty: number;
  executedQty: number;
  status: OrderStatus;
  createdAt: number;
}

export interface PaperExchangeOptions {
  seedBalances: Record<string, number>;
  exchangeInfoProvider: () => Promise<ExchangeInfo>;
  slippageBps?: number;
}

/**
 * Simulated exchange driven by live WS prices. Limit orders fill when the
 * market price crosses them; market orders fill immediately at the current
 * price plus configurable slippage. Implements the same interface as the
 * live MEXC client so strategies are exchange-agnostic.
 */
export class PaperExchange implements ExchangeClient {
  readonly mode = "paper" as const;

  private balances = new Map<string, AccountBalance>();
  private orders = new Map<string, PaperOrder>();
  private trades: TradeResult[] = [];
  private lastPrices = new Map<string, number>();
  private readonly slippageBps: number;
  private readonly exchangeInfoProvider: () => Promise<ExchangeInfo>;
  private exchangeInfoCache: ExchangeInfo | null = null;

  constructor(opts: PaperExchangeOptions) {
    this.slippageBps = opts.slippageBps ?? 5;
    this.exchangeInfoProvider = opts.exchangeInfoProvider;
    for (const [asset, amount] of Object.entries(opts.seedBalances)) {
      this.balances.set(asset, { asset, free: amount, locked: 0 });
    }
  }

  /** Feed live price ticks in; triggers fills for crossed limit orders. */
  updatePrice(symbol: string, price: number): void {
    this.lastPrices.set(symbol, price);
    for (const order of this.orders.values()) {
      if (order.symbol !== symbol) continue;
      if (order.status !== "NEW" && order.status !== "PARTIALLY_FILLED") continue;
      if (order.type !== "LIMIT") continue;

      const crossed = order.side === "BUY" ? price <= order.price : price >= order.price;
      if (crossed) this.fillOrder(order, order.price);
    }
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    if (!this.exchangeInfoCache) this.exchangeInfoCache = await this.exchangeInfoProvider();
    return this.exchangeInfoCache;
  }

  async getTickerPrice(symbol: string): Promise<TickerPrice> {
    const price = this.lastPrices.get(symbol);
    if (price === undefined) throw new Error(`No price known yet for ${symbol}`);
    return { symbol, price };
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return { balances: [...this.balances.values()] };
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const info = await this.getExchangeInfo();
    const filter = info.symbols.find((s) => s.symbol === params.symbol);
    if (!filter) throw new Error(`Unknown symbol ${params.symbol}`);

    const referencePrice = params.price ?? this.lastPrices.get(params.symbol);
    if (referencePrice === undefined) throw new Error(`No price known yet for ${params.symbol}`);

    const validated = validateAndRoundOrder(referencePrice, params.quantity, filter);
    if (!validated.ok) throw new Error(`Order rejected: ${validated.reason}`);

    const [baseAsset, quoteAsset] = [filter.baseAsset, filter.quoteAsset];
    const notional = validated.price * validated.quantity;

    if (params.side === "BUY") {
      const quote = this.getOrCreateBalance(quoteAsset);
      if (quote.free < notional) throw new Error("Insufficient balance for BUY order");
      quote.free -= notional;
      quote.locked += notional;
    } else {
      const base = this.getOrCreateBalance(baseAsset);
      if (base.free < validated.quantity) throw new Error("Insufficient balance for SELL order");
      base.free -= validated.quantity;
      base.locked += validated.quantity;
    }

    const order: PaperOrder = {
      symbol: params.symbol,
      orderId: randomUUID(),
      clientOrderId: params.clientOrderId,
      side: params.side,
      type: params.type,
      price: validated.price,
      origQty: validated.quantity,
      executedQty: 0,
      status: "NEW",
      createdAt: Date.now()
    };
    this.orders.set(order.orderId, order);

    if (params.type === "MARKET") {
      const marketPrice = this.lastPrices.get(params.symbol)!;
      const slipped =
        params.side === "BUY"
          ? marketPrice * (1 + this.slippageBps / 10_000)
          : marketPrice * (1 - this.slippageBps / 10_000);
      this.fillOrder(order, slipped);
    }

    return this.toOrderResult(order);
  }

  async cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    const order = this.findOrder(orderId, clientOrderId);
    if (!order) throw new Error("Order not found");
    if (order.status === "NEW" || order.status === "PARTIALLY_FILLED") {
      this.releaseRemainingLock(order);
      order.status = "CANCELED";
    }
    return this.toOrderResult(order);
  }

  async queryOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    const order = this.findOrder(orderId, clientOrderId);
    if (!order) throw new Error("Order not found");
    return this.toOrderResult(order);
  }

  async openOrders(symbol?: string): Promise<OrderResult[]> {
    return [...this.orders.values()]
      .filter((o) => (o.status === "NEW" || o.status === "PARTIALLY_FILLED") && (!symbol || o.symbol === symbol))
      .map((o) => this.toOrderResult(o));
  }

  async myTrades(symbol: string): Promise<TradeResult[]> {
    return this.trades.filter((t) => t.symbol === symbol);
  }

  private fillOrder(order: PaperOrder, fillPrice: number): void {
    const remainingQty = order.origQty - order.executedQty;
    const info = this.exchangeInfoCache;
    const filter = info?.symbols.find((s) => s.symbol === order.symbol);
    const quoteQty = fillPrice * remainingQty;

    if (order.side === "BUY") {
      const quote = this.getOrCreateBalance(filter?.quoteAsset ?? "USDT");
      quote.locked -= order.price * remainingQty;
      const base = this.getOrCreateBalance(filter?.baseAsset ?? order.symbol.replace("USDT", ""));
      base.free += remainingQty;
    } else {
      const base = this.getOrCreateBalance(filter?.baseAsset ?? order.symbol.replace("USDT", ""));
      base.locked -= remainingQty;
      const quote = this.getOrCreateBalance(filter?.quoteAsset ?? "USDT");
      quote.free += quoteQty;
    }

    order.executedQty = order.origQty;
    order.status = "FILLED";
    if (order.type === "MARKET") order.price = fillPrice;

    this.trades.push({
      symbol: order.symbol,
      id: randomUUID(),
      orderId: order.orderId,
      price: fillPrice,
      qty: remainingQty,
      quoteQty,
      commission: 0,
      commissionAsset: filter?.quoteAsset ?? "USDT",
      side: order.side,
      time: Date.now()
    });
  }

  private releaseRemainingLock(order: PaperOrder): void {
    const info = this.exchangeInfoCache;
    const filter = info?.symbols.find((s) => s.symbol === order.symbol);
    const remainingQty = order.origQty - order.executedQty;
    if (order.side === "BUY") {
      const quote = this.getOrCreateBalance(filter?.quoteAsset ?? "USDT");
      quote.locked -= order.price * remainingQty;
      quote.free += order.price * remainingQty;
    } else {
      const base = this.getOrCreateBalance(filter?.baseAsset ?? order.symbol.replace("USDT", ""));
      base.locked -= remainingQty;
      base.free += remainingQty;
    }
  }

  private getOrCreateBalance(asset: string): AccountBalance {
    let bal = this.balances.get(asset);
    if (!bal) {
      bal = { asset, free: 0, locked: 0 };
      this.balances.set(asset, bal);
    }
    return bal;
  }

  private findOrder(orderId?: string, clientOrderId?: string): PaperOrder | undefined {
    if (orderId) return this.orders.get(orderId);
    if (clientOrderId) return [...this.orders.values()].find((o) => o.clientOrderId === clientOrderId);
    return undefined;
  }

  private toOrderResult(order: PaperOrder): OrderResult {
    return {
      symbol: order.symbol,
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      status: order.status,
      side: order.side,
      type: order.type,
      price: order.price,
      origQty: order.origQty,
      executedQty: order.executedQty
    };
  }
}
