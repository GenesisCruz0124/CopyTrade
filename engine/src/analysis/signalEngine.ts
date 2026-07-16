import type { Kline } from "../mexc/types.js";
import { ema, rsi, macd, atr } from "./indicators.js";

export type SignalDirection = "LONG" | "SHORT" | "NEUTRAL";

export interface SignalIndicators {
  price: number;
  emaFast: number;
  emaSlow: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr: number;
}

export interface MarketSignal {
  symbol: string;
  interval: string;
  signal: SignalDirection;
  /** 0-100. Distance of the weighted score from neutral, scaled to a percent. */
  confidence: number;
  /** Signed weighted score in [-1, 1]; positive = bullish, negative = bearish. */
  score: number;
  indicators: SignalIndicators;
  /** Human-readable explanations of what each indicator contributed. */
  reasons: string[];
  /** Suggested futures entry (current close). */
  suggestedEntry: number;
  /** ATR-based protective stop for the suggested direction. */
  stopLoss: number;
  /** ATR-based profit target for the suggested direction. */
  takeProfit: number;
  /** takeProfit/stopLoss distance ratio; null for a NEUTRAL signal. */
  riskRewardRatio: number | null;
  candlesAnalyzed: number;
  generatedAt: number;
}

export interface SignalEngineOptions {
  emaFastPeriod?: number;
  emaSlowPeriod?: number;
  rsiPeriod?: number;
  atrPeriod?: number;
  /** ATR multiple for the stop-loss distance. */
  atrStopMultiplier?: number;
  /** ATR multiple for the take-profit distance. */
  atrTakeProfitMultiplier?: number;
  /** |score| at or above this maps to a directional signal; below is NEUTRAL. */
  signalThreshold?: number;
}

const DEFAULTS: Required<SignalEngineOptions> = {
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  atrTakeProfitMultiplier: 3,
  signalThreshold: 0.2
};

/**
 * Weight each indicator contributes to the final score. Kept explicit so the
 * blend is easy to tune. Weights are normalised at scoring time, so their
 * absolute magnitudes don't need to sum to 1.
 */
const WEIGHTS = {
  emaTrend: 0.35,
  macd: 0.3,
  rsi: 0.2,
  emaSlope: 0.15
};

export class InsufficientCandlesError extends Error {
  constructor(need: number, got: number) {
    super(`insufficient candles: need at least ${need}, got ${got}`);
    this.name = "InsufficientCandlesError";
  }
}

/**
 * Analyze a series of candles (oldest-first) for a coin pair and produce a
 * directional futures signal. Rule-based and transparent: a weighted blend of
 * EMA trend, MACD momentum, and RSI, with ATR-derived stop-loss / take-profit.
 */
