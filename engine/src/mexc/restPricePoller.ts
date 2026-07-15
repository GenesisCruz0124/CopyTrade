import { logger } from "../logger.js";
import type { MexcRestClient } from "./restClient.js";

export interface RestPricePollerOptions {
  restClient: MexcRestClient;
  onPrice: (symbol: string, price: number) => void;
  intervalMs?: number;
}

/**
 * Polls REST ticker prices for a set of symbols on a fixed interval.
 *
 * Paper mode originally relied solely on the public WS bookTicker stream for
 * price data. Some MEXC WS market-data subscriptions get blocked for
 * datacenter/VPS IP ranges even while REST stays fully reachable ("Not
 * Subscribed successfully ... Reason: Blocked!") — when that happens the WS
 * client reconnects forever and paper bots never receive a price, so orders
 * silently never place. This poller is a REST fallback that keeps paper mode
 * working regardless of whether the WS subscription is actually accepted.
 */
export class RestPricePoller {
  private readonly symbols = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: RestPricePollerOptions) {}

  start(): void {
    const intervalMs = this.opts.intervalMs ?? 3000;
    this.timer = setInterval(() => this.pollAll(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  addSymbol(symbol: string): void {
    if (this.symbols.has(symbol)) return;
    this.symbols.add(symbol);
    this.pollOne(symbol); // don't wait for the next tick to get an initial price
  }

  private pollAll(): void {
    for (const symbol of this.symbols) this.pollOne(symbol);
  }

  private pollOne(symbol: string): void {
    this.opts.restClient
      .tickerPrice(symbol)
      .then((ticker) => this.opts.onPrice(symbol, ticker.price))
      .catch((err) => logger.warn({ err, symbol }, "REST price poll failed"));
  }
}
