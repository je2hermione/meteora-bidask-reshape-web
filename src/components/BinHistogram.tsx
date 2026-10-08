import React, { useMemo } from "react";
import { PositionBin, ReshapeDistributionType, ReshapeScopeMode } from "../types";
import {
  calculateDistributionWeights,
  formatPrice,
  getBinPrice,
} from "../utils/math";

interface BinHistogramProps {
  binStep: number;
  decimalsX: number;
  decimalsY: number;
  tokenXSymbol: string;
  tokenYSymbol: string;
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
  marketBins?: {
    binId: number;
    price: number;
    amountX: number;
    amountY: number;
  }[];
  userBins?: PositionBin[];
  distributionType: ReshapeDistributionType;
  scopeMode?: ReshapeScopeMode;
  minWeight: number;
  maxWeight: number;
}

export const BinHistogram: React.FC<BinHistogramProps> = ({
  binStep,
  decimalsX,
  decimalsY,
  tokenXSymbol,
  tokenYSymbol,
  activeBinId,
  minBinId,
  maxBinId,
  marketBins = [],
  userBins = [],
  distributionType,
  scopeMode = "full_range",
  minWeight,
  maxWeight,
}) => {
  const hasUserPosition = Boolean(userBins && userBins.length > 0);

  // Determine display bounds around current active bin and position
  const displayMinBin = useMemo(() => {
    if (hasUserPosition) {
      return Math.min(minBinId - 1, activeBinId - 2);
    }
    return Math.min(minBinId - 4, activeBinId - 16);
  }, [hasUserPosition, minBinId, activeBinId]);

  const displayMaxBin = useMemo(() => {
    if (hasUserPosition) {
      return Math.max(maxBinId + 1, activeBinId + 2);
    }
    return Math.max(maxBinId + 4, activeBinId + 24);
  }, [hasUserPosition, maxBinId, activeBinId]);

  // Map real market liquidity amounts by binId
  const marketMap = useMemo(() => {
    const map = new Map<number, { amountX: number; amountY: number }>();
    marketBins.forEach((b) => {
      map.set(b.binId, { amountX: b.amountX, amountY: b.amountY });
    });
    return map;
  }, [marketBins]);

  // Map user position amounts by binId
  const userMap = useMemo(() => {
    const map = new Map<number, { amountX: number; amountY: number; liquidityShare: string }>();
    userBins.forEach((b) => {
      map.set(b.binId, { amountX: b.amountX, amountY: b.amountY, liquidityShare: b.liquidityShare });
    });
    return map;
  }, [userBins]);

  // Compute maximum amount across displayed bins to scale bars accurately
  const maxLiquidityVal = useMemo(() => {
    let max = 0;
    if (hasUserPosition) {
      for (const b of userBins) {
        if (b.amountX > max) max = b.amountX;
        if (b.amountY > max) max = b.amountY;
      }
    } else {
      for (let b = displayMinBin; b <= displayMaxBin; b++) {
        const data = marketMap.get(b);
        if (data) {
          if (data.amountX > max) max = data.amountX;
          if (data.amountY > max) max = data.amountY;
        }
      }
    }
    return max > 0 ? max : 1;
  }, [hasUserPosition, userBins, displayMinBin, displayMaxBin, marketMap]);

  // Reshape calculation:
  // Determine if dominant side is Ask (Token X above active bin) or Bid (Token Y below active bin)
  const isOutOfRangeBelow = activeBinId <= minBinId;
  const isOutOfRangeAbove = activeBinId >= maxBinId;
  const isAskSideDominant = activeBinId < (minBinId + maxBinId) / 2;

  let reshapeStartBin = minBinId;
  let reshapeEndBin = maxBinId;
  let slopeMode: "ascending" | "descending" | "bidask_two_sided" = "ascending";

  if (isOutOfRangeBelow) {
    // 100% Token X: Ascending triangle across full range
    reshapeStartBin = minBinId;
    reshapeEndBin = maxBinId;
    slopeMode = "ascending";
  } else if (isOutOfRangeAbove) {
    // 100% Token Y: Descending triangle across full range
    reshapeStartBin = minBinId;
    reshapeEndBin = maxBinId;
    slopeMode = "descending";
  } else if (scopeMode === "full_range") {
    // Inside range with Full Range: Symmetric 2-sided Bid-Ask shape!
    // V-shape centered around activeBinId
    reshapeStartBin = minBinId;
    reshapeEndBin = maxBinId;
    slopeMode = "bidask_two_sided";
  } else if (scopeMode === "ask_slice") {
    // Ask Side Slice: from activeBin + 1 up to maxBinId (Ascending slope)
    reshapeStartBin = Math.max(minBinId, activeBinId + 1);
    reshapeEndBin = maxBinId;
    slopeMode = "ascending";
  } else if (scopeMode === "bid_slice") {
    // Bid Side Slice: from minBinId up to activeBin - 1 (Descending slope: high weight at minBinId)
    reshapeStartBin = minBinId;
    reshapeEndBin = Math.min(maxBinId, activeBinId - 1);
    slopeMode = "descending";
  }

  const reshapeWeights = useMemo(() => {
    return calculateDistributionWeights(
      reshapeStartBin,
      reshapeEndBin,
      distributionType,
      minWeight,
      maxWeight,
      slopeMode,
      activeBinId
    );
  }, [reshapeStartBin, reshapeEndBin, distributionType, minWeight, maxWeight, slopeMode, activeBinId]);

  const weightMap = useMemo(() => {
    const map = new Map<number, number>();
    reshapeWeights.forEach((w) => map.set(w.binId, w.normalizedPercent));
    return map;
  }, [reshapeWeights]);

  // Construct bin buckets
  const bins = useMemo(() => {
    const list = [];
    for (let b = displayMinBin; b <= displayMaxBin; b++) {
      const price = getBinPrice(b, binStep, decimalsX, decimalsY);
      const isActive = b === activeBinId;
      const isInCurrentRange = b >= minBinId && b <= maxBinId;
      const isEligibleForReshape = b >= reshapeStartBin && b <= reshapeEndBin;

      const sourceData = hasUserPosition ? userMap.get(b) : marketMap.get(b);
      const amountX = sourceData?.amountX || 0;
      const amountY = sourceData?.amountY || 0;

      // Real proportion relative to max liquidity
      let heightPercent = 0;
      if (b > activeBinId) {
        heightPercent = (amountX / maxLiquidityVal) * 88;
      } else if (b < activeBinId) {
        heightPercent = (amountY / maxLiquidityVal) * 88;
      } else {
        heightPercent = Math.max(
          (amountX / maxLiquidityVal) * 88,
          (amountY / maxLiquidityVal) * 88,
          15
        );
      }
      // Ensure visible minimum for non-empty bins in range
      if ((amountX > 0 || amountY > 0) && heightPercent < 6) {
        heightPercent = 6;
      }

      const newShapePercent = weightMap.get(b) || 0;

      list.push({
        binId: b,
        price,
        amountX,
        amountY,
        isActive,
        isInCurrentRange,
        isEligibleForReshape,
        heightPercent: Math.min(100, Math.max(0, heightPercent)),
        newShapePercent,
      });
    }
    return list;
  }, [
    displayMinBin,
    displayMaxBin,
    binStep,
    decimalsX,
    decimalsY,
    activeBinId,
    minBinId,
    maxBinId,
    reshapeStartBin,
    hasUserPosition,
    userMap,
    marketMap,
    maxLiquidityVal,
    weightMap,
  ]);

  return (
    <div className="bg-[#101522] border border-slate-800 rounded-xl p-3 md:p-4 flex flex-col space-y-3">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center space-x-2 md:space-x-3">
          <div className={`w-2 h-2 rounded-full ${hasUserPosition ? "bg-emerald-400 animate-pulse" : "bg-cyan-400"}`}></div>
          <span className="font-semibold text-xs md:text-sm text-slate-200">
            {hasUserPosition ? "Connected LP Position Liquidity Distribution" : "Real On-Chain Liquidity Depth & Reshape Overlay"}
          </span>
          <span className="text-[10px] md:text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-300 font-mono">
            {maxBinId - minBinId + 1} bins
          </span>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-2 sm:space-x-3 text-[10px] md:text-[11px] font-mono">
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-sm bg-purple-500"></span>
            <span className="text-slate-400">{tokenXSymbol}</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-sm bg-cyan-500"></span>
            <span className="text-slate-400">{tokenYSymbol}</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-400 ring-1 ring-emerald-500/30"></span>
            <span className="text-emerald-300 font-medium">Reshape Ramp</span>
          </div>
        </div>
      </div>

      {/* Histogram Bars Container */}
      <div className="relative h-32 md:h-36 lg:h-28 flex items-end justify-between gap-0.5 px-2 bg-slate-950/70 rounded-lg p-2 overflow-x-auto lg:overflow-hidden border border-slate-900">
        {bins.map((bin) => {
          const isSelected = bin.binId >= minBinId && bin.binId <= maxBinId;
          const barColor = bin.isActive
            ? "bg-cyan-300 shadow-[0_0_12px_#00f0ff]"
            : bin.binId > activeBinId
            ? isSelected
              ? "bg-purple-600"
              : "bg-slate-800/40"
            : isSelected
            ? "bg-cyan-600"
            : "bg-slate-800/40";

          return (
            <div
              key={bin.binId}
              className="relative flex-1 h-full flex items-end group"
              title={`Bin ${bin.binId} | Price: $${formatPrice(bin.price)} | X: ${bin.amountX.toFixed(4)} | Y: ${bin.amountY.toFixed(4)}`}
            >
              {/* Real Liquidity Bar */}
              <div
                style={{ height: `${bin.heightPercent}%` }}
                className={`w-full rounded-t-sm transition-all duration-150 ${barColor}`}
              />

              {/* Reshape Preview Bar Overlay (Green Ascending Ramp) */}
              {bin.isEligibleForReshape && bin.newShapePercent > 0 && (
                <div
                  style={{ height: `${Math.min(bin.newShapePercent * 14, 95)}%` }}
                  className="absolute bottom-0 w-full bg-emerald-400/50 border-t-2 border-emerald-300 rounded-t-sm pointer-events-none transition-all duration-200"
                />
              )}

              {/* Active Bin Marker */}
              {bin.isActive && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] text-cyan-300 font-mono font-bold whitespace-nowrap bg-cyan-950 px-1 py-0.5 rounded border border-cyan-500/40 z-10">
                  ▲ NOW
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fixed Range Status Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-2 text-xs font-mono text-slate-400">
        <div className="flex items-center space-x-2">
          <span className="text-emerald-400 font-medium">Lower Bound:</span>
          <span className="text-white font-semibold">
            Bin {minBinId} (${formatPrice(getBinPrice(minBinId, binStep, decimalsX, decimalsY))})
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-cyan-400 font-medium">Active Market:</span>
          <span className="text-white font-semibold">
            Bin {activeBinId} (${formatPrice(getBinPrice(activeBinId, binStep, decimalsX, decimalsY))})
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-rose-400 font-semibold">Upper Bound:</span>
          <span className="text-white font-semibold">
            Bin {maxBinId} (${formatPrice(getBinPrice(maxBinId, binStep, decimalsX, decimalsY))})
          </span>
        </div>
      </div>
    </div>
  );
};
