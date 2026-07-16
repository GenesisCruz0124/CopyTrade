import { signFuturesRequest, sortedQueryString } from "./signer.js";
import { RateLimitedQueue, withBackoffOn429 } from "../mexc/rateLimiter.js";
import { logger } from "../logger.js";
import type {
  FuturesAsset,
  FuturesContractDetail,
  FuturesKline,
  FuturesOrderResult,
  FuturesOrderStatus,
  FuturesPlaceOrderParams,
  FuturesPosition,
  FuturesTicker
} from "./types.js";

const BASE_URL = "https://contract.mexc.com/api/v1";

export class FuturesRateLimitError extends Error {}
export class FuturesOrderStatusUnknownError extends Error {
  constructor(public externalOid: string, cause: unknown) {
    super(`Futures order status unknown for externalOid=${externalOid}: ${String(cause)}`);
    this.name = "FuturesOrderStatusUnknownError";
  }
}

export interface FuturesRestClientOptions {
  accessKey: string;
  secretKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * MEXC Futures (contract.mexc.com) REST client. Uses the contract API's own
 * signing scheme (ApiKey/Request-Time/Signature headers) — not compatible
 * with the Spot v3 client despite both being "MEXC".
 */
export class FuturesRestClient {
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly orderQueue = new RateLimitedQueue(20);
  private readonly generalQueue = new RateLimitedQueue(10);

  constructor(opts: FuturesRestClientOptions) {
    this.accessKey = opts.accessKey;
    this.secretKey = opts.secretKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    opts: { signed: boolean; queue: RateLimitedQueue }
  ): Promise<T> {
    return opts.queue.schedule(() =>
      withBackoffOn429(() => this.doRequest<T>(method, path, params, opts.signed), {
        isRateLimited: (err) => err instanceof FuturesRateLimitError
      })
    );
  }

