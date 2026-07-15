/**
 * Simplified isolated-margin liquidation price estimate, ignoring fees and
 * funding — good enough for a pre-trade sanity/safety check, not for precise
 * accounting. positionType: "long" | "short".
 */
export function estimateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number,
  positionType: "long" | "short"
): number {
  const marginRatio = 1 / leverage;
  if (positionType === "long") {
    return entryPrice * (1 - marginRatio + maintenanceMarginRate);
  }
  return entryPrice * (1 + marginRatio - maintenanceMarginRate);
}

/** Percentage distance from entry price to the estimated liquidation price. */
export function liquidationDistancePct(
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number,
  positionType: "long" | "short"
): number {
  const liq = estimateLiquidationPrice(entryPrice, leverage, maintenanceMarginRate, positionType);
  return (Math.abs(entryPrice - liq) / entryPrice) * 100;
}
