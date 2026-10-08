import React, { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi } from "lightweight-charts";
import { OHLCVBar } from "../types";
import { formatPrice, getBinPrice } from "../utils/math";

interface CandlestickChartProps {
  bars: OHLCVBar[];
  binStep: number;
  decimalsX: number;
  decimalsY: number;
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
  tokenYSymbol?: string;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  bars,
  binStep,
  decimalsX,
  decimalsY,
  activeBinId,
  minBinId,
  maxBinId,
  tokenYSymbol = "SOL",
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Bumped every time the chart+series are (re)created, so dependent effects
  // re-run against the LIVE chart instance instead of a disposed one.
  const [readyVersion, setReadyVersion] = useState(0);

  // Price lines
  const upperLineRef = useRef<any>(null);
  const lowerLineRef = useRef<any>(null);
  const activeLineRef = useRef<any>(null);

  const upperPrice = getBinPrice(maxBinId, binStep, decimalsX, decimalsY);
  const lowerPrice = getBinPrice(minBinId, binStep, decimalsX, decimalsY);
  const activePrice = getBinPrice(activeBinId, binStep, decimalsX, decimalsY);

  // 1. Initialize Chart
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    // Guard against zero-dimension mounts (happens on hard refresh before layout).
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    let chart: IChartApi;
    let series: ISeriesApi<"Candlestick">;
    try {
      chart = createChart(container, {
        width,
        height,
        layout: {
          background: { color: "#0c1017" },
          textColor: "#94a3b8",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#161f30" },
          horzLines: { color: "#161f30" },
        },
        crosshair: {
          vertLine: { color: "#38bdf8", width: 1, style: 2 },
          horzLine: { color: "#38bdf8", width: 1, style: 2 },
        },
        rightPriceScale: {
          borderColor: "#1e293b",
          scaleMargins: { top: 0.15, bottom: 0.15 },
        },
        timeScale: {
          borderColor: "#1e293b",
          timeVisible: true,
          secondsVisible: false,
        },
      });

      series = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        priceFormat: {
          type: "price",
          precision: 8,
          minMove: 0.00000001,
        },
      });
    } catch (e) {
      console.error("Failed to initialize candlestick chart:", e);
      return;
    }

    chartRef.current = chart;
    seriesRef.current = series;
    setReadyVersion((v) => v + 1);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth || 600,
          height: chartContainerRef.current.clientHeight || 400,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    // Also observe container resize via ResizeObserver (handles drag resizers & flex updates)
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      try {
        chart.remove();
      } catch (e) {
        /* already disposed */
      }
      chartRef.current = null;
      seriesRef.current = null;
      upperLineRef.current = null;
      lowerLineRef.current = null;
      activeLineRef.current = null;
    };
  }, []);

  // 2. Update Bars Data
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !bars || bars.length === 0) return;
    try {
      series.setData(bars as any);
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      console.warn("Error setting chart data:", e);
    }
  }, [bars, readyVersion]);

  // 3. Render Static Horizontal Boundary Lines (Lower, Upper, Active)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const safeRemove = (line: any) => {
      if (!line) return;
      try {
        series.removePriceLine(line);
      } catch (e) {
        /* line belonged to a disposed chart */
      }
    };

    safeRemove(upperLineRef.current);
    safeRemove(lowerLineRef.current);
    safeRemove(activeLineRef.current);
    upperLineRef.current = null;
    lowerLineRef.current = null;
    activeLineRef.current = null;

    const isValid = (p: number) =>
      typeof p === "number" && !isNaN(p) && isFinite(p) && p > 0;

    try {
      // Active Market Price Line
      if (isValid(activePrice)) {
        activeLineRef.current = series.createPriceLine({
          price: activePrice,
          color: "#00f0ff",
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: "ACTIVE BIN",
        });
      }

      // Upper Range Boundary Line (Solid Red)
      if (isValid(upperPrice)) {
        upperLineRef.current = series.createPriceLine({
          price: upperPrice,
          color: "#f43f5e",
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `UPPER BOUNDARY [${maxBinId}]`,
        });
      }

      // Lower Range Boundary Line (Solid Green)
      if (isValid(lowerPrice)) {
        lowerLineRef.current = series.createPriceLine({
          price: lowerPrice,
          color: "#10b981",
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `LOWER BOUNDARY [${minBinId}]`,
        });
      }
    } catch (e) {
      console.warn("Error rendering boundary price lines:", e);
    }
  }, [upperPrice, lowerPrice, activePrice, minBinId, maxBinId, readyVersion]);

  return (
    <div className="relative w-full h-full select-none">
      <div ref={chartContainerRef} className="w-full h-full cursor-crosshair" />

      {/* Range Boundary Display Badge */}
      <div className="absolute top-3 left-4 flex items-center space-x-2 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-md px-3 py-1.5 text-xs z-10">
        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
        <span className="text-slate-400 font-mono">Boundaries:</span>
        <span className="text-rose-400 font-semibold font-mono">
          Upper {formatPrice(upperPrice)} {tokenYSymbol} [Bin {maxBinId}]
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-emerald-400 font-semibold font-mono">
          Lower {formatPrice(lowerPrice)} {tokenYSymbol} [Bin {minBinId}]
        </span>
      </div>
    </div>
  );
};
