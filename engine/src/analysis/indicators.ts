/**
 * Pure technical-indicator functions over OHLCV candle data. No external
 * dependencies — every value is derived from the `Kline[]` the MEXC client
 * already returns. Functions assume candles are ordered oldest-first (which is
 * how `MexcRestClient.klines` / `ExchangeClient.getKlines` return them).
 */

/** Simple moving average of the last `period` values. Returns null if too few. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Exponential moving average series. Seeds with an SMA of the first `period`
 * values, then applies the standard multiplier. Returns one EMA value per input
 * value from index `period-1` onward; earlier entries are null so indices line
 * up with the source array.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = sma(values.slice(0, period), period) as number;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Latest EMA value, or null if there is not enough data. */
export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

/**
 * Wilder's RSI over `period` (default 14). Returns a value in [0, 100], or null
 * if there are fewer than `period + 1` closes.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  // Seed with the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // Wilder smoothing for the remainder.
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD (fast/slow/signal EMAs, default 12/26/9). Returns the latest line,
 * signal, and histogram, or null if there is not enough data.
 */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult | null {
  if (closes.length < slow + signalPeriod) return null;
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  // MACD line exists wherever both EMAs exist.
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastSeries[i];
    const s = slowSeries[i];
    return f != null && s != null ? f - s : null;
  });
  const macdValues = macdLine.filter((v): v is number => v != null);
  const signalSeries = emaSeries(macdValues, signalPeriod);
  const signal = signalSeries[signalSeries.length - 1];
  const macdNow = macdValues[macdValues.length - 1];
  if (signal == null || macdNow == null) return null;
  return { macd: macdNow, signal, histogram: macdNow - signal };
}

/**
 * Average True Range over `period` (default 14) using Wilder smoothing. A
 * volatility measure in price units, used to size stop-loss / take-profit
 * distances. Returns null if there are fewer than `period + 1` candles.
 */
export function atr(
  candles: { high: number; low: number; close: number }[],
  period = 14
): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    );
  }
  // Seed with the SMA of the first `period` true ranges, then Wilder-smooth.
  let value = sma(trueRanges.slice(0, period), period) as number;
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
  }
  return value;
}
