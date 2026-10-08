import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { PoolInfo, LPPosition, ReshapeDistributionType, ReshapeScopeMode } from "../types";
import { formatPrice, getBinPrice } from "../utils/math";
import { buildAtomicReshapeTransactions } from "../utils/dlmm";
import { ArrowUpRight, CheckCircle2, AlertTriangle, RefreshCw, Layers, Wallet, ShieldCheck } from "lucide-react";

interface ReshapePanelProps {
  poolInfo: PoolInfo;
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
  distributionType: ReshapeDistributionType;
  setDistributionType: (t: ReshapeDistributionType) => void;
  scopeMode: ReshapeScopeMode;
  setScopeMode: (s: ReshapeScopeMode) => void;
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

  // Determine sub-range slice boundaries for a given position range.
  // A reshape NEVER moves, cuts, or extends the position's [lowerBinId, upperBinId]
  // boundaries — a slice only selects a sub-range whose distribution gets reshaped.
  const resolveRange = (lowerBin: number, upperBin: number) => {
    const outOfRange = activeBinId <= lowerBin || activeBinId >= upperBin;
    if (outOfRange || scopeMode === "full_range") {
      return { fromBinId: lowerBin, toBinId: upperBin };
    }
    if (scopeMode === "ask_slice") {
      // Ask slice (Token X / sell orders) from activeBin + 1 to upper limit
      return { fromBinId: Math.max(lowerBin, activeBinId + 1), toBinId: upperBin };
    }
    // bid_slice: Bid slice (Token Y / buy orders) from lower limit to activeBin - 1
    return { fromBinId: lowerBin, toBinId: Math.min(upperBin, activeBinId - 1) };
  };

  // Display range (may be based on not-yet-loaded state — execution below
  // always re-resolves from the actual on-chain position bounds).
  const displayRange = resolveRange(posLowerBin, posUpperBin);
  const startReshapeBin = displayRange.fromBinId;
  const targetUpperBinId = displayRange.toBinId;

  const affectedBinsCount = Math.max(0, targetUpperBinId - startReshapeBin + 1);

  const handleExecuteReshape = async () => {
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

      // Re-resolve the reshape range from the ACTUAL on-chain position bounds —
      // never from component state, which may still be zeroed while loading.
      // (buildAtomicReshapeTransactions also validates this range.)
      const { fromBinId, toBinId } = resolveRange(targetLowerBinId, targetPosUpperBinId);

      setStatusMessage("Simulating atomic rebalance on DLMM program...");
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

      const connection = dlmmInstance.program.provider.connection;

      if (initBinArrayTx) {
        setStatusMessage("Initializing new bin arrays (wallet approval)...");
        const initSig = await sendTransaction(initBinArrayTx, connection);
        await connection.confirmTransaction(initSig, "confirmed");
      }

      setStatusMessage("Prompting wallet approval for reshape...");
      const sig = await sendTransaction(rebalanceTx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setTxSignature(sig);
      setStatusMessage("Transaction confirmed successfully!");

      // Trigger automatic reload of position data
      if (onReshapeSuccess) {
        onReshapeSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to execute atomic reshape transaction.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#101522] border border-slate-800 rounded-xl p-4 flex flex-col space-y-3.5">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="font-semibold text-slate-200 text-sm">
            Atomic Reshape Parameters
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
            <span>Position Range:</span>
            <span className="font-mono text-white">
              Bin {activePosition.lowerBinId} → Bin {activePosition.upperBinId} ({activePosition.upperBinId - activePosition.lowerBinId + 1} bins total)
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
          <span>Connect wallet to inspect and reshape your position.</span>
        </div>
      )}

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
              The rebalance operates across the <strong>full original range</strong> (<code className="text-cyan-300">Bin {posLowerBin}</code> to <code className="text-cyan-300">Bin {posUpperBin}</code>, {posUpperBin - posLowerBin + 1} bins). 
              Neither boundary is moved, cut, or extended.
            </>
          ) : isOutOfRangeAbove ? (
            <>
              Price is currently above the position (<code className="text-rose-400">Bin {activeBinId} &gt; {posUpperBin}</code>). 
              The rebalance operates across the <strong>full original range</strong> (<code className="text-cyan-300">Bin {posLowerBin}</code> to <code className="text-cyan-300">Bin {posUpperBin}</code>, {posUpperBin - posLowerBin + 1} bins) with buy orders down to bottom limit.
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

      {/* Scope Mode Selector (when inside range): Complete 3 choices */}
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
              <div className="text-[10px] text-slate-400 mt-0.5">{posUpperBin - posLowerBin + 1} bins</div>
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
            Bin {startReshapeBin} → Bin {targetUpperBinId} ({affectedBinsCount} bins)
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

      {/* Reshape Shape Selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-300">
          New Distribution Shape:
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
            <span>Reshape confirmed on-chain!</span>
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
        disabled={isSubmitting || !activePosition || affectedBinsCount === 0}
        onClick={handleExecuteReshape}
        className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold py-3 px-4 rounded-lg text-sm transition-all shadow-lg shadow-cyan-950/40 disabled:opacity-50 flex items-center justify-center space-x-2"
      >
        {isSubmitting ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
            <span>Executing Atomic Reshape...</span>
          </>
        ) : (
          <span>
            {activePosition
              ? `Execute Atomic Reshape (${affectedBinsCount} Bins)`
              : "Execute Atomic Reshape"}
          </span>
        )}
      </button>
      {!activePosition && connected && (
        <p className="text-[11px] text-slate-500 text-center">
          Waiting for your LP position to load before reshaping…
        </p>
      )}
    </div>
  );
};