  private async doRequest<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    signed: boolean
  ): Promise<T> {
    const timestamp = Date.now();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let url = `${this.baseUrl}${path}`;
    let body: string | undefined;

    if (signed) {
      const paramsString = method === "GET" ? sortedQueryString(params) : JSON.stringify(params);
      const signature = signFuturesRequest(this.accessKey, this.secretKey, timestamp, paramsString);
      headers["ApiKey"] = this.accessKey;
      headers["Request-Time"] = String(timestamp);
      headers["Signature"] = signature;
      if (method === "GET" && paramsString) url += `?${paramsString}`;
      if (method === "POST") body = paramsString;
    } else if (method === "GET") {
      const qs = sortedQueryString(params);
      if (qs) url += `?${qs}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body });
    } catch (err) {
      throw new FuturesOrderStatusUnknownError(String(params.externalOid ?? ""), err);
    }

    if (response.status === 429) throw new FuturesRateLimitError("MEXC futures rate limit exceeded");
    if (response.status >= 500) {
      const text = await response.text().catch(() => "");
      if (method === "POST" && path === "/private/order/submit") {
        throw new FuturesOrderStatusUnknownError(String(params.externalOid ?? ""), `HTTP ${response.status}: ${text}`);
      }
      throw new Error(`MEXC futures server error ${response.status}: ${text}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MEXC futures request failed ${response.status}: ${text}`);
    }

    const text = await response.text();
    const json = parseJsonPreservingBigOrderIds(text);
    if (json.success === false) {
      throw new Error(`MEXC futures API error code=${json.code}: ${JSON.stringify(json.data ?? json.message ?? "")}`);
    }
    return json.data as T;
  }

  /** Lists every tradable contract on MEXC futures, for symbol pickers. No auth required. */
  async allContracts(): Promise<{ symbol: string; baseCoin: string; quoteCoin: string; maxLeverage: number }[]> {
    const all = await this.request<any[]>("GET", "/contract/detail", {}, { signed: false, queue: this.generalQueue });
    return all
      .filter((raw) => raw.quoteCoin === "USDT" && raw.state === 0)
      .map((raw) => ({
        symbol: raw.symbol,
        baseCoin: raw.baseCoin,
        quoteCoin: raw.quoteCoin,
        maxLeverage: Number(raw.maxLeverage)
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async contractDetail(symbol: string): Promise<FuturesContractDetail> {
    const all = await this.request<any[]>("GET", "/contract/detail", { symbol }, { signed: false, queue: this.generalQueue });
    const raw = Array.isArray(all) ? all[0] : all;
    return {
      symbol: raw.symbol,
      baseCoin: raw.baseCoin,
      quoteCoin: raw.quoteCoin,
      contractSize: Number(raw.contractSize),
      priceUnit: Number(raw.priceUnit),
      volUnit: Number(raw.volUnit ?? 1),
      minVol: Number(raw.minVol),
      maxVol: Number(raw.maxVol),
      minLeverage: Number(raw.minLeverage ?? 1),
      maxLeverage: Number(raw.maxLeverage),
      maintenanceMarginRate: Number(raw.maintenanceMarginRate ?? 0.005),
      // MEXC's default USDT-margined taker fee if the contract doesn't report its own rate.
      takerFeeRate: Number(raw.takerFeeRate ?? 0.0006)
    };
  }

  async ticker(symbol: string): Promise<FuturesTicker> {
    const raw = await this.request<any>("GET", "/contract/ticker", { symbol }, { signed: false, queue: this.generalQueue });
    return { symbol: raw.symbol, lastPrice: Number(raw.lastPrice), fairPrice: Number(raw.fairPrice ?? raw.lastPrice) };
  }

  /** Futures kline candles. MEXC returns parallel arrays (not array-of-arrays like spot),
   *  time in seconds, and no `limit` param — truncate to the most recent `limit` client-side. */
  async klines(symbol: string, interval: string, limit = 100): Promise<FuturesKline[]> {
    const raw = await this.request<{
      time: number[];
      open: number[];
      close: number[];
      high: number[];
      low: number[];
      vol: number[];
    }>("GET", `/contract/kline/${symbol}`, { interval }, { signed: false, queue: this.generalQueue });
    const n = raw.time?.length ?? 0;
    const start = Math.max(0, n - limit);
    const out: FuturesKline[] = [];
    for (let i = start; i < n; i++) {
      out.push({
        openTime: raw.time[i] * 1000,
        open: Number(raw.open[i]),
        high: Number(raw.high[i]),
        low: Number(raw.low[i]),
        close: Number(raw.close[i]),
        volume: Number(raw.vol[i])
      });
    }
    return out;
  }

  async placeOrder(params: FuturesPlaceOrderParams): Promise<FuturesOrderResult> {
    const body: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side,
      vol: params.vol,
      leverage: params.leverage,
      openType: params.openType === "isolated" ? 1 : 2,
      type: params.type === "MARKET" ? 5 : 1,
      externalOid: params.externalOid
    };
    if (params.type === "LIMIT") body.price = params.price!;

    try {
      // MEXC's response `data` for order/submit is the bare order ID (a number),
      // not `{ orderId }` — verified live 2026-07-15.
      const orderId = await this.request<number | string>("POST", "/private/order/submit", body, {
        signed: true,
        queue: this.orderQueue
      });
      return { orderId: String(orderId), externalOid: params.externalOid, symbol: params.symbol, state: "NEW" };
    } catch (err) {
      if (err instanceof FuturesOrderStatusUnknownError) {
        logger.warn({ externalOid: params.externalOid }, "futures order status unknown after submit; reconcile via position/order query");
      }
      throw err;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    // MEXC's /private/order/cancel expects a bare JSON array of order IDs as the
    // request body — not `{ orderIds: [...] }` — confirmed live 2026-07-16 ("Parameter
    // error" code=600 with the object shape; a bare array is MEXC's documented contract).
    await this.request("POST", "/private/order/cancel", [orderId] as any, { signed: true, queue: this.orderQueue });
  }

  async getOrder(orderId: string): Promise<FuturesOrderStatus> {
    const raw = await this.request<any>("GET", `/private/order/get/${orderId}`, {}, { signed: true, queue: this.generalQueue });
    return mapOrderStatus(raw);
  }

  async openOrders(symbol: string): Promise<FuturesOrderStatus[]> {
    const raw = await this.request<any[]>(
      "GET",
      `/private/order/list/open_orders/${symbol}`,
      {},
      { signed: true, queue: this.generalQueue }
    );
    return raw.map(mapOrderStatus);
  }

  async openPositions(symbol?: string): Promise<FuturesPosition[]> {
    const raw = await this.request<any[]>(
      "GET",
      "/private/position/open_positions",
      { symbol },
      { signed: true, queue: this.generalQueue }
    );
    return raw.map((p) => ({
      symbol: p.symbol,
      positionId: String(p.positionId),
      holdVol: Number(p.holdVol),
      openAvgPrice: Number(p.openAvgPrice),
      leverage: Number(p.leverage),
      openType: p.openType === 1 ? "isolated" : "cross",
      liquidatePrice: Number(p.liquidatePrice),
      positionType: p.positionType
    }));
  }

  async assets(currency = "USDT"): Promise<FuturesAsset> {
    const raw = await this.request<any>("GET", `/private/account/asset/${currency}`, {}, { signed: true, queue: this.generalQueue });
    return {
      currency: raw.currency,
      availableBalance: Number(raw.availableBalance),
      positionMargin: Number(raw.positionMargin),
      equity: Number(raw.equity)
    };
  }
}

/**
 * MEXC order/position IDs are 18-19 digit integers, well beyond
 * Number.MAX_SAFE_INTEGER (2^53-1). JSON.parse (and thus response.json())
 * silently rounds them to the nearest representable double, corrupting the ID
 * — verified live 2026-07-16: a real order ID came back as
 * "832535434919189000" (trailing zeros from float rounding) and a later
 * getOrder() lookup by that corrupted ID found nothing. Quoting long bare
 * integers before parsing keeps them as exact strings instead.
 */
function parseJsonPreservingBigOrderIds(text: string): any {
  return JSON.parse(text.replace(/:(\s*)(\d{16,})(\s*[,}\]])/g, ':$1"$2"$3'));
}

function mapOrderStatus(raw: any): FuturesOrderStatus {
  return {
    orderId: String(raw.orderId),
    symbol: raw.symbol,
    externalOid: raw.externalOid,
    state: Number(raw.state) as FuturesOrderStatus["state"],
    side: Number(raw.side) as FuturesOrderStatus["side"],
    openType: raw.openType === 1 ? "isolated" : "cross",
    orderType: Number(raw.orderType) === 5 ? "MARKET" : "LIMIT",
    leverage: Number(raw.leverage),
    price: Number(raw.price),
    vol: Number(raw.vol),
    dealVol: Number(raw.dealVol),
    dealAvgPrice: Number(raw.dealAvgPrice),
    takerFeeRate: Number(raw.takerFeeRate),
    makerFeeRate: Number(raw.makerFeeRate),
    createTime: Number(raw.createTime),
    updateTime: Number(raw.updateTime)
  };
}
