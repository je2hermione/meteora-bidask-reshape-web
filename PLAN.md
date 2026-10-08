# Meteora DLMM LP Reshape Web App - Remediation Plan (v2)

## User Feedback & Problem Diagnosis
1. **Chart Candles & Boundary Lines Mismatch**:
   - `fetchPoolOHLCV` called GeckoTerminal without `currency=token`, returning prices in **USD** (~$0.00512/token).
   - In contrast, DLMM pool math (`getBinPrice`) calculates price in native quote tokens (**SOL**, ~0.0000445 SOL/token).
   - Because the chart candles were in USD while the boundary lines were in SOL (115x difference), the boundary lines appeared completely outside or distorted relative to the candles.
   - **Fix**: Call GeckoTerminal with `currency=token` so OHLCV is returned in native quote currency (`SOL per Token X`), matching `getBinPrice` exactly.
   - Update chart axis & badges to format prices in `{symbol}` (`SOL`) with full precision.

2. **Auto-Refresh Rate & Re-render Loop**:
   - `loadPool` in `App.tsx` had `activePosition` in its dependency array, which triggered repeated cascading reloads whenever position was set.
   - **Fix**: Decouple `activePosition` from `loadPool` dependencies. Add a controlled, sane interval (45 seconds) for background updates of pool price and user positions without UI stutter.

3. **Preserving Original Position Range Boundaries**:
   - Reshaping must NOT move, cut, nor extend the original position's range boundary `[lowerBinId, upperBinId]`.
   - When price is Out Of Range (OOR) below (`activeBinId <= lowerBinId`):
     - The position holds 100% Token X across all bins.
     - The reshape slice starts at `lowerBinId` (e.g. -622) and ends at `upperBinId` (e.g. -551).
     - Reshapes into a full ascending triangle across all `upperBinId - lowerBinId + 1` bins (e.g. 72 bins) with minimum at `lowerBinId` and maximum at `upperBinId`.
     - No bins are added or cut; total bin size stays identical to the original position.
   - When price is inside range:
     - Allow selecting "Full Range" (`[lowerBinId ... upperBinId]`) or "Ask Side" (`[Math.max(lowerBinId, activeBinId + 1) ... upperBinId]`).
     - Defaults to Full Range when OOR below.

---

## Action Plan

### Step 1: Fix OHLCV Currency in `src/utils/ohlcv.ts`
- Add `currency=token` to GeckoTerminal query to get OHLCV in native quote asset (SOL).
- Fallback generator also produces prices in native quote asset around `basePrice`.

### Step 2: Refine Price Display & Chart Alignment in `CandlestickChart.tsx`
- Ensure chart price scale, precision (up to 8 decimal places), and boundary lines match native quote price (`SOL`).
- Display quote asset symbol in price badges.

### Step 3: Implement Range Boundary Preservation & OOR Handling in `dlmm.ts` & `ReshapePanel.tsx`
- Compute `startReshapeBin`:
  - If `activeBinId <= posLowerBin` (OOR below): `fromBinId = posLowerBin` (covers 100% of original bins).
  - If `activeBinId > posLowerBin`: allow user to select "Full Range" (`posLowerBin` to `posUpperBin`) or "Ask Slice" (`activeBinId + 1` to `posUpperBin`).
  - Total bin count matches original position range exactly.
- Build rebalance transaction with the appropriate `minDeltaId` and `maxDeltaId`.

### Step 4: Sane Auto-Refresh & Stability in `src/App.tsx`
- Remove `activePosition` from `loadPool` dependencies.
- Implement a 45-second background refresh interval for pool and position data.

### Step 5: Build, Deploy & Verify
- Run `npm run build`.
- Deploy generated `dist/` bundle to static web hosting.
- Verify with live script and browser endpoint.
