/**
 * MEXC futures contracts are identified as `BASE_QUOTE` with an underscore
 * (e.g. `BTC_USDT`, `LINEA_USDT`). Copy-signal symbols come from AI extraction
 * and often arrive without the separator (`LINEAUSDT`) or in mixed case, which
 * makes the contract ticker/order endpoints reject them. Normalize to the
 * canonical form so price checks, sizing, and order placement all work.
 */
const QUOTES = ["USDT", "USDC", "USD"];

export function normalizeFuturesSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.length === 0) return s;
  // Already separated (e.g. "BTC_USDT") — keep as-is.
  if (s.includes("_")) return s;
  // Insert the separator before a known quote suffix ("LINEAUSDT" -> "LINEA_USDT").
  for (const quote of QUOTES) {
    if (s.endsWith(quote) && s.length > quote.length) {
      return `${s.slice(0, -quote.length)}_${quote}`;
    }
  }
  // Unknown quote — leave untouched rather than guess.
  return s;
}
