# Meteora DLMM LP Reshape Web App - Architecture & Execution Plan

## Objective
Support two distinct operation modes via an intuitive top-level switch in the web application:
1. **Mode A: In-Place Reshape (Default & Existing)**: Preserves the position's original `[lowerBinId, upperBinId]` bounds strictly intact. Supports Full Range, Ask Slice, and Bid Slice.
2. **Mode B: Shift / Recenter Range (New Procedure)**: Enables rolling, shifting, or re-centering the LP position's range using Meteora DLMM's native `rebalance_liquidity` instruction, without burning or creating a new position NFT. Includes interactive bin range sliders, numeric inputs, and a one-click "Recenter on Active Price" button.

---

## Technical Architecture & Safety Analysis

### 1. In-Place Reshape (Mode A)
- **Status**: Existing mechanism untouched.
- **Constraints**:
  - `fromBinId >= posData.lowerBinId` and `toBinId <= posData.upperBinId`.
  - Withdraws liquidity strictly from the selected sub-range.
  - Re-deposits via `StrategyType.BidAsk` (ramp) or `StrategyType.Spot` into the exact same bin boundaries.

### 2. Shift / Recenter Range (Mode B)
- **Mechanism**:
  - Reuses the existing position account on-chain.
  - Fully withdraws all liquidity from the old range `[posData.lowerBinId, posData.upperBinId]`.
  - Re-deposits tokens across the new shifted range `[newLowerBinId, newUpperBinId]`.
  - Calculates delta IDs relative to current active bin:
    $$\text{minDeltaId} = \text{newLowerBinId} - \text{activeBinId}$$
    $$\text{maxDeltaId} = \text{newUpperBinId} - \text{activeBinId}$$
  - Leverages DLMM's native `rebalance_liquidity` instruction with dynamic resizing:
    - If the new range is narrower or shifted: `shrinkMode: ShrinkBoth` trims old bins and refunds SOL rent.
    - If the new range is wider: program reallocs the position account size.
    - Missing bin arrays are detected and initialized via `initBinArrayInstructions`.

---

## Action Plan

### Step 1: Update Types (`src/types/index.ts`)
- Add `OperationMode = "in_place" | "shift_recenter"`.
- Add `ShiftRangeConfig` containing `newLowerBinId`, `newUpperBinId`, `distributionType`, and `maxActiveBinSlippage`.

### Step 2: Implement Shift Rebalance Builder (`src/utils/dlmm.ts`)
- Add `buildShiftRangeRebalanceTransactions(pool, userWallet, positionPubkey, config)`:
  - Validates `newLowerBinId <= newUpperBinId`.
  - Withdraws 100% of the entire position (`lowerBinId` to `upperBinId`).
  - Calculates tokens available across all bins (+ fees).
  - Builds strategy parameters for `[newLowerBinId - activeBinId, newUpperBinId - activeBinId]`.
  - Executes `pool.simulateRebalancePosition` and `pool.rebalancePosition`.
  - Returns `initBinArrayTx` and `rebalanceTx`.

### Step 3: Implement Mode Switch & Sliders in `src/components/ReshapePanel.tsx`
- Add Operation Mode Switch tabs: `[ 🔒 In-Place Reshape ]` and `[ ⚡ Shift / Recenter Range ]`.
- For `In-Place Reshape`: Render existing Scope buttons (Full Range, Ask Slice, Bid Slice) and boundary notices.
- For `Shift / Recenter Range`:
  - Show "Recenter on Active Price" one-click button (preserves current position width centered around `activeBinId`).
  - Add interactive sliders + number inputs for `New Lower Bin` and `New Upper Bin`.
  - Show live calculated metrics: New Min Price, New Max Price, Total Bins, and active price status (In-Range vs OOR).
  - Wire execution to `buildShiftRangeRebalanceTransactions`.

### Step 4: Reactive Bin Histogram Preview (`src/components/BinHistogram.tsx` & `src/App.tsx`)
- Allow `BinHistogram` to display target preview curves when in Shift/Recenter mode, reflecting the new proposed range `[newLowerBinId, newUpperBinId]`.

### Step 5: Build, Test & Deploy
- Run TypeScript check and `npm run build`.
- Deploy generated assets to web hosting directory.
- Test live web endpoint via HTTP check.
- Sanitize any repository updates and commit.
