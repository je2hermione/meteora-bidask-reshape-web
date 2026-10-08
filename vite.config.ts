import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";

export default defineConfig({
  base: "/meteora-reshape/",
  resolve: {
    alias: {
      "@solana-mobile/wallet-adapter-mobile": path.resolve(
        __dirname,
        "src/stubs/mobile-adapter-stub.ts"
      ),
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  define: {
    "process.env": {},
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
