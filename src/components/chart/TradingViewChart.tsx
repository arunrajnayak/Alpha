'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  Time,
  createSeriesMarkers,
  CrosshairMode,
  PriceScaleMode,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  type BarData,
  type HistogramData,
  type LineData,
  type MouseEventParams,
} from 'lightweight-charts';
import {
  CandleData,
  CandleBarStats,
  TradeMarker,
  ChartInterval,
  ChartPeriod,
  DEFAULT_RIGHT_OFFSET,
  periodToMonths,
  calculateSMA,
  calculateVWAP,
  loadChartPreferences,
} from '@/lib/chart-types';

export interface VisibleIndicators {
  dma10?: boolean;
  dma20?: boolean;
  dma50?: boolean;
  dma100?: boolean;
  dma200?: boolean;
  vwap?: boolean;
}

export interface IndicatorValues {
  dma10?: number;
  dma20?: number;
  dma50?: number;
  dma100?: number;
  dma200?: number;
  vwap?: number;
}

/** Format volume count matching Kite / TradingView notation (e.g. 559.99K, 1.25M) */
function formatVolume(vol: number): string {
  if (vol >= 10_000_000) {
    return (vol / 1_000_000).toFixed(2) + 'M';
  }
  if (vol >= 1_000_000) {
    return (vol / 1_000_000).toFixed(2) + 'M';
  }
  if (vol >= 1_000) {
    return (vol / 1_000).toFixed(2) + 'K';
  }
  return vol.toLocaleString('en-IN');
}

/**
 * Calculate the logical range to display in the chart for a given period and interval.
 * Returns { from, to } where `to` aligns with the latest candle (plus rightOffset margin),
 * and `from` is calculated to show the requested duration.
 */
export function getTargetLogicalRange(
  candles: CandleData[],
  interval: ChartInterval,
  period: ChartPeriod | null,
  rightOffset: number = DEFAULT_RIGHT_OFFSET
): { from: number; to: number } | null {
  if (!candles || candles.length === 0 || !period) return null;
  const lastIdx = candles.length - 1;
  const rightMargin = Math.max(2, Math.round(rightOffset));
  if (period === 'MAX') {
    return { from: 0, to: lastIdx + rightMargin };
  }

  if (interval === '5minute') {
    let barsCount = 75; // ~1 trading day (09:15 - 15:30)
    if (period === '1D') barsCount = 75;
    else if (period === '2D') barsCount = 150;
    else if (period === '5D') barsCount = 375;
    else if (period === '1M') barsCount = candles.length;
    else barsCount = 75;

    const fromIdx = Math.max(0, lastIdx - barsCount);
    return { from: fromIdx, to: lastIdx + rightMargin };
  }

  // Daily / Weekly / Monthly
  const lastCandleTime = candles[lastIdx].time;
  const lastDate = typeof lastCandleTime === 'string'
    ? new Date(lastCandleTime)
    : new Date(Number(lastCandleTime) * 1000);

  const targetDate = new Date(lastDate);
  const months = periodToMonths(period);
  targetDate.setMonth(targetDate.getMonth() - months);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  let fromIdx = 0;
  for (let i = lastIdx; i >= 0; i--) {
    const cTime = String(candles[i].time).slice(0, 10);
    if (cTime < targetDateStr) {
      fromIdx = i + 1;
      break;
    }
  }

  if (fromIdx >= lastIdx) {
    fromIdx = Math.max(0, lastIdx - 5);
  }

  return { from: fromIdx, to: lastIdx + rightMargin };
}

interface Props {
  symbol?: string;
  candles: CandleData[];
  trades?: TradeMarker[];
  height?: number;
  interval?: ChartInterval;
  period?: ChartPeriod | null;
  visibleIndicators?: VisibleIndicators;
  onIndicatorValues?: (values: IndicatorValues) => void;
  hoveredIndicator?: keyof VisibleIndicators | null;
  savedBarSpacing?: number;
  savedRightOffset?: number;
  isLogScale?: boolean;
  onZoomChange?: (barSpacing: number, isUserManualZoom?: boolean, rightOffset?: number) => void;
  resetZoomTrigger?: number;
  onNearStartOfData?: () => void;
  onHoverCandle?: (candle: CandleBarStats | null) => void;
}

