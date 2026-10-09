import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  PoolInfo,
  LPPosition,
  ReshapeDistributionType,
  ReshapeScopeMode,
  OperationMode,
} from "../types";
import { formatPrice, getBinPrice } from "../utils/math";
import {
  buildAtomicReshapeTransactions,
  buildShiftRangeRebalanceTransactions,
} from "../utils/dlmm";
import {
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Wallet,
  ShieldCheck,
  Sliders,
  Target,
  RotateCcw,
  Plus,
  Minus,
} from "lucide-react";

interface ReshapePanelProps {
  poolInfo: PoolInfo;
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
  distributionType: ReshapeDistributionType;
  setDistributionType: (t: ReshapeDistributionType) => void;
  scopeMode: ReshapeScopeMode;
  setScopeMode: (s: ReshapeScopeMode) => void;
  operationMode: OperationMode;
  setOperationMode: (m: OperationMode) => void;
  shiftLowerBinId: number;
  setShiftLowerBinId: (b: number) => void;
  shiftUpperBinId: number;
  setShiftUpperBinId: (b: number) => void;
  dlmmInstance: any | null;
  activePosition?: LPPosition | null;
  onReshapeSuccess?: () => void;
}

export const ReshapePanel: React.FC<ReshapePanelProps> = ({
  poolInfo,
  activeBinId,
  minBinId,
  maxBinId,
  distributionType,
  setDistributionType,
  scopeMode,
  setScopeMode,
  operationMode,
  setOperationMode,
  shiftLowerBinId,
  setShiftLowerBinId,
  shiftUpperBinId,
  setShiftUpperBinId,
  dlmmInstance,
  activePosition,
  onReshapeSuccess,
}) => {
  const { connected, publicKey, sendTransaction } = useWallet();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Position bounds (prefer active position bounds if loaded)
  const posUpperBin = activePosition?.upperBinId ?? maxBinId;
  const posLowerBin = activePosition?.lowerBinId ?? minBinId;
  const currentWidth = Math.max(1, posUpperBin - posLowerBin + 1);

  // Price position relative to lower boundary
  const totalRange = posUpperBin - posLowerBin;
  const currentOffset = activeBinId - posLowerBin;
  const isOutOfRangeBelow = activeBinId <= posLowerBin;
  const isOutOfRangeAbove = activeBinId >= posUpperBin;

  const percentFromBottom = isOutOfRangeBelow
    ? "0.0"
    : isOutOfRangeAbove
    ? "100.0"
    : totalRange > 0
    ? ((currentOffset / totalRange) * 100).toFixed(1)
    : "0";

  const isNearEdge =
    isOutOfRangeBelow ||
    isOutOfRangeAbove ||
    Number(percentFromBottom) <= 15 ||
    Number(percentFromBottom) >= 85;

  // Determine sub-range slice boundaries for in-place mode.
  // In-place NEVER moves, cuts, or extends original [lowerBinId, upperBinId].
  const resolveRange = (lowerBin: number, upperBin: number) => {
    const outOfRange = activeBinId <= lowerBin || activeBinId >= upperBin;
    if (outOfRange || scopeMode === "full_range") {
      return { fromBinId: lowerBin, toBinId: upperBin };
    }
    if (scopeMode === "ask_slice") {
      return { fromBinId: Math.max(lowerBin, activeBinId + 1), toBinId: upperBin };
    }
    return { fromBinId: lowerBin, toBinId: Math.min(upperBin, activeBinId - 1) };
  };

  const displayRange = resolveRange(posLowerBin, posUpperBin);
  const startReshapeBin = displayRange.fromBinId;
  const targetUpperBinId = displayRange.toBinId;
  const inPlaceAffectedBinsCount = Math.max(0, targetUpperBinId - startReshapeBin + 1);

  // Range Slider boundaries and values for Shift/Recenter mode
  const sliderMin = Math.min(posLowerBin, activeBinId) - 100;
  const sliderMax = Math.max(posUpperBin, activeBinId) + 100;
  const targetShiftLower = shiftLowerBinId ?? posLowerBin;
  const targetShiftUpper = shiftUpperBinId ?? posUpperBin;
  const shiftWidth = Math.max(1, targetShiftUpper - targetShiftLower + 1);

  const targetShiftLowerPrice = getBinPrice(
    targetShiftLower,
    poolInfo.binStep,
    poolInfo.tokenX.decimals,
    poolInfo.tokenY.decimals
  );
  const targetShiftUpperPrice = getBinPrice(
    targetShiftUpper,
    poolInfo.binStep,
    poolInfo.tokenX.decimals,
    poolInfo.tokenY.decimals
  );

  const isShiftOORBelow = activeBinId < targetShiftLower;
  const isShiftOORAbove = activeBinId > targetShiftUpper;

  // Shortcut: Recenter on current active price while preserving original width
  const handleRecenterOnActive = () => {
    const half = Math.floor(currentWidth / 2);
    const newLower = activeBinId - half;
    const newUpper = newLower + currentWidth - 1;
    setShiftLowerBinId(newLower);
    setShiftUpperBinId(newUpper);
  };

  // Shortcut: Reset back to current position bounds
  const handleResetToCurrent = () => {
    setShiftLowerBinId(posLowerBin);
    setShiftUpperBinId(posUpperBin);
  };

  // Execution Handler
  const handleExecute = async () => {
    setErrorMessage(null);
    setTxSignature(null);

    if (!connected || !publicKey) {
      setErrorMessage("Please connect your Solana wallet first.");
      return;
    }

    if (!dlmmInstance) {
      setErrorMessage("DLMM pool instance not loaded. Verify RPC connection.");
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage("Locating target position on-chain...");

      let targetPosPubkey: PublicKey;
      let targetLowerBinId: number;
      let targetPosUpperBinId: number;

      if (activePosition) {
        targetPosPubkey = new PublicKey(activePosition.publicKey);
        targetLowerBinId = activePosition.lowerBinId;
        targetPosUpperBinId = activePosition.upperBinId;
      } else {
        const userPositions = await dlmmInstance.getPositionsByUserAndLbPair(publicKey);
        if (!userPositions || userPositions.userPositions.length === 0) {
          throw new Error(
            "No active LP position found for your wallet in this pool. Open a position first to reshape."
          );
        }
        const targetPos = userPositions.userPositions[0];
        targetPosPubkey = targetPos.publicKey;
        targetLowerBinId = targetPos.positionData.lowerBinId;
        targetPosUpperBinId = targetPos.positionData.upperBinId;
      }

      const connection = dlmmInstance.program.provider.connection;

      if (operationMode === "in_place") {
        // Mode A: In-Place Reshape (original bounds strictly preserved)
        const { fromBinId, toBinId } = resolveRange(targetLowerBinId, targetPosUpperBinId);
        setStatusMessage("Simulating in-place rebalance on DLMM program...");
        const { initBinArrayTx, rebalanceTx } = await buildAtomicReshapeTransactions(
          dlmmInstance,
          publicKey,
          targetPosPubkey,
          {
            fromBinId,
            toBinId,
            distributionType,
            maxActiveBinSlippage: 2,
          }
        );

        if (initBinArrayTx) {
          setStatusMessage("Initializing new bin arrays (wallet approval)...");
          const initSig = await sendTransaction(initBinArrayTx, connection);
          await connection.confirmTransaction(initSig, "confirmed");
        }

        setStatusMessage("Prompting wallet approval for in-place reshape...");
        const sig = await sendTransaction(rebalanceTx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        setTxSignature(sig);
        setStatusMessage("In-place reshape confirmed successfully!");
      } else {
        // Mode B: Shift / Recenter Range (reuses position account with new boundaries)
        setStatusMessage("Simulating range shift / recenter rebalance on DLMM program...");
        const { initBinArrayTx, rebalanceTx } = await buildShiftRangeRebalanceTransactions(
          dlmmInstance,
          publicKey,
          targetPosPubkey,
          {
            newLowerBinId: targetShiftLower,
            newUpperBinId: targetShiftUpper,
            distributionType,
            maxActiveBinSlippage: 2,
          }
        );

        if (initBinArrayTx) {
          setStatusMessage("Initializing target bin arrays (wallet approval)...");
          const initSig = await sendTransaction(initBinArrayTx, connection);
          await connection.confirmTransaction(initSig, "confirmed");
        }

        setStatusMessage("Prompting wallet approval for range rebalance...");
        const sig = await sendTransaction(rebalanceTx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        setTxSignature(sig);
        setStatusMessage("Range shift rebalance confirmed successfully!");
      }

      // Trigger automatic reload of position data
      if (onReshapeSuccess) {
        onReshapeSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to execute transaction.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#101522] border border-slate-800 rounded-xl p-4 flex flex-col space-y-3.5">
      {/* Top Header & Range Badge */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="font-semibold text-slate-200 text-sm">
            Operation Parameters
          </h3>
        </div>

        {/* Trigger Badge */}
        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium ${
            isOutOfRangeBelow || isOutOfRangeAbove
              ? "bg-rose-950/80 text-rose-300 border border-rose-500/40"
              : isNearEdge
              ? "bg-amber-950/80 text-amber-300 border border-amber-500/40"
              : "bg-slate-800 text-slate-400"
          }`}
        >
          {isOutOfRangeBelow ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>OUT OF RANGE (BELOW)</span>
            </>
          ) : isOutOfRangeAbove ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>OUT OF RANGE (ABOVE)</span>
            </>
          ) : isNearEdge ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Range: {percentFromBottom}% of span</span>
            </>
          ) : (
            <span>Range: {percentFromBottom}% of span</span>
          )}
        </div>
      </div>

      {/* Operation Mode Switch (In-Place vs Shift/Recenter) */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-400">Operation Mode:</label>
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setOperationMode("in_place")}
            className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              operationMode === "in_place"
                ? "bg-cyan-950 border border-cyan-500/50 text-cyan-300 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>In-Place Reshape</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOperationMode("shift_recenter");
              if (!shiftLowerBinId || !shiftUpperBinId) {
                setShiftLowerBinId(posLowerBin);
                setShiftUpperBinId(posUpperBin);
              }
            }}
            className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              operationMode === "shift_recenter"
                ? "bg-purple-950 border border-purple-500/50 text-purple-200 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
            <span>Shift / Recenter Range</span>
          </button>
        </div>
      </div>

      {/* Target Position Info Card */}
      {activePosition ? (
        <div className="bg-slate-950/60 rounded-lg p-3 border border-emerald-900/40 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-emerald-400 font-semibold flex items-center space-x-1">
              <Wallet className="w-3.5 h-3.5 mr-1" /> Target LP Position
            </span>
            <span className="font-mono text-slate-400 text-[11px]">
              {activePosition.publicKey.slice(0, 4)}...{activePosition.publicKey.slice(-4)}
            </span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Current Range:</span>
            <span className="font-mono text-white">
              Bin {activePosition.lowerBinId} → Bin {activePosition.upperBinId} ({currentWidth} bins total)
            </span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Holdings:</span>
            <span className="font-mono text-purple-300">
              {activePosition.totalXAmount.toFixed(4)} {poolInfo.tokenX.symbol} | {activePosition.totalYAmount.toFixed(4)} {poolInfo.tokenY.symbol}
            </span>
          </div>
        </div>
      ) : connected ? (
        <div className="bg-amber-950/30 rounded-lg p-3 border border-amber-900/40 text-xs text-amber-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>No LP position found for connected wallet in this pool.</span>
        </div>
      ) : (
        <div className="bg-slate-950/40 rounded-lg p-3 border border-slate-900 text-xs text-slate-400 flex items-center space-x-2">
          <Wallet className="w-4 h-4 flex-shrink-0 text-cyan-400" />
          <span>Connect wallet to inspect and operate on your position.</span>
        </div>
      )}

      {/* MODE A CONTROLS: In-Place Reshape */}
      {operationMode === "in_place" && (
        <>
          {/* Range Boundary Preservation Notice */}
          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800 text-xs space-y-1.5">
            <div className="flex items-center space-x-1.5 text-slate-200 font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Original Range Boundaries Preserved</span>
            </div>
            <p className="text-slate-400 text-[11px]">
              {isOutOfRangeBelow ? (
                <>
                  Price is currently below the position (<code className="text-rose-400">Bin {activeBinId} &lt; {posLowerBin}</code>). 
                  The rebalance operates across the <strong>full original range</strong> (<code className="text-cyan-300">Bin {posLowerBin}</code> to <code className="text-cyan-300">Bin {posUpperBin}</code>, {currentWidth} bins). 
                  Neither boundary is moved, cut, or extended.
                </>
              ) : isOutOfRangeAbove ? (
                <>
                  Price is currently above the position (<code className="text-rose-400">Bin {activeBinId} &gt; {posUpperBin}</code>). 
                  The rebalance operates across the <strong>full original range</strong> (<code className="text-cyan-300">Bin {posLowerBin}</code> to <code className="text-cyan-300">Bin {posUpperBin}</code>, {currentWidth} bins) with buy orders down to bottom limit.
                </>
              ) : scopeMode === "full_range" ? (
                <>
                  Price is inside range. Reshaping in <strong>Full Range</strong> redistributes both sides into a <strong>symmetric Bid-Ask V-shape</strong> centered around active bin {activeBinId}, preserving boundaries from <code className="text-cyan-300">Bin {posLowerBin}</code> to <code className="text-cyan-300">Bin {posUpperBin}</code>.
                </>
              ) : scopeMode === "ask_slice" ? (
                <>
                  Reshaping the <strong>Ask Slice</strong> ({poolInfo.tokenX.symbol}): adjusts accumulated sell orders from active bin + 1 up to <code className="text-cyan-300">Bin {posUpperBin}</code> into an ascending ramp. Bid-side tokens remain untouched.
                </>
              ) : (
                <>
                  Reshaping the <strong>Bid Slice</strong> ({poolInfo.tokenY.symbol}): adjusts accumulated buy orders from <code className="text-cyan-300">Bin {posLowerBin}</code> up to active bin - 1 into an ascending ramp toward active price. Ask-side tokens remain untouched.
                </>
              )}
            </p>
          </div>

          {/* Scope Mode Selector (when inside range) */}
          {!isOutOfRangeBelow && !isOutOfRangeAbove && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-300">Reshape Scope:</label>
              <div className="grid grid-cols-3 gap-1.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setScopeMode("full_range")}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    scopeMode === "full_range"
                      ? "bg-cyan-950/60 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500/30"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <div className="font-semibold text-[11px]">Full Range</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{currentWidth} bins</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("ask_slice")}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    scopeMode === "ask_slice"
                      ? "bg-purple-950/60 border-purple-500 text-purple-300 ring-1 ring-purple-500/30"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <div className="font-semibold text-[11px]">Ask Slice ({poolInfo.tokenX.symbol})</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{Math.max(0, posUpperBin - activeBinId)} bins</div>
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode("bid_slice")}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    scopeMode === "bid_slice"
                      ? "bg-cyan-950/60 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500/30"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <div className="font-semibold text-[11px]">Bid Slice ({poolInfo.tokenY.symbol})</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{Math.max(0, activeBinId - posLowerBin)} bins</div>
                </button>
              </div>
            </div>
          )}

          {/* Target Sub-Range Details */}
          <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-900 space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Target Bins:</span>
              <span className="font-mono text-cyan-300">
                Bin {startReshapeBin} → Bin {targetUpperBinId} ({inPlaceAffectedBinsCount} bins)
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Price Span:</span>
              <span className="font-mono text-slate-200">
                {formatPrice(getBinPrice(startReshapeBin, poolInfo.binStep, poolInfo.tokenX.decimals, poolInfo.tokenY.decimals))} → 
                {formatPrice(getBinPrice(targetUpperBinId, poolInfo.binStep, poolInfo.tokenX.decimals, poolInfo.tokenY.decimals))} {poolInfo.tokenY.symbol}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Target Token:</span>
              <span className="font-mono text-purple-400">
                {isOutOfRangeBelow || scopeMode === "ask_slice"
                  ? `100% ${poolInfo.tokenX.symbol} (Ask Side)`
                  : isOutOfRangeAbove || scopeMode === "bid_slice"
                  ? `100% ${poolInfo.tokenY.symbol} (Bid Side)`
                  : `Both (${poolInfo.tokenX.symbol} & ${poolInfo.tokenY.symbol})`}
              </span>
            </div>
          </div>
        </>
      )}

      {/* MODE B CONTROLS: Shift / Recenter Range */}
      {operationMode === "shift_recenter" && (
        <div className="space-y-3">
          {/* Shift / Recenter Notice */}
          <div className="bg-purple-950/30 rounded-lg p-3 border border-purple-800/40 text-xs space-y-1.5">
            <div className="flex items-center space-x-1.5 text-purple-200 font-semibold">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span>Native Range Shift / Roll Position</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Uses DLMM's native <code className="text-purple-300">rebalance_liquidity</code> instruction. Your existing position account is <strong>reused directly</strong> (no burning or new NFT). The program resizes the account and refunds/charges the rent difference automatically.
            </p>
          </div>

          {/* Quick Action Presets */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleRecenterOnActive}
              className="py-2 px-2.5 rounded-lg bg-purple-900/40 hover:bg-purple-900/60 border border-purple-700/50 text-purple-200 text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors"
              title="Center current width around current active bin"
            >
              <Target className="w-3.5 h-3.5 text-purple-400" />
              <span>Recenter on Active Bin</span>
            </button>

            <button
              type="button"
              onClick={handleResetToCurrent}
              className="py-2 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors"
              title="Reset slider to existing on-chain range"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset to Current</span>
            </button>
          </div>

          {/* Slider 1: Lower Bin Bound */}
          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-900 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-emerald-400 flex items-center space-x-1">
                <span>New Lower Bound</span>
              </span>
              <span className="font-mono text-slate-200">
                {formatPrice(targetShiftLowerPrice)} {poolInfo.tokenY.symbol}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShiftLowerBinId(Math.min(targetShiftLower - 1, targetShiftUpper - 1))}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <input
                type="range"
                min={sliderMin}
                max={Math.min(sliderMax - 1, targetShiftUpper - 1)}
                value={targetShiftLower}
                onChange={(e) =>
                  setShiftLowerBinId(Math.min(Number(e.target.value), targetShiftUpper - 1))
                }
                className="flex-1 accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />

              <button
                type="button"
                onClick={() => setShiftLowerBinId(Math.min(targetShiftLower + 1, targetShiftUpper - 1))}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              <div className="w-16 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-right font-mono text-xs text-emerald-400 font-semibold">
                {targetShiftLower}
              </div>
            </div>
          </div>

          {/* Slider 2: Upper Bin Bound */}
          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-900 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-rose-400 flex items-center space-x-1">
                <span>New Upper Bound</span>
              </span>
              <span className="font-mono text-slate-200">
                {formatPrice(targetShiftUpperPrice)} {poolInfo.tokenY.symbol}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShiftUpperBinId(Math.max(targetShiftUpper - 1, targetShiftLower + 1))}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>

              <input
                type="range"
                min={Math.max(sliderMin + 1, targetShiftLower + 1)}
                max={sliderMax}
                value={targetShiftUpper}
                onChange={(e) =>
                  setShiftUpperBinId(Math.max(Number(e.target.value), targetShiftLower + 1))
                }
                className="flex-1 accent-rose-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />

              <button
                type="button"
                onClick={() => setShiftUpperBinId(Math.max(targetShiftUpper + 1, targetShiftLower + 1))}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              <div className="w-16 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-right font-mono text-xs text-rose-400 font-semibold">
                {targetShiftUpper}
              </div>
            </div>
          </div>

          {/* Shift Plan Summary Card */}
          <div className="bg-slate-950/50 rounded-lg p-3 border border-purple-900/30 space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Proposed Range:</span>
              <span className="font-mono text-purple-300">
                Bin {targetShiftLower} → Bin {targetShiftUpper} ({shiftWidth} bins total)
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Width Delta:</span>
              <span className="font-mono text-slate-200">
                {shiftWidth === currentWidth
                  ? "0 bins (same width)"
                  : shiftWidth > currentWidth
                  ? `+${shiftWidth - currentWidth} bins (expanding)`
                  : `-${currentWidth - shiftWidth} bins (narrowing)`}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Price Span:</span>
              <span className="font-mono text-slate-200">
                {formatPrice(targetShiftLowerPrice)} → {formatPrice(targetShiftUpperPrice)} {poolInfo.tokenY.symbol}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Active Price Status:</span>
              <span className="font-mono">
                {isShiftOORBelow ? (
                  <span className="text-amber-400">Price Below Range (Deposits 100% {poolInfo.tokenX.symbol})</span>
                ) : isShiftOORAbove ? (
                  <span className="text-amber-400">Price Above Range (Deposits 100% {poolInfo.tokenY.symbol})</span>
                ) : (
                  <span className="text-emerald-400">Inside Range (Active Bin {activeBinId})</span>
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reshape Shape Selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-300">
          Distribution Shape:
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDistributionType("triangular")}
            className={`p-2.5 rounded-lg text-xs font-medium border text-left transition-all ${
              distributionType === "triangular"
                ? "bg-cyan-950/60 border-cyan-500 text-cyan-300 shadow-sm"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            <div className="font-semibold text-emerald-400">Ascending Triangle</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Min Near Active → Max At Far End</div>
          </button>

          <button
            type="button"
            onClick={() => setDistributionType("spot")}
            className={`p-2.5 rounded-lg text-xs font-medium border text-left transition-all ${
              distributionType === "spot"
                ? "bg-cyan-950/60 border-cyan-500 text-cyan-300 shadow-sm"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            <div className="font-semibold text-cyan-400">Uniform Spot</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Equal Tokens Across Bins</div>
          </button>
        </div>
      </div>

      {/* Status or Error Notifications */}
      {statusMessage && (
        <div className="bg-cyan-950/40 border border-cyan-800/60 rounded-lg p-3 text-xs text-cyan-300 flex items-center space-x-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-3 text-xs text-rose-300 flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {txSignature && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-3 text-xs text-emerald-300 flex items-start justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>Transaction confirmed on-chain!</span>
          </div>
          <a
            href={`https://solscan.io/tx/${txSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline flex items-center hover:text-cyan-300 ml-2"
          >
            <span>Solscan</span>
            <ArrowUpRight className="w-3 h-3 ml-0.5" />
          </a>
        </div>
      )}

      {/* Action Button */}
      <button
        type="button"
        disabled={
          isSubmitting ||
          !activePosition ||
          (operationMode === "in_place" ? inPlaceAffectedBinsCount === 0 : shiftWidth === 0)
        }
        onClick={handleExecute}
        className={`w-full font-bold py-3 px-4 rounded-lg text-sm transition-all shadow-lg disabled:opacity-50 flex items-center justify-center space-x-2 ${
          operationMode === "in_place"
            ? "bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-cyan-950/40"
            : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white shadow-purple-950/40"
        }`}
      >
        {isSubmitting ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>
              {operationMode === "in_place"
                ? "Executing In-Place Reshape..."
                : "Executing Range Rebalance..."}
            </span>
          </>
        ) : (
          <span>
            {operationMode === "in_place"
              ? activePosition
                ? `Execute In-Place Reshape (${inPlaceAffectedBinsCount} Bins)`
                : "Execute In-Place Reshape"
              : activePosition
              ? `Execute Range Rebalance (${shiftWidth} Bins)`
              : "Execute Range Rebalance"}
          </span>
        )}
      </button>

      {!activePosition && connected && (
        <p className="text-[11px] text-slate-500 text-center">
          Waiting for your LP position to load before proceeding…
        </p>
      )}
    </div>
  );
};
