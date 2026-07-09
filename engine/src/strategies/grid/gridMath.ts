import type { GridConfig } from "../types.js";

export class GridConfigError extends Error {}

/** Computes the N price levels between lowerPrice and upperPrice inclusive. */
export function computeGridLevels(config: Pick<GridConfig, "lowerPrice" | "upperPrice" | "gridLevels" | "mode">): number[] {
  const { lowerPrice, upperPrice, gridLevels, mode } = config;

  if (gridLevels < 2 || gridLevels > 50) {
    throw new GridConfigError("gridLevels must be between 2 and 50");
  }
  if (lowerPrice <= 0 || upperPrice <= 0) {
    throw new GridConfigError("prices must be positive");
  }
  if (upperPrice <= lowerPrice) {
    throw new GridConfigError("upperPrice must be greater than lowerPrice");
  }

  const levels: number[] = [];
  if (mode === "arithmetic") {
    const step = (upperPrice - lowerPrice) / (gridLevels - 1);
    for (let i = 0; i < gridLevels; i++) levels.push(lowerPrice + step * i);
  } else {
    const ratio = Math.pow(upperPrice / lowerPrice, 1 / (gridLevels - 1));
    for (let i = 0; i < gridLevels; i++) levels.push(lowerPrice * Math.pow(ratio, i));
  }
  return levels;
}

/** Validates the configured range makes sense against the current market price (must fall inside, with room on both sides). */
export function validateGridRangeAgainstPrice(config: GridConfig, currentPrice: number): void {
  if (currentPrice <= config.lowerPrice || currentPrice >= config.upperPrice) {
    throw new GridConfigError(
      `current price ${currentPrice} must be strictly between lowerPrice ${config.lowerPrice} and upperPrice ${config.upperPrice}`
    );
  }
}

/** Splits total budget evenly across the buy-side levels (levels below current price). */
export function computeBudgetPerBuyLevel(totalBudgetUsdt: number, buyLevelCount: number): number {
  if (buyLevelCount <= 0) return 0;
  return totalBudgetUsdt / buyLevelCount;
}
