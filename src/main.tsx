import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DEFAULT_RPC_ENDPOINT } from "./utils/dlmm";

// Import Wallet Adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

const Root: React.FC = () => {
  // Can use custom RPC or default public
  const endpoint = useMemo(() => DEFAULT_RPC_ENDPOINT, []);

  // Standard wallets (Phantom, Solflare, Backpack, etc.) auto-detected via Wallet Standard
  const wallets = useMemo(() => [], []);

  return (
    <ErrorBoundary fallbackTitle="Application Error">
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ErrorBoundary>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
