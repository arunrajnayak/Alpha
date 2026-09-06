export interface CandleData {
  time: string | number;  // YYYY-MM-DD for daily/weekly/monthly, Unix timestamp in seconds for intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleBarStats {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Format volume count matching Kite / TradingView notation (e.g. 559.99K, 1.25M) */
export function formatVolume(vol: number): string {
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

export interface TradeMarker {
  time: string | number;  // YYYY-MM-DD or Unix timestamp in seconds
  type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

export type ChartInterval = '5minute' | 'day' | 'week' | 'month';
export type ChartPeriod = '1D' | '2D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | 'MAX';

export interface IndicatorPoint {
  time: string | number;
  value: number;
}

export interface IndicatorsData {
  dma10?: IndicatorPoint[];
  dma20?: IndicatorPoint[];
  dma50?: IndicatorPoint[];
  dma100?: IndicatorPoint[];
  dma200?: IndicatorPoint[];
  vwap?: IndicatorPoint[];
}

/** Map a ChartPeriod to the approximate number of calendar days to subtract from today */
export function periodToDays(period: ChartPeriod): number {
  switch (period) {
    case '1D': return 1;
    case '2D': return 2;
    case '5D': return 7;   // 5 trading sessions ~ 7 calendar days
    case '1M': return 30;
    case '3M': return 90;
    case '6M': return 180;
    case '1Y': return 365;
    case '2Y': return 730;
    case '5Y': return 1825;
    case 'MAX': return 3650; // 10 years (Upstox API max limit)
  }
}

/** Map a ChartPeriod to the number of months to subtract from today */
export function periodToMonths(period: ChartPeriod): number {
  switch (period) {
    case '1D': return 1;
    case '2D': return 1;
    case '5D': return 1;
    case '1M': return 1;
    case '3M': return 3;
    case '6M': return 6;
    case '1Y': return 12;
    case '2Y': return 24;
    case '5Y': return 60;
    case 'MAX': return 120; // 10 years
  }
}

/**
 * Calculate Simple Moving Average (SMA / DMA)
 * Assumes candles are sorted ascending by time.
 */
export function calculateSMA(candles: CandleData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  result.push({
    time: candles[period - 1].time,
    value: Number((sum / period).toFixed(2)),
  });

  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close;
    result.push({
      time: candles[i].time,
      value: Number((sum / period).toFixed(2)),
    });
  }
  return result;
}

/**
 * Calculate intraday VWAP for 5-minute candles.
 * Resets each trading day at session open (09:15 IST).
 */
export function calculateVWAP(candles: CandleData[]): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  let currentDay = '';
  let cumTypicalVol = 0;
  let cumVol = 0;

  for (const c of candles) {
    // Determine the calendar day in IST (Asia/Kolkata)
    let dateStr = '';
    if (typeof c.time === 'number') {
      const date = new Date(c.time * 1000);
      dateStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } else {
      dateStr = String(c.time).slice(0, 10);
    }

    if (dateStr !== currentDay) {
      currentDay = dateStr;
      cumTypicalVol = 0;
      cumVol = 0;
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 0;
    cumTypicalVol += typicalPrice * vol;
    cumVol += vol;

    if (cumVol > 0) {
      result.push({
        time: c.time,
        value: Number((cumTypicalVol / cumVol).toFixed(2)),
      });
    }
  }
  return result;
}

export interface ChartIndicatorToggles {
  dma10?: boolean;
  dma20?: boolean;
  dma50?: boolean;
  dma100?: boolean;
  dma200?: boolean;
  vwap?: boolean;
}

export type ChartViewMode = 'tradingview' | 'portfolio';

export const DEFAULT_RIGHT_OFFSET = 8;

export interface ChartPreferences {
  interval: ChartInterval;
  period?: ChartPeriod | null;
  visibleIndicators: ChartIndicatorToggles;
  barSpacingByInterval?: Partial<Record<ChartInterval, number>>;
  rightOffsetByInterval?: Partial<Record<ChartInterval, number>>;
  periodByInterval?: Partial<Record<ChartInterval, ChartPeriod | null>>;
  chartViewMode?: ChartViewMode;
  isLogScale?: boolean;
}

export const DEFAULT_CHART_PREFERENCES: ChartPreferences = {
  interval: 'day',
  period: null,
  visibleIndicators: {
    dma10: true,
    dma20: true,
    dma50: true,
    dma100: true,
    dma200: true,
    vwap: true,
  },
  barSpacingByInterval: {},
  rightOffsetByInterval: {},
  periodByInterval: {},
  chartViewMode: 'tradingview',
  isLogScale: false,
};

const CHART_PREFS_STORAGE_KEY = 'alpha_chart_preferences_v1';

/**
 * Normalize Indian equity symbols to TradingView ticker format.
 * Examples:
 *  - RELIANCE -> NSE:RELIANCE
 *  - M&M -> NSE:M_M
 *  - BAJAJ-AUTO -> NSE:BAJAJ_AUTO
 *  - L&TFH -> NSE:L_TFH
 */
export function toTradingViewSymbol(symbol: string): string {
  if (!symbol) return '';
  const cleaned = symbol.trim().toUpperCase().replace(/&/g, '_').replace(/-/g, '_');
  if (cleaned.startsWith('NSE:') || cleaned.startsWith('BSE:')) {
    return cleaned;
  }
  return `NSE:${cleaned}`;
}

/**
 * Load chart preferences from localStorage with fallback to defaults.
 */
export function loadChartPreferences(): ChartPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_CHART_PREFERENCES;
  }
  try {
    const raw = localStorage.getItem(CHART_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      interval: parsed.interval ?? DEFAULT_CHART_PREFERENCES.interval,
      period: parsed.period !== undefined ? parsed.period : null,
      visibleIndicators: {
        ...DEFAULT_CHART_PREFERENCES.visibleIndicators,
        ...(parsed.visibleIndicators || {}),
      },
      barSpacingByInterval: parsed.barSpacingByInterval || {},
      rightOffsetByInterval: parsed.rightOffsetByInterval || {},
      periodByInterval: parsed.periodByInterval || {},
      chartViewMode: parsed.chartViewMode ?? DEFAULT_CHART_PREFERENCES.chartViewMode,
      isLogScale: parsed.isLogScale ?? DEFAULT_CHART_PREFERENCES.isLogScale,
    };
  } catch {
    return DEFAULT_CHART_PREFERENCES;
  }
}

/**
 * Persist partial chart preferences into localStorage.
 */
export function saveChartPreferences(update: Partial<ChartPreferences>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadChartPreferences();
    const next: ChartPreferences = {
      interval: update.interval ?? current.interval,
      period: update.period !== undefined ? update.period : current.period,
      visibleIndicators: update.visibleIndicators
        ? { ...current.visibleIndicators, ...update.visibleIndicators }
        : current.visibleIndicators,
      barSpacingByInterval: update.barSpacingByInterval
        ? { ...current.barSpacingByInterval, ...update.barSpacingByInterval }
        : current.barSpacingByInterval,
      rightOffsetByInterval: update.rightOffsetByInterval
        ? { ...current.rightOffsetByInterval, ...update.rightOffsetByInterval }
        : current.rightOffsetByInterval,
      periodByInterval: update.periodByInterval
        ? { ...current.periodByInterval, ...update.periodByInterval }
        : current.periodByInterval,
      chartViewMode: update.chartViewMode ?? current.chartViewMode,
      isLogScale: update.isLogScale !== undefined ? update.isLogScale : current.isLogScale,
    };
    localStorage.setItem(CHART_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

