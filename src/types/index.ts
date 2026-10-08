export interface PoolInfo {
  address: string;
  tokenX: {
    mint: string;
    symbol: string;
    decimals: number;
  };
  tokenY: {
    mint: string;
    symbol: string;
    decimals: number;
  };
  binStep: number;
  activeBinId: number;
  currentPrice: number;
  marketBins?: {
    binId: number;
    price: number;
    amountX: number;
    amountY: number;
  }[];
}

export interface PositionBin {
  binId: number;
  price: number;
  amountX: number;
  amountY: number;
  liquidityShare: string;
  isCurrentBin?: boolean;
}

export interface LPPosition {
  publicKey: string;
  lowerBinId: number;
  upperBinId: number;
  lowerPrice: number;
  upperPrice: number;
  totalXAmount: number;
  totalYAmount: number;
  bins: PositionBin[];
}

export interface UserPoolPosition {
  poolAddress: string;
  positionPublicKey: string;
  pairName: string;
  tokenXSymbol: string;
  tokenYSymbol: string;
  lowerBinId: number;
  upperBinId: number;
  totalXAmount: number;
  totalYAmount: number;
}

export type ReshapeDistributionType = "triangular" | "bidask" | "spot";

export type ReshapeScopeMode = "full_range" | "ask_slice" | "bid_slice";

export interface ReshapeConfig {
  fromBinId: number;
  toBinId: number;
  distributionType: ReshapeDistributionType;
  maxActiveBinSlippage: number;
}

export interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** True when this bar was synthesized locally because OHLCV APIs were unreachable */
  synthetic?: boolean;
}
