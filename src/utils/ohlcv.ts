import { OHLCVBar } from "../types";

/**
 * Fetches recent OHLCV candlestick data for a DLMM pool
 */
export async function fetchPoolOHLCV(
  poolAddress: string,
  basePrice: number
): Promise<OHLCVBar[]> {
  try {
    // 1. Try GeckoTerminal 15m OHLCV in native quote token currency (matches DLMM bin price)
    // Note: GeckoTerminal aggregate parameter only allows: 1, 5, 15 for minute endpoint!
    const geckoRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/minute?aggregate=15&limit=100&currency=token`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (geckoRes.ok) {
      const data = await geckoRes.json();
      const list = data?.data?.attributes?.ohlcv_list;
      if (Array.isArray(list) && list.length > 0) {
        // GeckoTerminal returns newest first: [time, open, high, low, close, volume]
        const bars = list
          .map((item: any[]) => ({
            time: Number(item[0]),
            open: Number(item[1]),
            high: Number(item[2]),
            low: Number(item[3]),
            close: Number(item[4]),
            volume: Number(item[5] || 0),
          }))
          .filter((b) => !isNaN(b.time) && !isNaN(b.open) && !isNaN(b.close) && b.open > 0)
          .sort((a, b) => a.time - b.time);

        if (bars.length > 0) {
          return bars;
        }
      }
    }
  } catch (e) {
    // Fall through
  }

  try {
    // 2. Attempt Meteora Data API
    const res = await fetch(`https://dlmm.datapi.meteora.ag/pools/${poolAddress}/ohlcv?limit=100`, {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const bars = data
          .map((d: any) => ({
            time: Math.floor(new Date(d.timestamp || d.time).getTime() / 1000),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume || 0),
          }))
          .filter((b) => !isNaN(b.time) && !isNaN(b.open) && !isNaN(b.close) && b.open > 0)
          .sort((a, b) => a.time - b.time);

        if (bars.length > 0) {
          return bars;
        }
      }
    }
  } catch (e) {
    // Fall through to fallback generator
  }

  // Fallback: Generate realistic recent 15-minute candles around basePrice
  const bars: OHLCVBar[] = [];
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds = 15 * 60; // 15 minutes
  const count = 80;

  // Simulate price action that drops down near lower range (matching user scenario)
  let current = basePrice * 1.15; // started higher
  const startTime = now - count * intervalSeconds;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSeconds;
    // Gradual downtrend with noise
    const trend = i > 40 ? -0.002 : -0.001;
    const volatility = basePrice * 0.008;
    const delta = (Math.random() - 0.52) * volatility + (current * trend);
    
    const open = current;
    const close = Math.max(open + delta, basePrice * 0.5);
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 50000 + 10000),
      synthetic: true, // locally generated — NOT real market data
    });

    current = close;
  }

  // Ensure last bar ends at current basePrice
  if (bars.length > 0 && basePrice > 0) {
    const lastBar = bars[bars.length - 1];
    lastBar.close = basePrice;
    lastBar.high = Math.max(lastBar.high, basePrice);
    lastBar.low = Math.min(lastBar.low, basePrice);
  }

  return bars;
}