export function analyzeSignal(
  symbol: string,
  interval: string,
  candles: Kline[],
  options: SignalEngineOptions = {}
): MarketSignal {
  const opts = { ...DEFAULTS, ...options };
  // MACD (12/26/9) is the hungriest input; ensure we have enough to seed it.
  const minCandles = 26 + 9 + 1;
  if (candles.length < minCandles) {
    throw new InsufficientCandlesError(minCandles, candles.length);
  }

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];

  const emaFast = ema(closes, opts.emaFastPeriod);
  const emaSlow = ema(closes, opts.emaSlowPeriod);
  // EMA slope: compare the fast EMA now vs. a few candles back for direction.
  const emaFastPrev = ema(closes.slice(0, -3), opts.emaFastPeriod);
  const rsiValue = rsi(closes, opts.rsiPeriod);
  const macdResult = macd(closes);
  const atrValue = atr(candles, opts.atrPeriod);

  if (
    emaFast == null ||
    emaSlow == null ||
    emaFastPrev == null ||
    rsiValue == null ||
    macdResult == null ||
    atrValue == null
  ) {
    throw new InsufficientCandlesError(minCandles, candles.length);
  }

  const reasons: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  const add = (weight: number, contribution: number, reason: string) => {
    weightedSum += weight * contribution;
    totalWeight += weight;
    reasons.push(reason);
  };

  // 1) EMA trend: fast above slow is bullish. Scale by their separation
  //    relative to price so a wide gap counts more than a razor-thin cross.
  const emaGapPct = ((emaFast - emaSlow) / price) * 100;
  const emaTrendContribution = clamp(emaGapPct / 1.5, -1, 1);
  add(
    WEIGHTS.emaTrend,
    emaTrendContribution,
    emaFast > emaSlow
      ? `EMA${opts.emaFastPeriod} above EMA${opts.emaSlowPeriod} (uptrend, +${emaGapPct.toFixed(2)}%)`
      : `EMA${opts.emaFastPeriod} below EMA${opts.emaSlowPeriod} (downtrend, ${emaGapPct.toFixed(2)}%)`
  );

  // 2) MACD histogram momentum, normalised by price.
  const macdHistPct = (macdResult.histogram / price) * 100;
  const macdContribution = clamp(macdHistPct / 0.5, -1, 1);
  add(
    WEIGHTS.macd,
    macdContribution,
    macdResult.histogram >= 0
      ? "MACD histogram positive (bullish momentum)"
      : "MACD histogram negative (bearish momentum)"
  );

  // 3) RSI: map to [-1, 1] around the 50 midline. Above 70 / below 30 are
  //    flagged as stretched but still contribute in the trend's direction.
  const rsiContribution = clamp((rsiValue - 50) / 30, -1, 1);
  if (rsiValue >= 70) reasons.push(`RSI ${rsiValue.toFixed(1)} (overbought)`);
  else if (rsiValue <= 30) reasons.push(`RSI ${rsiValue.toFixed(1)} (oversold)`);
  else reasons.push(`RSI ${rsiValue.toFixed(1)} (${rsiValue >= 50 ? "bullish" : "bearish"})`);
  weightedSum += WEIGHTS.rsi * rsiContribution;
  totalWeight += WEIGHTS.rsi;

  // 4) EMA slope: is the fast EMA rising or falling?
  const emaSlopePct = ((emaFast - emaFastPrev) / price) * 100;
  const emaSlopeContribution = clamp(emaSlopePct / 0.5, -1, 1);
  add(
    WEIGHTS.emaSlope,
    emaSlopeContribution,
    emaSlopePct >= 0 ? "Fast EMA rising" : "Fast EMA falling"
  );

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
  let signal: SignalDirection;
  if (score >= opts.signalThreshold) signal = "LONG";
  else if (score <= -opts.signalThreshold) signal = "SHORT";
  else signal = "NEUTRAL";

  const confidence = Math.round(Math.min(Math.abs(score) / 1, 1) * 100);

  // ATR-based bracket in the signal's direction. For NEUTRAL we present the
  // LONG-side bracket as a reference but leave riskRewardRatio null.
  const stopDist = atrValue * opts.atrStopMultiplier;
  const tpDist = atrValue * opts.atrTakeProfitMultiplier;
  const directionSign = signal === "SHORT" ? -1 : 1;
  const stopLoss = price - directionSign * stopDist;
  const takeProfit = price + directionSign * tpDist;
  const riskRewardRatio = signal === "NEUTRAL" ? null : round(tpDist / stopDist, 2);

  return {
    symbol,
    interval,
    signal,
    confidence,
    score: round(score, 4),
    indicators: {
      price: round(price, 8),
      emaFast: round(emaFast, 8),
      emaSlow: round(emaSlow, 8),
      rsi: round(rsiValue, 2),
      macd: round(macdResult.macd, 8),
      macdSignal: round(macdResult.signal, 8),
      macdHistogram: round(macdResult.histogram, 8),
      atr: round(atrValue, 8)
    },
    reasons,
    suggestedEntry: round(price, 8),
    stopLoss: round(stopLoss, 8),
    takeProfit: round(takeProfit, 8),
    riskRewardRatio,
    candlesAnalyzed: candles.length,
    generatedAt: Date.now()
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
