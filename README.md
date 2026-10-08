# Meteora DLMM LP Reshaper

A responsive web application for managing and reshaping liquidity positions on [Meteora Dynamic Liquidity Market Maker (DLMM)](https://meteora.ag) on Solana.

It allows liquidity providers to dynamically reshape existing LP positions (e.g. converting single-sided or shifted liquidity into ascending ramps or symmetric Bid-Ask V-shapes) without altering the original range boundaries.

---

## Features

- **Non-Destructive Reshaping**: Preserves original position range bounds (`[lowerBinId ... upperBinId]`), avoiding unintended range expansion or truncation.
- **Three Reshape Scope Modes**:
  - **Full Range**: Redistributes liquidity across all bins (creates symmetric Bid-Ask distribution when price is inside range; full ramp when out-of-range).
  - **Ask Slice (Token X)**: Reshapes accumulated base tokens from `activeBin + 1` up to the upper boundary into an ascending ramp, keeping bid tokens intact.
  - **Bid Slice (Token Y / Quote)**: Reshapes accumulated quote tokens from the lower boundary up to `activeBin - 1` into an ascending ramp toward active price, keeping ask tokens intact.
- **Real-Time On-Chain Visualization**:
  - 15-minute candlestick chart powered by GeckoTerminal with native quote token pricing.
  - Interactive DLMM bin distribution histogram reflecting exact user LP balances vs. reshape target previews.
- **Responsive Workspace**:
  - **Desktop / Monitor**: Viewport-locked layout with an interactive vertical drag divider between candlestick chart and bin histogram.
  - **Mobile**: Flowing vertical layout with responsive horizontal scroll support for dense bin distributions.
- **Deep Linking**: Syncs active pool with URL query parameters (`?pair=<POOL_ADDRESS>`).
- **Client-Side Wallet Authentication**: Connects directly via standard Solana Wallet Adapter (Phantom, Solflare, Backpack, etc.).

---

## Tech Stack

- **Framework**: React 18, TypeScript, Vite
- **Solana & DLMM**: `@solana/web3.js`, `@meteora-ag/dlmm`, `@coral-xyz/anchor`
- **Charting & Visuals**: `lightweight-charts`, Lucide Icons, Tailwind CSS
- **Market Data**: GeckoTerminal API (15m native quote candles) & DexScreener API

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation

```bash
# Clone the repository
git clone https://github.com/je2hermione/meteora-bidask-reshape-web.git
cd meteora-bidask-reshape-web

# Install dependencies
npm install
```

### Environment Configuration (Optional)

Create a `.env` file if you want to specify a custom RPC endpoint:

```bash
cp .env.example .env
```

Edit `.env`:
```env
VITE_RPC_URL=https://api.mainnet-beta.solana.com
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
```

The compiled output will be generated in `dist/`.

---

## License

MIT License.
