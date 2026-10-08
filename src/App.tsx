import React, { useState, useEffect, useCallback } from "react";
import { Connection } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Navbar } from "./components/Navbar";
import { CandlestickChart } from "./components/CandlestickChart";
import { BinHistogram } from "./components/BinHistogram";
import { ReshapePanel } from "./components/ReshapePanel";
import { PoolInfo, OHLCVBar, LPPosition, ReshapeDistributionType, ReshapeScopeMode, UserPoolPosition } from "./types";
import {
  fetchPoolInfo,
  fetchUserPositions,
  scanAllUserPositions,
  DEFAULT_RPC_ENDPOINT,
} from "./utils/dlmm";
import { fetchPoolOHLCV } from "./utils/ohlcv";
import { formatPrice } from "./utils/math";
import {
  Info,
  HelpCircle,
  Wallet,
  Layers,
  ChevronRight,
  RefreshCw,
  Search,
  ExternalLink,
  SlidersHorizontal,
  GripHorizontal,
} from "lucide-react";

export const App: React.FC = () => {
  const { connected, publicKey } = useWallet();

  const [rpcEndpoint, setRpcEndpoint] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("meteora_rpc");
      if (
        saved &&
        (saved.includes("publicnode") ||
          saved.includes("allnodes") ||
          saved.includes("api.mainnet-beta.solana.com"))
      ) {
        localStorage.removeItem("meteora_rpc");
        return "";
      }
      return saved || "";
    } catch {
      return "";
    }
  });

  // Effective RPC endpoint for queries (fallback to standard RPC for public view if needed)
  const activeRpcUrl = rpcEndpoint || "https://api.mainnet-beta.solana.com";

  // Flow State (initialize from ?pair= or ?pool= URL query parameter)
  const [selectedPoolAddress, setSelectedPoolAddress] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("pair") || params.get("pool") || null;
    } catch {
      return null;
    }
  });
  const [targetPositionPubkey, setTargetPositionPubkey] = useState<string | null>(null);

  // Sync current pool address with the URL query parameter (?pair=xxxxxx)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedPoolAddress) {
      if (url.searchParams.get("pair") !== selectedPoolAddress) {
        url.searchParams.set("pair", selectedPoolAddress);
        url.searchParams.delete("pool");
        window.history.replaceState({}, "", url.toString());
      }
    } else {
      if (url.searchParams.has("pair") || url.searchParams.has("pool")) {
        url.searchParams.delete("pair");
        url.searchParams.delete("pool");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [selectedPoolAddress]);

  // Listen to browser navigation (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const pair = params.get("pair") || params.get("pool") || null;
        setSelectedPoolAddress(pair);
      } catch {
        // ignore
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Scanned Positions across all Meteora DLMM pools
  const [scannedPositions, setScannedPositions] = useState<UserPoolPosition[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Manual fallback input
  const [manualPoolInput, setManualPoolInput] = useState<string>("");

  // Pool & Workspace Data
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [dlmmInstance, setDlmmInstance] = useState<any | null>(null);
  const [bars, setBars] = useState<OHLCVBar[]>([]);
  const [isLoadingPool, setIsLoadingPool] = useState<boolean>(false);

  // Active Position State
  const [userPositions, setUserPositions] = useState<LPPosition[]>([]);
  const [activePosition, setActivePosition] = useState<LPPosition | null>(null);

  // Range State (binId)
  const [activeBinId, setActiveBinId] = useState<number>(0);
  const [minBinId, setMinBinId] = useState<number>(0);
  const [maxBinId, setMaxBinId] = useState<number>(0);

  // Strategy Reshape State
  const [distributionType, setDistributionType] =
    useState<ReshapeDistributionType>("triangular");
  const [scopeMode, setScopeMode] = useState<ReshapeScopeMode>("full_range");
  const [minWeight, setMinWeight] = useState<number>(200);
  const [maxWeight, setMaxWeight] = useState<number>(2000);

  // 1. Scan user positions whenever wallet connects
  // Vertical drag resize state for chart vs histogram on desktop
  const [chartFlexHeight, setChartFlexHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("meteora_chart_h");
      if (saved) return Number(saved);
    } catch {
      // ignore
    }
    return 360; // default px on desktop
  });
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);

  // Resize drag handlers
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Find container top or use clientY relative delta
      const chartElement = document.getElementById("candlestick-chart-panel");
      if (chartElement) {
        const rect = chartElement.getBoundingClientRect();
        const newHeight = Math.max(180, Math.min(750, e.clientY - rect.top));
        setChartFlexHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
      try {
        localStorage.setItem("meteora_chart_h", String(chartFlexHeight));
      } catch {
        // ignore
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSplitter, chartFlexHeight]);

  const handleScanPositions = useCallback(async () => {
    if (!connected || !publicKey) {
      setScannedPositions([]);
      return;
    }

    setIsScanning(true);
    setScanError(null);
    try {
      const conn = new Connection(activeRpcUrl, "confirmed");
      console.log("Scanning on-chain positions for wallet:", publicKey.toBase58());
      const found = await scanAllUserPositions(conn, publicKey);
      setScannedPositions(found);
      console.log("Found LP positions:", found);
    } catch (err: any) {
      console.error("Scan error:", err);
      setScanError(err.message || "Failed to scan wallet positions via RPC.");
    } finally {
      setIsScanning(false);
    }
  }, [connected, publicKey, activeRpcUrl]);

  useEffect(() => {
    if (connected && publicKey) {
      handleScanPositions();
    } else {
      setScannedPositions([]);
      setSelectedPoolAddress(null);
      setTargetPositionPubkey(null);
      setPoolInfo(null);
      setDlmmInstance(null);
      setActivePosition(null);
    }
  }, [connected, publicKey, handleScanPositions]);

  // 2. Fetch specific user positions for loaded pool
  const refreshUserPositions = useCallback(async () => {
    if (!dlmmInstance || !publicKey) {
      setUserPositions([]);
      setActivePosition(null);
      return;
    }
    try {
      const positions = await fetchUserPositions(dlmmInstance, publicKey);
      setUserPositions(positions);
      if (positions.length > 0) {
        // Find matching position if targetPositionPubkey was selected
        const matched = targetPositionPubkey
          ? positions.find((p) => p.publicKey === targetPositionPubkey) || positions[0]
          : positions[0];

        setActivePosition(matched);
        setMinBinId(matched.lowerBinId);
        setMaxBinId(matched.upperBinId);
      } else {
        setActivePosition(null);
      }
    } catch (err) {
      console.error("Error fetching user positions in pool:", err);
    }
  }, [dlmmInstance, publicKey, targetPositionPubkey]);

  useEffect(() => {
    refreshUserPositions();
  }, [refreshUserPositions]);

  // 3. Load Pool Workspace
  const loadPoolWorkspace = useCallback(
    async (poolAddr: string, silent = false) => {
      if (!poolAddr) return;
      if (!silent) setIsLoadingPool(true);
      try {
        const connection = new Connection(activeRpcUrl, "confirmed");
        const { pool, info } = await fetchPoolInfo(connection, poolAddr);

        setDlmmInstance(pool);
        setPoolInfo(info);
        setActiveBinId(info.activeBinId);

        // Load 30m OHLCV bars
        const candleBars = await fetchPoolOHLCV(poolAddr, info.currentPrice);
        setBars(candleBars);
      } catch (err: any) {
        console.error("Failed to load pool workspace:", err);
        if (!silent) {
          alert(`Failed to load pool: ${err.message || err}`);
        }
      } finally {
        if (!silent) setIsLoadingPool(false);
      }
    },
    [activeRpcUrl]
  );

  // Trigger loading pool workspace when selectedPoolAddress changes
  useEffect(() => {
    if (selectedPoolAddress) {
      loadPoolWorkspace(selectedPoolAddress);
    }
  }, [selectedPoolAddress, loadPoolWorkspace]);

  // Auto-refresh interval (45s) for loaded pool workspace
  useEffect(() => {
    if (!selectedPoolAddress) return;
    const interval = setInterval(() => {
      loadPoolWorkspace(selectedPoolAddress, true);
      refreshUserPositions();
    }, 45000);
    return () => clearInterval(interval);
  }, [selectedPoolAddress, loadPoolWorkspace, refreshUserPositions]);

  // Handlers
  const handleSelectPosition = (pos: UserPoolPosition) => {
    setSelectedPoolAddress(pos.poolAddress);
    setTargetPositionPubkey(pos.positionPublicKey);
  };

  const handleManualPoolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPoolInput.trim()) {
      setSelectedPoolAddress(manualPoolInput.trim());
      setTargetPositionPubkey(null);
    }
  };

  const handleRpcChange = (newRpc: string) => {
    const cleanRpc = newRpc.trim();
    setRpcEndpoint(cleanRpc);
    localStorage.setItem("meteora_rpc", cleanRpc);
    if (selectedPoolAddress) {
      loadPoolWorkspace(selectedPoolAddress);
    }
  };

  const binStep = poolInfo?.binStep || 20;
  const decimalsX = poolInfo?.tokenX.decimals || 9;
  const decimalsY = poolInfo?.tokenY.decimals || 6;

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0b0e14] text-slate-100 overflow-x-hidden lg:overflow-hidden">
      <Navbar
        poolAddress={selectedPoolAddress || ""}
        onLoadPool={(addr) => {
          setSelectedPoolAddress(addr);
          setTargetPositionPubkey(null);
        }}
        rpcEndpoint={rpcEndpoint}
        onChangeRpcEndpoint={handleRpcChange}
        isLoading={isLoadingPool}
      />

      <main className="flex-1 w-full max-w-[1700px] mx-auto p-3 md:p-4 overflow-y-visible lg:overflow-hidden flex flex-col min-h-0">
        {/* STEP 1: WALLET NOT CONNECTED GATEWAY */}
        {!connected && (
          <div className="min-h-[500px] flex flex-col items-center justify-center text-center px-4 py-16 bg-[#101522]/60 border border-slate-800/80 rounded-2xl backdrop-blur-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" />

            <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border border-cyan-800 flex items-center justify-center mb-6 shadow-xl shadow-cyan-950/50">
              <Wallet className="w-8 h-8 text-cyan-400" />
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-3">
              Connect Wallet to Scan DLMM Positions
            </h1>
            <p className="text-slate-400 text-sm max-w-md mb-8">
              Connect your Solana wallet to automatically scan your active Meteora DLMM LP positions and rebalance liquidity with atomic reshape.
            </p>

            <div className="scale-110 mb-8">
              <WalletMultiButton />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full text-left text-xs text-slate-400 mt-6 pt-6 border-t border-slate-800/60">
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                <div className="font-semibold text-slate-200 mb-1">⚡ Auto Detection</div>
                <span>Scans on-chain DLMM positions directly from Solana RPC in &lt; 300ms.</span>
              </div>
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                <div className="font-semibold text-slate-200 mb-1">🛡️ Preserves Range</div>
                <span>Zero range expansion or cuts. Original lower and upper boundaries stay locked.</span>
              </div>
              <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-800">
                <div className="font-semibold text-slate-200 mb-1">🔺 Ascending Triangle</div>
                <span>Atomically reshape Token X single-sided liquidity into an upward slope.</span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: WALLET CONNECTED BUT NO POSITION SELECTED YET */}
        {connected && !selectedPoolAddress && (
          <div className="bg-[#101522] border border-slate-800 rounded-2xl p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  <span>Select Active LP Position</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Connected: <span className="font-mono text-cyan-300">{publicKey?.toBase58()}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={handleScanPositions}
                disabled={isScanning}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg font-medium transition-colors flex items-center space-x-1.5 self-start md:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? "animate-spin text-cyan-400" : ""}`} />
                <span>Re-scan Wallet</span>
              </button>
            </div>

            {/* Scanning Indicator */}
            {isScanning && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
                <span className="text-xs font-mono text-slate-400">
                  Scanning Meteora DLMM program accounts on Solana...
                </span>
              </div>
            )}

            {/* Scan Error Notice */}
            {scanError && !isScanning && (
              <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-xs text-rose-300">
                <span className="font-semibold">RPC Notice:</span> {scanError}
              </div>
            )}

            {/* Position List Selection */}
            {!isScanning && scannedPositions.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-300">
                  Found {scannedPositions.length} Active Position{scannedPositions.length > 1 ? "s" : ""}:
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {scannedPositions.map((pos) => (
                    <button
                      key={pos.positionPublicKey}
                      type="button"
                      onClick={() => handleSelectPosition(pos)}
                      className="group bg-slate-950/70 hover:bg-slate-900/90 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-4 text-left transition-all duration-200 flex items-center justify-between shadow-md"
                    >
                      <div className="space-y-2 flex-1 pr-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white text-sm group-hover:text-cyan-300 transition-colors">
                            {pos.pairName}
                          </span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 font-mono px-2 py-0.5 rounded">
                            {pos.poolAddress.slice(0, 4)}...{pos.poolAddress.slice(-4)}
                          </span>
                        </div>

                        <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
                          <span>
                            Range: Bin {pos.lowerBinId} → Bin {pos.upperBinId}
                          </span>
                          <span>&bull;</span>
                          <span className="text-slate-300 font-semibold">
                            {pos.upperBinId - pos.lowerBinId + 1} Bins
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 font-mono">
                          Position: {pos.positionPublicKey.slice(0, 6)}...{pos.positionPublicKey.slice(-6)}
                        </div>
                      </div>

                      <div className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-cyan-500 text-slate-400 group-hover:text-slate-950 flex items-center justify-center transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty Positions Fallback */}
            {!isScanning && scannedPositions.length === 0 && (
              <div className="text-center py-8 space-y-4">
                <div className="text-slate-400 text-xs">
                  No active DLMM positions found in this wallet.
                </div>
                <div className="max-w-md mx-auto pt-2">
                  <form onSubmit={handleManualPoolSubmit} className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Paste DLMM Pool Address manually..."
                      value={manualPoolInput}
                      onChange={(e) => setManualPoolInput(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="submit"
                      className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs"
                    >
                      Open Pool
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 & 4: MAIN INTERFACE (LOADED POSITION / POOL) */}
        {connected && selectedPoolAddress && (
          <div className="flex-1 flex flex-col min-h-0 space-y-3">
            {/* Position Switcher & Pool Header Bar */}
            <div className="bg-[#101522] border border-slate-800 rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              <div className="flex items-center space-x-3">
                {poolInfo && (
                  <div className="flex -space-x-2 overflow-hidden">
                    <div className="inline-block h-7 w-7 rounded-full ring-2 ring-slate-900 bg-purple-600 flex items-center justify-center font-bold text-xs">
                      {poolInfo.tokenX.symbol.slice(0, 3)}
                    </div>
                    <div className="inline-block h-7 w-7 rounded-full ring-2 ring-slate-900 bg-cyan-600 flex items-center justify-center font-bold text-xs">
                      {poolInfo.tokenY.symbol.slice(0, 3)}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-white">
                      {poolInfo ? `${poolInfo.tokenX.symbol} / ${poolInfo.tokenY.symbol}` : "Loading Pool..."}
                    </h2>
                    {poolInfo && (
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                        Step: {poolInfo.binStep} bps
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
                    <span>Pool: {selectedPoolAddress.slice(0, 4)}...{selectedPoolAddress.slice(-4)}</span>
                    <a
                      href={`https://app.meteora.ag/dlmm/${selectedPoolAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 flex items-center space-x-0.5"
                    >
                      <span>Meteora</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Pool Metrics & Switch Position Button */}
              <div className="flex items-center space-x-5 text-xs font-mono">
                {poolInfo && (
                  <>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Price</span>
                      <span className="text-white text-sm font-bold">
                        {formatPrice(poolInfo.currentPrice)} {poolInfo.tokenY.symbol}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px]">Active Bin</span>
                      <span className="text-cyan-300 text-sm font-bold">
                        {activeBinId}
                      </span>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    if (selectedPoolAddress) {
                      await loadPoolWorkspace(selectedPoolAddress);
                      await refreshUserPositions();
                    }
                  }}
                  disabled={isLoadingPool}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-sans font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                  title="Refresh pool price, active bin, candles, and user LP position"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoadingPool ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedPoolAddress(null);
                    setTargetPositionPubkey(null);
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-sans font-medium flex items-center space-x-1 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Switch Position</span>
                </button>
              </div>
            </div>

            {/* Core Workspace: Chart + Bins on Left, Reshape on Right */}
            <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-3 min-h-0">
              {/* Left Column (Chart & Bins) */}
              <div className="lg:col-span-8 flex flex-col space-y-2.5 min-h-0">
                {/* Candlestick Chart 15m */}
                <div
                  id="candlestick-chart-panel"
                  style={{
                    height: window.innerWidth >= 1024 ? `${chartFlexHeight}px` : "340px",
                  }}
                  className="w-full bg-[#101522] border border-slate-800 rounded-xl p-3 flex flex-col flex-shrink-0 lg:flex-shrink transition-[height] duration-75"
                >
                  <div className="flex items-center justify-between pb-2 mb-1 border-b border-slate-800 flex-shrink-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-xs text-slate-200">
                        Price Action ({poolInfo?.tokenX.symbol || "Token"} / {poolInfo?.tokenY.symbol || "Quote"})
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                      <span className="bg-cyan-950 text-cyan-300 border border-cyan-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                        15m
                      </span>
                      <span className="text-emerald-400">Boundaries Locked</span>
                    </div>
                  </div>

                  <div className="w-full flex-1 min-h-0 relative">
                    <CandlestickChart
                      bars={bars}
                      binStep={binStep}
                      decimalsX={decimalsX}
                      decimalsY={decimalsY}
                      activeBinId={activeBinId}
                      minBinId={minBinId}
                      maxBinId={maxBinId}
                      tokenYSymbol={poolInfo?.tokenY.symbol || "SOL"}
                    />
                  </div>
                </div>

                {/* Vertical Splitter / Drag Handle (Desktop only) */}
                <div
                  onMouseDown={handleSplitterMouseDown}
                  className={`hidden lg:flex items-center justify-center py-1 cursor-row-resize select-none group transition-colors rounded ${
                    isDraggingSplitter ? "bg-cyan-500/20" : "hover:bg-slate-800/60"
                  }`}
                  title="Drag vertically to resize Candlestick Chart vs Bin Histogram"
                >
                  <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 group-hover:text-cyan-400 font-mono transition-colors">
                    <GripHorizontal className="w-4 h-4" />
                    <span className="text-[9px] tracking-wider uppercase font-semibold">Drag to Resize View</span>
                    <GripHorizontal className="w-4 h-4" />
                  </div>
                </div>

                {/* Real On-Chain Bin Histogram & Reshape Overlay */}
                <div className="flex-1 min-h-0 overflow-y-visible lg:overflow-y-auto">
                  <BinHistogram
                    binStep={binStep}
                    decimalsX={decimalsX}
                    decimalsY={decimalsY}
                    tokenXSymbol={poolInfo?.tokenX.symbol || "X"}
                    tokenYSymbol={poolInfo?.tokenY.symbol || "Y"}
                    activeBinId={activeBinId}
                    minBinId={minBinId}
                    maxBinId={maxBinId}
                    marketBins={poolInfo?.marketBins}
                    userBins={activePosition?.bins}
                    distributionType={distributionType}
                    scopeMode={scopeMode}
                    minWeight={minWeight}
                    maxWeight={maxWeight}
                  />
                </div>
              </div>

              {/* Right Column (Reshape Controls & Information) */}
              <div className="lg:col-span-4 flex flex-col space-y-3 overflow-y-visible lg:overflow-y-auto pr-0 lg:pr-1">
                {poolInfo && (
                  <ReshapePanel
                    poolInfo={poolInfo}
                    activeBinId={activeBinId}
                    minBinId={minBinId}
                    maxBinId={maxBinId}
                    distributionType={distributionType}
                    setDistributionType={setDistributionType}
                    scopeMode={scopeMode}
                    setScopeMode={setScopeMode}
                    minWeight={minWeight}
                    setMinWeight={setMinWeight}
                    maxWeight={maxWeight}
                    setMaxWeight={setMaxWeight}
                    dlmmInstance={dlmmInstance}
                    activePosition={activePosition}
                    onReshapeSuccess={refreshUserPositions}
                  />
                )}

                {/* Strategy Reference Box */}
                <div className="bg-[#101522] border border-slate-800 rounded-xl p-3 space-y-2 text-xs text-slate-400">
                  <div className="flex items-center space-x-2 text-slate-200 font-semibold">
                    <HelpCircle className="w-4 h-4 text-cyan-400" />
                    <span>How Reshaping Works</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Reshaping withdraws your existing liquidity and redeposits it atomically in a single Solana transaction.
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-300">
                    <li>Smooths out liquidity into ascending/descending ramps.</li>
                    <li>Preserves original lower and upper boundaries (zero cuts).</li>
                    <li>Guarantees identical position bin boundaries on-chain.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-2.5 px-4 text-center text-[11px] text-slate-500 border-t border-slate-800/80 bg-[#090d15] flex-shrink-0">
        Meteora DLMM LP Reshaper &bull; Built with @meteora-ag/dlmm &amp; Lightweight Charts
      </footer>
    </div>
  );
};
