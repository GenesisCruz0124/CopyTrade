import type { SymbolFilter } from "./types.js";

/** Round a value down to the nearest multiple of `step` (never round up past exchange limits). */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const precision = decimalPlaces(step);
  const floored = Math.floor(value / step) * step;
  return Number(floored.toFixed(precision));
}

export function decimalPlaces(step: number): number {
  if (step === 0) return 0;
  const str = step.toString();
  if (str.includes("e-")) {
    return Number(str.split("e-")[1]);
  }
  const decimalIndex = str.indexOf(".");
  return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
}

export function roundPriceToTick(price: number, filter: SymbolFilter): number {
  return floorToStep(price, filter.tickSize);
}

export function roundQtyToStep(qty: number, filter: SymbolFilter): number {
  return floorToStep(qty, filter.stepSize);
}

export interface OrderValidationResult {
  ok: boolean;
  price: number;
  quantity: number;
  reason?: string;
}

/** Rounds price/qty to the symbol's tick/step size and validates against min notional / min-max qty. */
export function validateAndRoundOrder(
  price: number,
  quantity: number,
  filter: SymbolFilter
): OrderValidationResult {
  const roundedPrice = roundPriceToTick(price, filter);
  const roundedQty = roundQtyToStep(quantity, filter);

  if (roundedQty < filter.minQty) {
    return { ok: false, price: roundedPrice, quantity: roundedQty, reason: "quantity below minQty" };
  }
  if (filter.maxQty > 0 && roundedQty > filter.maxQty) {
    return { ok: false, price: roundedPrice, quantity: roundedQty, reason: "quantity above maxQty" };
  }
  const notional = roundedPrice * roundedQty;
  if (notional < filter.minNotional) {
    return { ok: false, price: roundedPrice, quantity: roundedQty, reason: "notional below minNotional" };
  }
  return { ok: true, price: roundedPrice, quantity: roundedQty };
}
