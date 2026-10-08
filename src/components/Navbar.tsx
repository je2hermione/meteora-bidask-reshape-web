import React, { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Search, Activity, ExternalLink } from "lucide-react";

interface NavbarProps {
  poolAddress: string;
  onLoadPool: (address: string) => void;
  rpcEndpoint: string;
  onChangeRpcEndpoint: (rpc: string) => void;
  isLoading: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  poolAddress,
  onLoadPool,
  rpcEndpoint,
  onChangeRpcEndpoint,
  isLoading,
}) => {
  const [inputAddress, setInputAddress] = useState(poolAddress);
  const [showRpcConfig, setShowRpcConfig] = useState(false);
  const [customRpc, setCustomRpc] = useState(rpcEndpoint);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputAddress.trim()) {
      onLoadPool(inputAddress.trim());
    }
  };

  return (
    <header className="border-b border-slate-800 bg-[#0d121c]/90 backdrop-blur sticky top-0 z-30 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Brand & Subtitle */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-md shadow-cyan-500/20">
              M
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-slate-100 tracking-wide">
                  Meteora DLMM Reshape
                </span>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-1.5 py-0.5 rounded font-mono">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                sewon.online LP strategy manager
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 md:hidden">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-[11px] text-slate-400 font-mono">Solana</span>
          </div>
        </div>

        {/* Pool Input Search */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 max-w-xl w-full flex items-center space-x-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Paste DLMM Pool Address (e.g. ARwi1S...)"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              className="w-full bg-slate-900/90 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center space-x-1"
          >
            {isLoading ? (
              <Activity className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <span>Load</span>
            )}
          </button>
        </form>

        {/* Status & Wallet Button */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRpcConfig(!showRpcConfig)}
              className={`flex items-center space-x-1.5 border px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                rpcEndpoint
                  ? "bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300"
                  : "bg-amber-950/80 hover:bg-amber-900/80 border-amber-500 text-amber-200 animate-pulse"
              }`}
              title="Configure Solana RPC"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  rpcEndpoint ? "bg-emerald-400" : "bg-amber-400"
                } animate-pulse`}
              ></span>
              <span className="max-w-[130px] truncate">
                {rpcEndpoint
                  ? rpcEndpoint.replace("https://", "").replace("http://", "")
                  : "Set RPC Endpoint"}
              </span>
            </button>

            {showRpcConfig && (
              <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-700 shadow-2xl rounded-xl p-3 z-50 text-xs font-sans">
                <div className="font-semibold text-slate-200 mb-1">Custom Solana RPC</div>
                <p className="text-[11px] text-slate-400 mb-2">
                  Public endpoints block DLMM bin queries. Use a personal RPC (e.g. Helius, QuickNode, Triton).
                </p>
                <input
                  type="text"
                  value={customRpc}
                  onChange={(e) => setCustomRpc(e.target.value)}
                  placeholder="https://mainnet.helius-rpc.com/?api-key=..."
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 font-mono text-xs mb-3 focus:border-cyan-500 focus:outline-none"
                />
                <div className="flex justify-end items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRpcConfig(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (customRpc.trim()) {
                        onChangeRpcEndpoint(customRpc.trim());
                        setShowRpcConfig(false);
                      }
                    }}
                    className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-3 py-1.5 rounded text-xs transition-colors"
                  >
                    Save & Load
                  </button>
                </div>
              </div>
            )}
          </div>

          <WalletMultiButton className="!bg-cyan-600 hover:!bg-cyan-500 !text-slate-950 !font-semibold !rounded-lg !text-xs !h-9 !px-4" />
        </div>
      </div>
    </header>
  );
};
