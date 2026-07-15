import WebSocket from "ws";
import { logger } from "../logger.js";
import type { BookTicker } from "./types.js";
import type { MexcRestClient } from "./restClient.js";

const WS_URL = "wss://wbs-api.mexc.com/ws";
const MAX_CONNECTION_MS = 23 * 60 * 60 * 1000; // reconnect before MEXC's 24h cap
// MEXC (and some network paths) close an idle socket at ~30s of no client traffic.
// Ping well under that margin, and send the first one immediately on connect rather
// than waiting a full interval — waiting let the server close the socket before our
// first keepalive ever went out, causing an endless connect/close/reconnect loop.
const PING_INTERVAL_MS = 15_000;
const LISTEN_KEY_KEEPALIVE_MS = 30 * 60 * 1000; // MEXC listen keys expire after 60 min

export type BookTickerHandler = (ticker: BookTicker) => void;
export type AccountUpdateHandler = (payload: unknown) => void;

export interface MexcWsClientOptions {
  restClient?: MexcRestClient;
  wsUrl?: string;
}

export class MexcWsClient {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly restClient?: MexcRestClient;
  private readonly subscribedSymbols = new Set<string>();
  private listenKey: string | null = null;
  private connectedAt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private listenKeyKeepAliveTimer: NodeJS.Timeout | null = null;
  private closedByUser = false;

  private bookTickerHandlers: BookTickerHandler[] = [];
  private accountUpdateHandlers: AccountUpdateHandler[] = [];

  constructor(opts: MexcWsClientOptions = {}) {
    this.wsUrl = opts.wsUrl ?? WS_URL;
    this.restClient = opts.restClient;
  }

  onBookTicker(handler: BookTickerHandler): void {
    this.bookTickerHandlers.push(handler);
  }

  onAccountUpdate(handler: AccountUpdateHandler): void {
    this.accountUpdateHandlers.push(handler);
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    if (this.restClient) {
      this.listenKey = await this.restClient.createListenKey();
      this.armListenKeyKeepAlive();
    }
    this.open();
  }

  subscribeSymbol(symbol: string): void {
    this.subscribedSymbols.add(symbol);
    this.sendSubscribe(symbol);
  }

  unsubscribeSymbol(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
    this.send({ method: "UNSUBSCRIPTION", params: [`spot@public.bookTicker.v3.api@${symbol}`] });
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.listenKeyKeepAliveTimer) clearInterval(this.listenKeyKeepAliveTimer);
    this.listenKeyKeepAliveTimer = null;
    this.ws?.close();
    this.ws = null;
    if (this.listenKey && this.restClient) {
      this.restClient.closeListenKey(this.listenKey).catch((err) => logger.warn({ err }, "failed to close listen key"));
    }
  }

  private open(): void {
    this.ws = new WebSocket(this.wsUrl);
    this.connectedAt = Date.now();

    this.ws.on("open", () => {
      logger.info("MEXC WS connected");
      for (const symbol of this.subscribedSymbols) this.sendSubscribe(symbol);
      if (this.listenKey) {
        this.send({ method: "SUBSCRIPTION", params: [`spot@private.account.v3.api.pb`], listenKey: this.listenKey });
      }
      this.armPing();
      this.armProactiveReconnect();
    });

    this.ws.on("message", (data) => this.handleMessage(data.toString()));

    this.ws.on("close", (code, reason) => {
      logger.warn({ code, reason: reason?.toString() }, "MEXC WS closed");
      this.clearTimers();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.error({ err }, "MEXC WS error");
    });
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.channel?.includes("bookTicker") && msg.data) {
      const d = msg.data;
      const ticker: BookTicker = {
        symbol: msg.symbol ?? d.symbol,
        bidPrice: Number(d.bidPrice ?? d.b),
        bidQty: Number(d.bidQuantity ?? d.B),
        askPrice: Number(d.askPrice ?? d.a),
        askQty: Number(d.askQuantity ?? d.A)
      };
      for (const handler of this.bookTickerHandlers) handler(ticker);
      return;
    }

    if (msg.channel?.includes("private")) {
      for (const handler of this.accountUpdateHandlers) handler(msg);
    }
  }

  private sendSubscribe(symbol: string): void {
    this.send({ method: "SUBSCRIPTION", params: [`spot@public.bookTicker.v3.api@${symbol}`] });
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private armPing(): void {
    this.send({ method: "PING" });
    this.pingTimer = setInterval(() => {
      this.send({ method: "PING" });
    }, PING_INTERVAL_MS);
  }

  private armProactiveReconnect(): void {
    this.renewTimer = setTimeout(() => {
      logger.info("proactively reconnecting MEXC WS before 24h cap");
      this.ws?.close();
    }, MAX_CONNECTION_MS);
  }

  private armListenKeyKeepAlive(): void {
    this.listenKeyKeepAliveTimer = setInterval(() => {
      if (this.listenKey && this.restClient) {
        this.restClient.keepAliveListenKey(this.listenKey).catch((err) =>
          logger.warn({ err }, "failed to keep listen key alive")
        );
      }
    }, LISTEN_KEY_KEEPALIVE_MS);
  }

  private scheduleReconnect(): void {
    const jitterMs = 1000 + Math.random() * 4000;
    this.reconnectTimer = setTimeout(() => this.open(), jitterMs);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.renewTimer = null;
    this.reconnectTimer = null;
  }
}
