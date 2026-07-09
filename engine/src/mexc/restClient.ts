import { buildSignedQuery, toQueryString } from "./signer.js";
import { RateLimitedQueue, withBackoffOn429 } from "./rateLimiter.js";
import { logger } from "../logger.js";
import type {
  AccountInfo,
  ExchangeInfo,
  Kline,
  OrderResult,
  PlaceOrderParams,
  TickerPrice,
  TradeResult
} from "./types.js";

const BASE_URL = "https://api.mexc.com/api/v3";

export class MexcRateLimitError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MexcRateLimitError";
  }
}

/** Thrown when an order's outcome is unknown after a network/5xx error on submit — caller must reconcile via query, never blind-retry. */
export class MexcOrderStatusUnknownError extends Error {
  constructor(public clientOrderId: string, cause: unknown) {
    super(`Order status unknown for clientOrderId=${clientOrderId}: ${String(cause)}`);
    this.name = "MexcOrderStatusUnknownError";
  }
}

export interface MexcRestClientOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class MexcRestClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly orderQueue = new RateLimitedQueue(20);
  private readonly generalQueue = new RateLimitedQueue(10);

  constructor(opts: MexcRestClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    opts: { signed: boolean; queue: RateLimitedQueue }
  ): Promise<T> {
    return opts.queue.schedule(() =>
      withBackoffOn429(async () => this.doRequest<T>(method, path, params, opts.signed), {
        isRateLimited: (err) => err instanceof MexcRateLimitError
      })
    );
  }

  private async doRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    signed: boolean
  ): Promise<T> {
    const query = signed ? buildSignedQuery(params, this.apiSecret) : toQueryString(params);
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = {};
    if (signed) headers["X-MEXC-APIKEY"] = this.apiKey;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers });
    } catch (err) {
      throw new MexcOrderStatusUnknownError(String(params.origClientOrderId ?? params.clientOrderId ?? ""), err);
    }

    if (response.status === 429) {
      throw new MexcRateLimitError(429, "MEXC rate limit exceeded");
    }
    if (response.status >= 500) {
      // Server error: for order submission the outcome is genuinely unknown.
      const body = await response.text().catch(() => "");
      if (method === "POST" && path === "/order") {
        throw new MexcOrderStatusUnknownError(String(params.clientOrderId ?? ""), `HTTP ${response.status}: ${body}`);
      }
      throw new Error(`MEXC server error ${response.status}: ${body}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`MEXC request failed ${response.status}: ${body}`);
    }
    return (await response.json()) as T;
  }

  async exchangeInfo(): Promise<ExchangeInfo> {
    const raw = await this.request<any>("GET", "/exchangeInfo", {}, { signed: false, queue: this.generalQueue });
    return {
      symbols: (raw.symbols ?? []).map((s: any) => {
        const priceFilter = (s.filters ?? []).find((f: any) => f.filterType === "PRICE_FILTER");
        const lotSizeFilter = (s.filters ?? []).find((f: any) => f.filterType === "LOT_SIZE");
        const notionalFilter = (s.filters ?? []).find((f: any) => f.filterType === "MIN_NOTIONAL");
        return {
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          tickSize: Number(priceFilter?.tickSize ?? Math.pow(10, -(s.quotePrecision ?? 8))),
          stepSize: Number(lotSizeFilter?.stepSize ?? Math.pow(10, -(s.baseAssetPrecision ?? 8))),
          minNotional: Number(notionalFilter?.minNotional ?? 1),
          minQty: Number(lotSizeFilter?.minQty ?? 0),
          maxQty: Number(lotSizeFilter?.maxQty ?? 0),
          pricePrecision: s.quotePrecision ?? 8,
          quantityPrecision: s.baseAssetPrecision ?? 8
        };
      })
    };
  }

  async tickerPrice(symbol: string): Promise<TickerPrice> {
    const raw = await this.request<any>(
      "GET",
      "/ticker/price",
      { symbol },
      { signed: false, queue: this.generalQueue }
    );
    return { symbol: raw.symbol, price: Number(raw.price) };
  }

  async klines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
    const raw = await this.request<any[]>(
      "GET",
      "/klines",
      { symbol, interval, limit },
      { signed: false, queue: this.generalQueue }
    );
    return raw.map((k) => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: k[6]
    }));
  }

  async accountInfo(): Promise<AccountInfo> {
    const raw = await this.request<any>("GET", "/account", {}, { signed: true, queue: this.generalQueue });
    return {
      balances: (raw.balances ?? []).map((b: any) => ({
        asset: b.asset,
        free: Number(b.free),
        locked: Number(b.locked)
      }))
    };
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const body: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      newClientOrderId: params.clientOrderId
    };
    if (params.type === "LIMIT") {
      body.price = params.price!;
      body.timeInForce = "GTC";
    }
    try {
      const raw = await this.request<any>("POST", "/order", body, { signed: true, queue: this.orderQueue });
      return this.toOrderResult(raw);
    } catch (err) {
      if (err instanceof MexcOrderStatusUnknownError) {
        logger.warn({ clientOrderId: params.clientOrderId }, "order status unknown after submit; reconcile via queryOrder");
      }
      throw err;
    }
  }

  async cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    const raw = await this.request<any>(
      "DELETE",
      "/order",
      { symbol, orderId, origClientOrderId: clientOrderId },
      { signed: true, queue: this.orderQueue }
    );
    return this.toOrderResult(raw);
  }

  async queryOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<OrderResult> {
    const raw = await this.request<any>(
      "GET",
      "/order",
      { symbol, orderId, origClientOrderId: clientOrderId },
      { signed: true, queue: this.generalQueue }
    );
    return this.toOrderResult(raw);
  }

  async openOrders(symbol?: string): Promise<OrderResult[]> {
    const raw = await this.request<any[]>(
      "GET",
      "/openOrders",
      { symbol },
      { signed: true, queue: this.generalQueue }
    );
    return raw.map((o) => this.toOrderResult(o));
  }

  async myTrades(symbol: string, limit = 500): Promise<TradeResult[]> {
    const raw = await this.request<any[]>(
      "GET",
      "/myTrades",
      { symbol, limit },
      { signed: true, queue: this.generalQueue }
    );
    return raw.map((t) => ({
      symbol: t.symbol,
      id: String(t.id),
      orderId: String(t.orderId),
      price: Number(t.price),
      qty: Number(t.qty),
      quoteQty: Number(t.quoteQty),
      commission: Number(t.commission),
      commissionAsset: t.commissionAsset,
      side: t.isBuyer ? "BUY" : "SELL",
      time: t.time
    }));
  }

  // --- User data stream (listen key) for private WS updates ---
  async createListenKey(): Promise<string> {
    const raw = await this.request<any>("POST", "/userDataStream", {}, { signed: true, queue: this.generalQueue });
    return raw.listenKey;
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.request<any>("PUT", "/userDataStream" as any, { listenKey }, { signed: true, queue: this.generalQueue });
  }

  async closeListenKey(listenKey: string): Promise<void> {
    await this.request<any>("DELETE", "/userDataStream", { listenKey }, { signed: true, queue: this.generalQueue });
  }

  private toOrderResult(raw: any): OrderResult {
    return {
      symbol: raw.symbol,
      orderId: String(raw.orderId),
      clientOrderId: raw.clientOrderId ?? raw.origClientOrderId,
      status: raw.status,
      side: raw.side,
      type: raw.type,
      price: Number(raw.price ?? 0),
      origQty: Number(raw.origQty ?? 0),
      executedQty: Number(raw.executedQty ?? 0)
    };
  }
}
