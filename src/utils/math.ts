import { ReshapeDistributionType } from "../types";

const BASIS_POINT_MAX = 10000;

/**
 * Calculates human-readable UI price for a given binId
 */
export function getBinPrice(
  binId: number,
  binStep: number,
  decimalsX: number = 9,
  decimalsY: number = 6
): number {
  const stepRatio = 1 + binStep / BASIS_POINT_MAX;
  const rawPrice = Math.pow(stepRatio, binId);
  const decimalAdjustment = Math.pow(10, decimalsX - decimalsY);
  return rawPrice * decimalAdjustment;
}

/**
 * Calculates binId from UI price
 */
export function getPriceBinId(
  price: number,
  binStep: number,
  decimalsX: number = 9,
  decimalsY: number = 6
): number {
  if (price <= 0) return 0;
  const stepRatio = 1 + binStep / BASIS_POINT_MAX;
  const decimalAdjustment = Math.pow(10, decimalsX - decimalsY);
  const rawPrice = price / decimalAdjustment;
  return Math.round(Math.log(rawPrice) / Math.log(stepRatio));
}

/**
 * Calculates per-bin distribution weights for reshaping.
 * Supports:
 * - "ascending": ramps up from startBin to endBin (single-sided ask slice).
 * - "descending": ramps down from startBin to endBin (single-sided bid slice).
 * - "bidask_two_sided": V-shape centered around activeBinId, where bins near activeBinId
 *   have minimum weight (minWeight), and weights ramp UP towards both outer boundaries (maxWeight).
 */
export function calculateDistributionWeights(
  startBin: number,
  endBin: number,
  type: ReshapeDistributionType,
  minWeight: number = 200,
  maxWeight: number = 2000,
  mode: "ascending" | "descending" | "bidask_two_sided" = "ascending",
  activeBinId?: number
): { binId: number; weight: number; normalizedPercent: number }[] {
  const count = endBin - startBin + 1;
  if (count <= 0) return [];

  const result: { binId: number; weight: number; normalizedPercent: number }[] = [];
  let totalWeight = 0;

  for (let i = 0; i < count; i++) {
    const binId = startBin + i;
    let weight = minWeight;

    if (type === "triangular" || type === "bidask") {
      if (mode === "bidask_two_sided" && typeof activeBinId === "number") {
        // True two-sided Bid-Ask V-shape centered around activeBin:
        // Minimum weight at activeBin, ramping up towards minBinId (downwards) and maxBinId (upwards)
        if (binId < activeBinId) {
          // Bid side: distance from activeBin to lower limit
          const bidSpan = activeBinId - startBin;
          const dist = activeBinId - binId;
          const slope = bidSpan > 0 ? (maxWeight - minWeight) / bidSpan : 0;
          weight = minWeight + dist * slope;
        } else if (binId > activeBinId) {
          // Ask side: distance from activeBin to upper limit
          const askSpan = endBin - activeBinId;
          const dist = binId - activeBinId;
          const slope = askSpan > 0 ? (maxWeight - minWeight) / askSpan : 0;
          weight = minWeight + dist * slope;
        } else {
          // At active bin
          weight = minWeight;
        }
      } else {
        const slope = count > 1 ? (maxWeight - minWeight) / (count - 1) : 0;
        if (mode === "ascending") {
          // Starts at minWeight at startBin, ramps to maxWeight at endBin
          weight = minWeight + i * slope;
        } else {
          // Starts at maxWeight at startBin (lowest price), ramps down to minWeight at endBin (near active price)
          weight = maxWeight - i * slope;
        }
      }
    } else if (type === "spot") {
      // Uniform distribution across bins
      weight = 1000;
    }

    totalWeight += weight;
    result.push({ binId, weight: Math.round(weight), normalizedPercent: 0 });
  }

  // Calculate normalized percentages for preview
  if (totalWeight > 0) {
    for (const item of result) {
      item.normalizedPercent = (item.weight / totalWeight) * 100;
    }
  }

  return result;
}

/**
 * Formats a price nicely with appropriate decimals
 */
export function formatPrice(price: number): string {
  if (price === 0) return "0.00";
  if (price < 0.000001) return price.toFixed(8);
  if (price < 0.0001) return price.toFixed(8);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 1000) return price.toFixed(2);
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