export default function TradingViewChart({
  symbol = '',
  candles,
  trades = [],
  height = 500,
  interval = 'day',
  period = null,
  visibleIndicators = {
    dma10: true,
    dma20: true,
    dma50: true,
    dma100: true,
    dma200: true,
    vwap: true,
  },
  onIndicatorValues,
  hoveredIndicator,
  savedBarSpacing,
  savedRightOffset = DEFAULT_RIGHT_OFFSET,
  isLogScale = false,
  onZoomChange,
  resetZoomTrigger = 0,
  onNearStartOfData,
  onHoverCandle,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // User interaction and zoom debouncing
  const isUserInteractingRef = useRef(false);
  const isProgrammaticChangeRef = useRef(false);
  const interactionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zoomDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const onIndicatorValuesRef = useRef(onIndicatorValues);
  onIndicatorValuesRef.current = onIndicatorValues;
  const onHoverCandleRef = useRef(onHoverCandle);
  onHoverCandleRef.current = onHoverCandle;
  const latestIndValuesRef = useRef<IndicatorValues>({});
  const rafRef = useRef<number | null>(null);

  const savedBarSpacingRef = useRef(savedBarSpacing);
  savedBarSpacingRef.current = savedBarSpacing;
  const savedRightOffsetRef = useRef(savedRightOffset);
  savedRightOffsetRef.current = savedRightOffset;
  const onNearStartOfDataRef = useRef(onNearStartOfData);
  onNearStartOfDataRef.current = onNearStartOfData;
  const prevCandlesRef = useRef<CandleData[]>([]);

  // Track state for zoom/timescale management
  const prevResetTriggerRef = useRef(resetZoomTrigger);
  const prevIntervalRef = useRef(interval);
  const prevPeriodRef = useRef(period);
  const initialFitDoneRef = useRef(false);
  const lastFittedIntervalRef = useRef<ChartInterval | null>(null);
  const lastBarSpacingRef = useRef<number | null>(null);
  const lastScrollPosRef = useRef<number | null>(null);
  const pendingPeriodFitRef = useRef(false);

  // Series references
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const dma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const dma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const dma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const dma100SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const dma200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // 1. Initialize chart and series ONCE on mount
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const initialWidth = chartContainerRef.current.clientWidth || 300;
    const initialHeight = chartContainerRef.current.clientHeight || height || 400;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.3)', width: 1, style: 1 },
        horzLine: { color: 'rgba(255,255,255,0.3)', width: 1, style: 1 },
      },
      rightPriceScale: {
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: interval === '5minute',
        secondsVisible: false,
        rightOffset: savedRightOffset ?? DEFAULT_RIGHT_OFFSET,
      },
      width: initialWidth,
      height: initialHeight,
    });
    chartRef.current = chart;

    // Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // Volume Series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // Moving Average Line Series (Plot 1..5: Purple, Red, Green, Teal, Orange)
    dma10SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#9c27b0', // Purple (Plot 1)
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    dma20SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#f23645', // Red (Plot 2)
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    dma50SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50', // Green (Plot 3)
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    dma100SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#0497a7', // Teal (Plot 4)
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    dma200SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#ff9800', // Orange (Plot 5)
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // VWAP Line Series
    vwapSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#eab308', // Amber 500
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Markers Plugin
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    // Resize Observer - dynamically adapts to container size changes without recreating chart
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) {
        return;
      }
      const newRect = entries[0].contentRect;
      if (newRect.width > 0 && newRect.height > 0) {
        chart.applyOptions({
          width: Math.floor(newRect.width),
          height: Math.floor(newRect.height),
        });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    // Track user input directly on chart container
    const handleUserInteraction = () => {
      isUserInteractingRef.current = true;
      if (interactionTimerRef.current) {
        clearTimeout(interactionTimerRef.current);
      }
      interactionTimerRef.current = setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 800);
    };

    const containerEl = chartContainerRef.current;
    containerEl.addEventListener('wheel', handleUserInteraction, { passive: true });
    containerEl.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    containerEl.addEventListener('touchstart', handleUserInteraction, { passive: true });
    containerEl.addEventListener('touchmove', handleUserInteraction, { passive: true });

    // Subscribe to visible logical range change (triggered on zoom or scroll)
    const handleRangeChange = () => {
      if (!chartRef.current) return;
      const range = chartRef.current.timeScale().getVisibleLogicalRange();
      if (range && range.from < 10) {
        onNearStartOfDataRef.current?.();
      }

      // Ignore programmatic updates from fitting periods or initial positioning
      if (isProgrammaticChangeRef.current) {
        return;
      }

      const currentBarSpacing = chartRef.current.timeScale().options().barSpacing;
      const currentScrollPos = chartRef.current.timeScale().scrollPosition();

      const spacingChanged =
        currentBarSpacing &&
        currentBarSpacing > 0 &&
        lastBarSpacingRef.current !== null &&
        Math.abs(currentBarSpacing - lastBarSpacingRef.current) > 0.02;

      const offsetChanged =
        currentScrollPos !== null &&
        currentScrollPos >= 0 &&
        lastScrollPosRef.current !== null &&
        Math.abs(currentScrollPos - lastScrollPosRef.current) > 0.5;

      if (spacingChanged || offsetChanged) {
        if (currentBarSpacing) lastBarSpacingRef.current = currentBarSpacing;
        if (currentScrollPos !== null && currentScrollPos >= 0) {
          lastScrollPosRef.current = currentScrollPos;
        }

        if (zoomDebounceRef.current) {
          clearTimeout(zoomDebounceRef.current);
        }
        zoomDebounceRef.current = setTimeout(() => {
          const spacing = Number((currentBarSpacing ?? lastBarSpacingRef.current ?? 6).toFixed(2));
          const offset = currentScrollPos !== null && currentScrollPos >= 0
            ? Math.round(currentScrollPos)
            : undefined;
          onZoomChangeRef.current?.(spacing, true, offset);
        }, 150);
      } else {
        if (lastBarSpacingRef.current === null && currentBarSpacing) {
          lastBarSpacingRef.current = currentBarSpacing;
        }
        if (lastScrollPosRef.current === null && currentScrollPos !== null && currentScrollPos >= 0) {
          lastScrollPosRef.current = currentScrollPos;
        }
      }
    };

    // Crosshair Move: dynamically notify onHoverCandle of hovered candle stats
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          onHoverCandleRef.current?.(null);
        });
        return;
      }

      const candle = candleSeriesRef.current
        ? (param.seriesData.get(candleSeriesRef.current) as BarData<Time> | undefined)
        : undefined;

      if (!candle || candle.open === undefined) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          onHoverCandleRef.current?.(null);
        });
        return;
      }

      const volData = volumeSeriesRef.current
        ? (param.seriesData.get(volumeSeriesRef.current) as HistogramData<Time> | undefined)
        : undefined;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        onHoverCandleRef.current?.({
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: volData?.value,
        });
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      containerEl.removeEventListener('wheel', handleUserInteraction);
      containerEl.removeEventListener('pointerdown', handleUserInteraction);
      containerEl.removeEventListener('touchstart', handleUserInteraction);
      containerEl.removeEventListener('touchmove', handleUserInteraction);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (zoomDebounceRef.current) {
        clearTimeout(zoomDebounceRef.current);
        // Flush pending zoom or pan setting before unmounting so it is never lost
        if (chartRef.current && !isProgrammaticChangeRef.current) {
          const finalBarSpacing = chartRef.current.timeScale().options().barSpacing;
          const finalScrollPos = chartRef.current.timeScale().scrollPosition();
          if (finalBarSpacing && finalBarSpacing > 0) {
            const finalOffset = finalScrollPos !== null && finalScrollPos >= 0
              ? Math.round(finalScrollPos)
              : undefined;
            onZoomChangeRef.current?.(Number(finalBarSpacing.toFixed(2)), true, finalOffset);
          }
        }
      }
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      dma10SeriesRef.current = null;
      dma20SeriesRef.current = null;
      dma50SeriesRef.current = null;
      dma100SeriesRef.current = null;
      dma200SeriesRef.current = null;
      vwapSeriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, []); // Only initialize once on mount

  // Dynamically update price scale mode (Logarithmic vs Linear) when isLogScale changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.priceScale('right').applyOptions({
        mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
    }
  }, [isLogScale]);

  // 2. Highlight line on hover of corresponding indicator chip
  useEffect(() => {
    const seriesConfig: Record<
      keyof VisibleIndicators,
      {
        series: ISeriesApi<'Line'> | null;
        color: string;
        dimColor: string;
        baseWidth: 1 | 2 | 3 | 4;
        highlightWidth: 1 | 2 | 3 | 4;
      }
    > = {
      dma10: {
        series: dma10SeriesRef.current,
        color: '#9c27b0',
        dimColor: 'rgba(156, 39, 176, 0.25)',
        baseWidth: 1,
        highlightWidth: 3,
      },
      dma20: {
        series: dma20SeriesRef.current,
        color: '#f23645',
        dimColor: 'rgba(242, 54, 69, 0.25)',
        baseWidth: 1,
        highlightWidth: 3,
      },
      dma50: {
        series: dma50SeriesRef.current,
        color: '#4caf50',
        dimColor: 'rgba(76, 175, 80, 0.25)',
        baseWidth: 1,
        highlightWidth: 3,
      },
      dma100: {
        series: dma100SeriesRef.current,
        color: '#0497a7',
        dimColor: 'rgba(4, 151, 167, 0.25)',
        baseWidth: 1,
        highlightWidth: 3,
      },
      dma200: {
        series: dma200SeriesRef.current,
        color: '#ff9800',
        dimColor: 'rgba(255, 152, 0, 0.25)',
        baseWidth: 2,
        highlightWidth: 4,
      },
      vwap: {
        series: vwapSeriesRef.current,
        color: '#eab308',
        dimColor: 'rgba(234, 179, 8, 0.25)',
        baseWidth: 2,
        highlightWidth: 4,
      },
    };

    for (const [key, cfg] of Object.entries(seriesConfig)) {
      if (!cfg.series) continue;
      const isTarget = hoveredIndicator === key;
      if (hoveredIndicator) {
        cfg.series.applyOptions({
          lineWidth: isTarget ? cfg.highlightWidth : cfg.baseWidth,
          color: isTarget ? cfg.color : cfg.dimColor,
        });
      } else {
        cfg.series.applyOptions({
          lineWidth: cfg.baseWidth,
          color: cfg.color,
        });
      }
    }
  }, [hoveredIndicator]);

  // 3. Fluidly update series data and indicators without recreating canvas
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const isIntraday = interval === '5minute';

    // Update timeScale options for intraday vs daily
    chartRef.current.timeScale().applyOptions({
      timeVisible: isIntraday,
      secondsVisible: false,
    });

    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      dma10SeriesRef.current?.setData([]);
      dma20SeriesRef.current?.setData([]);
      dma50SeriesRef.current?.setData([]);
      dma100SeriesRef.current?.setData([]);
      dma200SeriesRef.current?.setData([]);
      vwapSeriesRef.current?.setData([]);
      markersPluginRef.current?.setMarkers([]);
      prevCandlesRef.current = [];
      return;
    }

    const prevCandles = prevCandlesRef.current;
    const prevLength = prevCandles.length;
    const newLength = candles.length;
    const isIntervalChange = interval !== lastFittedIntervalRef.current;
    prevIntervalRef.current = interval;

    const isPrepend =
      !isIntervalChange &&
      prevLength > 0 &&
      newLength > prevLength &&
      candles[newLength - 1]?.time === prevCandles[prevLength - 1]?.time;
    const prependedCount = newLength - prevLength;

    const prevRange = isPrepend && chartRef.current
      ? chartRef.current.timeScale().getVisibleLogicalRange()
      : null;

    prevCandlesRef.current = candles;

    // Candlesticks
    const formattedCandles = candles.map(c => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeriesRef.current.setData(formattedCandles);

    // Volume
    const volumeData = candles.map(c => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
    }));
    volumeSeriesRef.current.setData(volumeData);

    // Indicators: DMAs on Daily, VWAP on 5minute
    const indValues: IndicatorValues = {};

    if (interval === 'day') {
      const dma10Data = calculateSMA(candles, 10);
      const dma20Data = calculateSMA(candles, 20);
      const dma50Data = calculateSMA(candles, 50);
      const dma100Data = calculateSMA(candles, 100);
      const dma200Data = calculateSMA(candles, 200);

      indValues.dma10 = dma10Data[dma10Data.length - 1]?.value;
      indValues.dma20 = dma20Data[dma20Data.length - 1]?.value;
      indValues.dma50 = dma50Data[dma50Data.length - 1]?.value;
      indValues.dma100 = dma100Data[dma100Data.length - 1]?.value;
      indValues.dma200 = dma200Data[dma200Data.length - 1]?.value;

      dma10SeriesRef.current?.setData(visibleIndicators.dma10 !== false ? dma10Data.map(d => ({ time: d.time as Time, value: d.value })) : []);
      dma20SeriesRef.current?.setData(visibleIndicators.dma20 !== false ? dma20Data.map(d => ({ time: d.time as Time, value: d.value })) : []);
      dma50SeriesRef.current?.setData(visibleIndicators.dma50 !== false ? dma50Data.map(d => ({ time: d.time as Time, value: d.value })) : []);
      dma100SeriesRef.current?.setData(visibleIndicators.dma100 !== false ? dma100Data.map(d => ({ time: d.time as Time, value: d.value })) : []);
      dma200SeriesRef.current?.setData(visibleIndicators.dma200 !== false ? dma200Data.map(d => ({ time: d.time as Time, value: d.value })) : []);

      vwapSeriesRef.current?.setData([]);
    } else if (interval === '5minute') {
      const vwapData = calculateVWAP(candles);
      indValues.vwap = vwapData[vwapData.length - 1]?.value;

      vwapSeriesRef.current?.setData(visibleIndicators.vwap !== false ? vwapData.map(d => ({ time: d.time as Time, value: d.value })) : []);

      dma10SeriesRef.current?.setData([]);
      dma20SeriesRef.current?.setData([]);
      dma50SeriesRef.current?.setData([]);
      dma100SeriesRef.current?.setData([]);
      dma200SeriesRef.current?.setData([]);
    } else {
      // Week or Month
      dma10SeriesRef.current?.setData([]);
      dma20SeriesRef.current?.setData([]);
      dma50SeriesRef.current?.setData([]);
      dma100SeriesRef.current?.setData([]);
      dma200SeriesRef.current?.setData([]);
      vwapSeriesRef.current?.setData([]);
    }

    latestIndValuesRef.current = indValues;
    if (onIndicatorValues) {
      onIndicatorValues(indValues);
    }

    // Trade Markers
    if (trades.length > 0 && markersPluginRef.current) {
      // Build a map of valid times in the current candle series
      if (isIntraday) {
        // For intraday, match each trade date to the first candle of that day (usually 09:15)
        const dateToCandleTime = new Map<string, number>();
        for (const c of candles) {
          if (typeof c.time === 'number') {
            const dateStr = new Date(c.time * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            if (!dateToCandleTime.has(dateStr)) {
              dateToCandleTime.set(dateStr, c.time);
            }
          }
        }

        const intradayMarkers: {
          time: Time;
          position: 'belowBar' | 'aboveBar';
          color: string;
          shape: 'arrowUp' | 'arrowDown';
          text: string;
        }[] = [];

        // Deduplicate trades on same day
        const seenBuy = new Set<string>();
        const seenSell = new Set<string>();

        for (const t of trades) {
          const dateStr = typeof t.time === 'string' ? t.time.slice(0, 10) : '';
          const targetTime = dateToCandleTime.get(dateStr);
          if (targetTime !== undefined) {
            if (t.type === 'BUY' && !seenBuy.has(dateStr)) {
              seenBuy.add(dateStr);
              intradayMarkers.push({
                time: targetTime as Time,
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'B',
              });
            } else if (t.type === 'SELL' && !seenSell.has(dateStr)) {
              seenSell.add(dateStr);
              intradayMarkers.push({
                time: targetTime as Time,
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'S',
              });
            }
          }
        }

        intradayMarkers.sort((a, b) => (Number(a.time) - Number(b.time)));
        markersPluginRef.current.setMarkers(intradayMarkers);
      } else {
        // Daily / Weekly / Monthly
        // Ensure only one BUY and/or SELL marker per date
        const candleDates = new Set(candles.map(c => String(c.time).slice(0, 10)));
        const seenBuy = new Set<string>();
        const seenSell = new Set<string>();

        const markers: {
          time: Time;
          position: 'belowBar' | 'aboveBar';
          color: string;
          shape: 'arrowUp' | 'arrowDown';
          text: string;
        }[] = [];

        for (const t of trades) {
          const dateStr = String(t.time).slice(0, 10);
          if (candleDates.has(dateStr)) {
            if (t.type === 'BUY' && !seenBuy.has(dateStr)) {
              seenBuy.add(dateStr);
              markers.push({
                time: t.time as Time,
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'B',
              });
            } else if (t.type === 'SELL' && !seenSell.has(dateStr)) {
              seenSell.add(dateStr);
              markers.push({
                time: t.time as Time,
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'S',
              });
            }
          }
        }

        markers.sort((a, b) => (String(a.time).localeCompare(String(b.time))));
        markersPluginRef.current.setMarkers(markers);
      }
    } else {
      markersPluginRef.current?.setMarkers([]);
    }

    // Position or fit timescale on initial load, interval switch, period change, or prepend
    if (candles.length > 0 && chartRef.current) {
      if (isPrepend && prevRange) {
        isProgrammaticChangeRef.current = true;
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: prevRange.from + prependedCount,
          to: prevRange.to + prependedCount,
        });
        lastBarSpacingRef.current = chartRef.current.timeScale().options().barSpacing ?? null;
        setTimeout(() => {
          isProgrammaticChangeRef.current = false;
        }, 80);
      } else if (!initialFitDoneRef.current || isIntervalChange) {
        initialFitDoneRef.current = true;
        lastFittedIntervalRef.current = interval;
        chartRef.current.timeScale().applyOptions({ timeVisible: interval === '5minute' });
        const targetSpacing = savedBarSpacingRef.current ?? loadChartPreferences().barSpacingByInterval?.[interval];
        const targetOffset = savedRightOffsetRef.current ?? loadChartPreferences().rightOffsetByInterval?.[interval] ?? DEFAULT_RIGHT_OFFSET;
        isProgrammaticChangeRef.current = true;
        if (targetSpacing && targetSpacing > 0 && !period) {
          // Timeframe shown based on user's saved zoom & scale settings
          chartRef.current.timeScale().applyOptions({
            barSpacing: targetSpacing,
            rightOffset: targetOffset,
          });
          chartRef.current.timeScale().scrollToPosition(targetOffset, false);
        } else if (period) {
          const targetRange = getTargetLogicalRange(candles, interval, period, targetOffset);
          if (targetRange) {
            chartRef.current.timeScale().setVisibleLogicalRange(targetRange);
          } else {
            chartRef.current.timeScale().fitContent();
          }
        } else if (targetSpacing && targetSpacing > 0) {
          chartRef.current.timeScale().applyOptions({
            barSpacing: targetSpacing,
            rightOffset: targetOffset,
          });
          chartRef.current.timeScale().scrollToPosition(targetOffset, false);
        } else {
          // Default fallback if no prior zoom setting: show 1Y for daily, 5D for 5m
          const fallbackPeriod: ChartPeriod = interval === '5minute' ? '5D' : '1Y';
          const targetRange = getTargetLogicalRange(candles, interval, fallbackPeriod, targetOffset);
          if (targetRange) {
            chartRef.current.timeScale().setVisibleLogicalRange(targetRange);
          } else {
            chartRef.current.timeScale().fitContent();
          }
        }
        lastBarSpacingRef.current = chartRef.current.timeScale().options().barSpacing ?? null;
        lastScrollPosRef.current = chartRef.current.timeScale().scrollPosition();
        setTimeout(() => {
          isProgrammaticChangeRef.current = false;
        }, 80);
      } else if (pendingPeriodFitRef.current && period) {
        pendingPeriodFitRef.current = false;
        isProgrammaticChangeRef.current = true;
        const targetOffset = savedRightOffsetRef.current ?? loadChartPreferences().rightOffsetByInterval?.[interval] ?? DEFAULT_RIGHT_OFFSET;
        const targetRange = getTargetLogicalRange(candles, interval, period, targetOffset);
        if (targetRange) {
          chartRef.current.timeScale().setVisibleLogicalRange(targetRange);
        } else {
          chartRef.current.timeScale().fitContent();
        }
        lastBarSpacingRef.current = chartRef.current.timeScale().options().barSpacing ?? null;
        lastScrollPosRef.current = chartRef.current.timeScale().scrollPosition();
        setTimeout(() => {
          isProgrammaticChangeRef.current = false;
        }, 80);
      }
    }
  }, [candles, trades, interval, period, visibleIndicators, onIndicatorValues]);

  // 4. Handle explicit period switch or zoom reset
  useEffect(() => {
    if (resetZoomTrigger !== prevResetTriggerRef.current || period !== prevPeriodRef.current) {
      prevResetTriggerRef.current = resetZoomTrigger;
      prevPeriodRef.current = period;
      if (period && chartRef.current && candles.length > 0) {
        isProgrammaticChangeRef.current = true;
        const targetOffset = savedRightOffsetRef.current ?? loadChartPreferences().rightOffsetByInterval?.[interval] ?? DEFAULT_RIGHT_OFFSET;
        const targetRange = getTargetLogicalRange(candles, interval, period, targetOffset);
        if (targetRange) {
          chartRef.current.timeScale().setVisibleLogicalRange(targetRange);
        } else {
          chartRef.current.timeScale().fitContent();
        }
        lastBarSpacingRef.current = chartRef.current.timeScale().options().barSpacing ?? null;
        setTimeout(() => {
          if (chartRef.current) {
            const newSpacing = chartRef.current.timeScale().options().barSpacing;
            const newScrollPos = chartRef.current.timeScale().scrollPosition();
            if (newSpacing && newSpacing > 0) {
              lastBarSpacingRef.current = newSpacing;
              if (newScrollPos !== null && newScrollPos >= 0) {
                lastScrollPosRef.current = newScrollPos;
              }
              const finalOffset = newScrollPos !== null && newScrollPos >= 0
                ? Math.round(newScrollPos)
                : undefined;
              onZoomChangeRef.current?.(Number(newSpacing.toFixed(2)), false, finalOffset);
            }
          }
          isProgrammaticChangeRef.current = false;
        }, 80);
      } else if (period) {
        pendingPeriodFitRef.current = true;
      }
    }
  }, [resetZoomTrigger, period, interval, candles]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full h-full flex-1 relative min-h-[300px]"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
