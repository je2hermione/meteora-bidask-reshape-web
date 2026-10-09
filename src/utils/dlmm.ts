import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import DLMM, {
  StrategyType,
  getLiquidityStrategyParameterBuilder,
  buildLiquidityStrategyParameters,
} from "@meteora-ag/dlmm";
import BN from "bn.js";
import { PoolInfo, LPPosition, ReshapeConfig, ShiftRangeConfig, UserPoolPosition } from "../types";
import { getBinPrice } from "./math";

// Reliable Solana RPC endpoints
export const DEFAULT_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

// Popular Meteora DLMM pool for default view
export const DEFAULT_POOL_ADDRESS = "FtiotJckV2ZG4S1YgJDJLiXKKDAnKWXgQxo7vxsjPwPe";

/**
 * Loads metadata from DexScreener to get real token names & symbols.
 * Matches base/quote by mint address because DexScreener's base/quote order
 * does NOT necessarily match DLMM's tokenX/tokenY order.
 */
const tokenMetaCache = new Map<string, { tokenXSymbol: string; tokenYSymbol: string }>();

async function fetchTokenMetadata(
  poolAddressStr: string,
  tokenXMint: string,
  tokenYMint: string
): Promise<{ tokenXSymbol: string; tokenYSymbol: string } | null> {
  const cached = tokenMetaCache.get(poolAddressStr);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${poolAddressStr}`, {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      const pair = data.pair || (data.pairs && data.pairs[0]);
      if (pair?.baseToken?.address && pair?.quoteToken?.address) {
        const baseAddr: string = pair.baseToken.address;
        const baseSym: string = pair.baseToken.symbol;
        const quoteSym: string = pair.quoteToken.symbol;
        let result: { tokenXSymbol: string; tokenYSymbol: string };
        if (baseAddr === tokenXMint) {
          result = { tokenXSymbol: baseSym, tokenYSymbol: quoteSym };
        } else {
          // DexScreener base is our Y — swap so symbols align with DLMM tokenX/tokenY
          result = { tokenXSymbol: quoteSym, tokenYSymbol: baseSym };
        }
        tokenMetaCache.set(poolAddressStr, result);
        return result;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Loads DLMM pool metadata
 */
export async function fetchPoolInfo(
  connection: Connection,
  poolAddressStr: string
): Promise<{ pool: DLMM; info: PoolInfo }> {
  const poolPubkey = new PublicKey(poolAddressStr);
  const pool = await DLMM.create(connection, poolPubkey);
  const activeBin = await pool.getActiveBin();

  const tokenXDecimals = pool.tokenX.mint.decimals;
  const tokenYDecimals = pool.tokenY.mint.decimals;
  const currentPrice = getBinPrice(
    activeBin.binId,
    pool.lbPair.binStep,
    tokenXDecimals,
    tokenYDecimals
  );

  const dexMeta = await fetchTokenMetadata(
    poolAddressStr,
    pool.tokenX.mint.address.toBase58(),
    pool.tokenY.mint.address.toBase58()
  );

  const tokenXSymbol = dexMeta?.tokenXSymbol || (pool.tokenX.mint.address.toBase58() === "So11111111111111111111111111111111111111112" ? "SOL" : "Token X");
  const tokenYSymbol = dexMeta?.tokenYSymbol || (pool.tokenY.mint.address.toBase58() === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : pool.tokenY.mint.address.toBase58() === "So11111111111111111111111111111111111111112" ? "SOL" : "Token Y");

  // Fetch real on-chain market liquidity distribution around active bin (+- 35 bins)
  let marketBins: { binId: number; price: number; amountX: number; amountY: number }[] = [];
  try {
    const binsAround = await pool.getBinsAroundActiveBin(35, 35);
    marketBins = binsAround.bins.map((b: any) => ({
      binId: b.binId,
      price: getBinPrice(b.binId, pool.lbPair.binStep, tokenXDecimals, tokenYDecimals),
      amountX: Number(b.xAmount.toString()) / Math.pow(10, tokenXDecimals),
      amountY: Number(b.yAmount.toString()) / Math.pow(10, tokenYDecimals),
    }));
  } catch (e) {
    console.warn("Could not fetch binsAroundActiveBin:", e);
  }

  const info: PoolInfo = {
    address: poolAddressStr,
    tokenX: {
      mint: pool.tokenX.mint.address.toBase58(),
      symbol: tokenXSymbol,
      decimals: tokenXDecimals,
    },
    tokenY: {
      mint: pool.tokenY.mint.address.toBase58(),
      symbol: tokenYSymbol,
      decimals: tokenYDecimals,
    },
    binStep: pool.lbPair.binStep,
    activeBinId: activeBin.binId,
    currentPrice,
    marketBins,
  };

  return { pool, info };
}

const KNOWN_TOKENS: Record<string, string> = {
  "So11111111111111111111111111111111111111112": "SOL",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
  "7KEPApdbBMByrmqihz3bht2uMhFQcatjfSFQCKq66kH3": "DARK",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "JUP",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": "WIF",
};

export async function scanAllUserPositions(
  connection: Connection,
  userWallet: PublicKey
): Promise<UserPoolPosition[]> {
  try {
    const allPositionsMap = await DLMM.getAllLbPairPositionsByUser(connection, userWallet);
    const results: UserPoolPosition[] = [];

    for (const [poolKeyStr, item] of allPositionsMap.entries()) {
      const xMint = item.lbPair.tokenXMint.toBase58();
      const yMint = item.lbPair.tokenYMint.toBase58();
      const xDecimals = (item as any).tokenX?.mint?.decimals ?? 9;
      const yDecimals = (item as any).tokenY?.mint?.decimals ?? 9;
      const tokenXSymbol = KNOWN_TOKENS[xMint] || `${xMint.slice(0, 4)}..`;
      const tokenYSymbol = KNOWN_TOKENS[yMint] || (yMint.startsWith("So11") ? "SOL" : `${yMint.slice(0, 4)}..`);
      const pairName = `${tokenXSymbol}/${tokenYSymbol}`;

      for (const posData of item.lbPairPositionsData || []) {
        results.push({
          poolAddress: poolKeyStr,
          positionPublicKey: posData.publicKey.toBase58(),
          pairName,
          tokenXSymbol,
          tokenYSymbol,
          lowerBinId: posData.positionData.lowerBinId,
          upperBinId: posData.positionData.upperBinId,
          totalXAmount: rawToUiAmount(posData.positionData.totalXAmount, xDecimals),
          totalYAmount: rawToUiAmount(posData.positionData.totalYAmount, yDecimals),
        });
      }
    }
    return results;
  } catch (err: any) {
    console.error("scanAllUserPositions error:", err);
    // Don't swallow RPC errors — the caller shows scanError instead of a
    // misleading "no positions found".
    throw new Error(err?.message || "Failed to scan wallet positions via RPC.");
  }
}

/**
 * Converts a raw on-chain integer amount string to UI units without the
 * precision loss of Number(hugeString). Keeps up to 6 fractional digits.
 */
function rawToUiAmount(raw: string | number | null | undefined, decimals: number): number {
  const rawStr = raw?.toString() || "0";
  try {
    const r = BigInt(rawStr);
    if (r === 0n) return 0;
    const divisor = 10n ** BigInt(Math.max(0, decimals));
    const intPart = r / divisor;
    const frac6 = ((r % divisor) * 1_000_000n) / divisor;
    return Number(intPart) + Number(frac6) / 1e6;
  } catch {
    // Fallback for non-integer string forms (e.g. exponent notation)
    const n = Number(rawStr);
    return Number.isFinite(n) ? n / Math.pow(10, Math.max(0, decimals)) : 0;
  }
}

/**
 * Loads user positions for a pool
 */
export async function fetchUserPositions(
  pool: DLMM,
  userWallet: PublicKey
): Promise<LPPosition[]> {
  const { userPositions } = await pool.getPositionsByUserAndLbPair(userWallet);
  // DLMM.create already fetched the pair account — reuse its activeId instead
  // of an extra getActiveBin() RPC roundtrip.
  const activeBinId = pool.lbPair.activeId;
  const tokenXDecimals = pool.tokenX.mint.decimals;
  const tokenYDecimals = pool.tokenY.mint.decimals;

  return userPositions.map((pos) => {
    const posData = pos.positionData;
    const lowerPrice = getBinPrice(posData.lowerBinId, pool.lbPair.binStep, tokenXDecimals, tokenYDecimals);
    const upperPrice = getBinPrice(posData.upperBinId, pool.lbPair.binStep, tokenXDecimals, tokenYDecimals);

    // Extract bin array amounts
    const bins = (posData.positionBinData || []).map((b: any) => {
      const bPrice = getBinPrice(b.binId, pool.lbPair.binStep, tokenXDecimals, tokenYDecimals);
      return {
        binId: b.binId,
        price: bPrice,
        amountX: rawToUiAmount(b.positionXAmount, tokenXDecimals),
        amountY: rawToUiAmount(b.positionYAmount, tokenYDecimals),
        liquidityShare: (b.positionLiquidity || "0").toString(),
        isCurrentBin: b.binId === activeBinId,
      };
    });

    const totalXAmount = rawToUiAmount(posData.totalXAmount, tokenXDecimals);
    const totalYAmount = rawToUiAmount(posData.totalYAmount, tokenYDecimals);

    return {
      publicKey: pos.publicKey.toBase58(),
      lowerBinId: posData.lowerBinId,
      upperBinId: posData.upperBinId,
      lowerPrice,
      upperPrice,
      totalXAmount,
      totalYAmount,
      bins,
    };
  });
}

/**
 * Builds atomic rebalance transaction instructions.
 *
 * Reshaping means: withdraw 100% of the position's existing liquidity and
 * re-deposit it over the SAME bin range using a new distribution shape.
 *
 * IMPORTANT: `pool.simulateRebalancePosition` expects `RebalanceWithDeposit`
 * structs shaped as `{ minDeltaId, maxDeltaId, x0, y0, deltaX, deltaY,
 * favorXInActiveBin }` (all BN) and `RebalanceWithWithdraw` structs shaped as
 * `{ minBinId, maxBinId, bps }`. Passing the wrong shape is what caused
 * `Cannot read properties of undefined (reading 'gt')` (the SDK validates
 * `deposit.minDeltaId.gt(deposit.maxDeltaId)`).
 */
export async function buildAtomicReshapeTransactions(
  pool: DLMM,
  userWallet: PublicKey,
  positionPubkey: PublicKey,
  config: ReshapeConfig
): Promise<{
  initBinArrayTx: Transaction | null;
  rebalanceTx: Transaction;
}> {
  const { userPositions } = await pool.getPositionsByUserAndLbPair(userWallet);
  const positionInfo = userPositions.find((p) => p.publicKey.equals(positionPubkey));
  if (!positionInfo) throw new Error("Target position not found on-chain");

  const posData = positionInfo.positionData;
  const activeBinId = pool.lbPair.activeId;

  // ---- 0. Guard: a reshape NEVER changes the position's range boundaries.
  // The reshape sub-range must sit inside [lowerBinId, upperBinId].
  if (
    !Number.isInteger(config.fromBinId) ||
    !Number.isInteger(config.toBinId) ||
    config.fromBinId < posData.lowerBinId ||
    config.toBinId > posData.upperBinId ||
    config.fromBinId > config.toBinId
  ) {
    throw new Error(
      `Invalid reshape range [${config.fromBinId}..${config.toBinId}] — must be within position bounds [${posData.lowerBinId}..${posData.upperBinId}]`
    );
  }

  // ---- 1. Withdraw 100% of the liquidity in the reshape sub-range ----
  // The reshape operates on the single-sided Token X liquidity above the active
  // bin (fromBinId..toBinId), leaving the below-active Token Y side untouched.
  const withdraws = [
    {
      minBinId: new BN(config.fromBinId),
      maxBinId: new BN(config.toBinId),
      bps: new BN(10_000), // 100%
    },
  ];

  // ---- 2. Sum the tokens actually being withdrawn (+ claimable fees) in that range ----
  let amountX = new BN(0);
  let amountY = new BN(0);
  for (const b of posData.positionBinData || []) {
    if (b.binId < config.fromBinId || b.binId > config.toBinId) continue;
    amountX = amountX
      .add(new BN(b.positionXAmount || 0))
      .add(new BN(b.positionFeeXAmount || 0));
    amountY = amountY
      .add(new BN(b.positionYAmount || 0))
      .add(new BN(b.positionFeeYAmount || 0));
  }

  // ---- 3. Build the deposit struct exactly as the SDK's own strategy builder does ----
  // On ask-side (above active price), StrategyType.BidAsk produces x0 = 0 and deltaX > 0,
  // which is an ascending triangle: minimum near active price and maximum at far boundary.
  const strategyType =
    config.distributionType === "spot"
      ? StrategyType.Spot
      : StrategyType.BidAsk;

  const minDeltaId = new BN(config.fromBinId - activeBinId);
  const maxDeltaId = new BN(config.toBinId - activeBinId);

  // Bins strictly below active bin are Token Y (Bid side).
  // If minDeltaId < 0 and maxDeltaId <= 0, favorXInActiveBin is false.
  const isBidSideOnly = maxDeltaId.lt(new BN(0));
  const favorXInActiveBin = !isBidSideOnly && minDeltaId.lte(new BN(0));

  const strategyParameters = buildLiquidityStrategyParameters(
    amountX,
    amountY,
    minDeltaId,
    maxDeltaId,
    new BN(pool.lbPair.binStep),
    favorXInActiveBin,
    new BN(activeBinId),
    getLiquidityStrategyParameterBuilder(strategyType)
  );

  const deposits = [
    {
      minDeltaId,
      maxDeltaId,
      x0: strategyParameters.x0,
      y0: strategyParameters.y0,
      deltaX: strategyParameters.deltaX,
      deltaY: strategyParameters.deltaY,
      favorXInActiveBin,
    },
  ];

  // ---- 4. Simulate rebalance with the DLMM SDK ----
  const simResponse = await pool.simulateRebalancePosition(
    positionPubkey,
    posData,
    true, // shouldClaimFee
    true, // shouldClaimReward
    deposits,
    withdraws
  );

  // ---- 5. Generate transaction instructions ----
  const { initBinArrayInstructions, rebalancePositionInstruction } =
    await pool.rebalancePosition(
      simResponse,
      new BN(config.maxActiveBinSlippage || 2),
      userWallet
    );

  let initBinArrayTx: Transaction | null = null;
  if (initBinArrayInstructions.length > 0) {
    initBinArrayTx = new Transaction().add(...initBinArrayInstructions);
  }

  const rebalanceTx = new Transaction().add(...rebalancePositionInstruction);

  return { initBinArrayTx, rebalanceTx };
}

/**
 * Builds range shift / rebalance transaction instructions.
 *
 * This mode withdraws 100% of the existing position across [lowerBinId, upperBinId],
 * and deposits the resulting liquidity (+ accrued fees) into a new target range
 * [newLowerBinId, newUpperBinId] using Meteora DLMM's native rebalance_liquidity
 * instruction. The position account is reused directly on-chain without burning or new NFT.
 */
export async function buildShiftRangeRebalanceTransactions(
  pool: DLMM,
  userWallet: PublicKey,
  positionPubkey: PublicKey,
  config: ShiftRangeConfig
): Promise<{
  initBinArrayTx: Transaction | null;
  rebalanceTx: Transaction;
}> {
  const { userPositions } = await pool.getPositionsByUserAndLbPair(userWallet);
  const positionInfo = userPositions.find((p) => p.publicKey.equals(positionPubkey));
  if (!positionInfo) throw new Error("Target position not found on-chain");

  const posData = positionInfo.positionData;
  const activeBinId = pool.lbPair.activeId;

  if (
    !Number.isInteger(config.newLowerBinId) ||
    !Number.isInteger(config.newUpperBinId) ||
    config.newLowerBinId > config.newUpperBinId
  ) {
    throw new Error(
      `Invalid target range [${config.newLowerBinId}..${config.newUpperBinId}]`
    );
  }

  // 1. Withdraw 100% of the entire position
  const withdraws = [
    {
      minBinId: new BN(posData.lowerBinId),
      maxBinId: new BN(posData.upperBinId),
      bps: new BN(10_000), // 100%
    },
  ];

  // 2. Sum all available tokens (+ claimable fees) across all bins in the position
  let amountX = new BN(posData.totalXAmount || 0);
  let amountY = new BN(posData.totalYAmount || 0);
  if (posData.feeX) amountX = amountX.add(new BN(posData.feeX));
  if (posData.feeY) amountY = amountY.add(new BN(posData.feeY));

  // 3. Build deposit struct relative to active bin
  const strategyType =
    config.distributionType === "spot"
      ? StrategyType.Spot
      : StrategyType.BidAsk;

  const minDeltaId = new BN(config.newLowerBinId - activeBinId);
  const maxDeltaId = new BN(config.newUpperBinId - activeBinId);

  const isBidSideOnly = maxDeltaId.lt(new BN(0));
  const favorXInActiveBin = !isBidSideOnly && minDeltaId.lte(new BN(0));

  const strategyParameters = buildLiquidityStrategyParameters(
    amountX,
    amountY,
    minDeltaId,
    maxDeltaId,
    new BN(pool.lbPair.binStep),
    favorXInActiveBin,
    new BN(activeBinId),
    getLiquidityStrategyParameterBuilder(strategyType)
  );

  const deposits = [
    {
      minDeltaId,
      maxDeltaId,
      x0: strategyParameters.x0,
      y0: strategyParameters.y0,
      deltaX: strategyParameters.deltaX,
      deltaY: strategyParameters.deltaY,
      favorXInActiveBin,
    },
  ];

  // 4. Simulate rebalance
  const simResponse = await pool.simulateRebalancePosition(
    positionPubkey,
    posData,
    true, // shouldClaimFee
    true, // shouldClaimReward
    deposits,
    withdraws
  );

  // 5. Generate transaction instructions
  const { initBinArrayInstructions, rebalancePositionInstruction } =
    await pool.rebalancePosition(
      simResponse,
      new BN(config.maxActiveBinSlippage || 2),
      userWallet
    );

  let initBinArrayTx: Transaction | null = null;
  if (initBinArrayInstructions.length > 0) {
    initBinArrayTx = new Transaction().add(...initBinArrayInstructions);
  }

  const rebalanceTx = new Transaction().add(...rebalancePositionInstruction);

  return { initBinArrayTx, rebalanceTx };
}
