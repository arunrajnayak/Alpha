/**
 * Momentum scoring functions — mirrors backtest/backend/engine.py exactly.
 *
 * All functions use oldest-first arrays: index 0 = oldest, index N-1 = latest.
 * This matches the backtest's candle array convention and ScreenerPrice ORDER BY date ASC.
 */

// ── Backtest DEFAULT_PARAMS (engine.py:522-548) — LOCKED ──
export const PARAMS = {
  sharpeWeight: 1.0,
  skipMonths: 1,             // = 21 trading days, applied to 3m window only
  athProximityPct: 30,       // entry: within 30% of ATH
  athWindow: 'full' as const,
  volumeThresholdCr: 1.0,
  volumeLookbackDays: 126,   // 6-month median
  mcapMinCr: 1000,
  minPrice: 50,
} as const;

const ETF_WHITELIST = new Set(['GOLDBEES', 'SILVERBEES']);

/** Check if a symbol is in the ETF whitelist (exempt from price filter) */
export function isETFWhitelisted(symbol: string): boolean {
  return ETF_WHITELIST.has(symbol);
}

// ── Math primitives (engine.py:10-36) ──

/** Compute daily returns from closes. engine.py:10-17 */
export function computeReturns(closes: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) {
      ret.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    } else {
      ret.push(0);
    }
  }
  return ret;
}

/** Arithmetic mean. engine.py:20-21 */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

/** Sample standard deviation (÷ N-1). engine.py:24-28 */
export function sampleStd(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (const v of arr) sumSq += (v - m) ** 2;
  return Math.sqrt(sumSq / (arr.length - 1));
}

/** Median. engine.py:31-36 */
export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Sharpe ratio (engine.py:39-46) ──

/**
 * Annualized Sharpe ratio (risk-free rate = 0).
 * Formula: (mean_daily × 252) / (std_daily × √252)
 * Returns -Infinity if < 20 returns, 0 if std = 0.
 */
export function sharpeRatio(returns: number[]): number {
  if (returns.length < 20) return -Infinity;
  const m = mean(returns);
  const s = sampleStd(returns);
  if (s === 0) return 0;
  return (m * 252) / (s * Math.sqrt(252));
}

// ── Moving average (engine.py:62-65) ──

/**
 * Simple moving average of the last `period` values ending at `idx`.
 * Returns null if insufficient data.
 */
export function movingAverage(closes: number[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) {
    sum += closes[i];
  }
  return sum / period;
}

/**
 * Build prefix sums for O(1) moving average queries. engine.py:49-53
 * prefixSums[i] = sum of closes[0..i-1], prefixSums[0] = 0
 */
export function buildPrefixSums(closes: number[]): number[] {
  const ps = new Array(closes.length + 1);
  ps[0] = 0;
  for (let i = 0; i < closes.length; i++) {
    ps[i + 1] = ps[i] + closes[i];
  }
  return ps;
}

/** O(1) moving average using prefix sums. engine.py:56-59 */
export function movingAveragePrefix(prefixSums: number[], idx: number, period: number): number | null {
  if (idx < period - 1) return null;
  return (prefixSums[idx + 1] - prefixSums[idx - period + 1]) / period;
}

// ── Core scoring function (engine.py:71-164) ──

export interface ScoreResult {
  sharpe12m: number;
  sharpe6m: number;
  sharpe3m: number;
  avgSharpe: number;
  athProximity: number;
  compositeScore: number;
  ath: number;
  dma200: number;
  aboveDma200Pct: number;
  aboveDma10: boolean;
  aboveDma20: boolean;
  aboveDma50: boolean;
  aboveDma100: boolean;
  medianTurnoverCr: number;
  currentPrice: number;
}

/**
 * Score a single stock. Mirrors engine.py:score_stock() lines 71-164.
 *
 * @param closes  Oldest-first close prices (all available history)
 * @param highs   Oldest-first high prices (for ATH)
 * @param volumes Oldest-first volumes (for turnover)
 * @param symbol  Stock symbol (for ETF whitelist check)
 * @param storedATH  Pre-loaded ATH from StockATH table (optional, falls back to computing from highs)
 * @param options  Optional scoring options
 * @param options.skipFilters  When true, skip the 4 entry filters (200 DMA, min price, ATH proximity,
 *                             median turnover) and return a result regardless. Computation prerequisites
 *                             (dateIdx >= 247, finite Sharpe values) still apply.
 * @returns ScoreResult or null if stock fails any prerequisite (or a filter when skipFilters is false)
 */
export function scoreStock(
  closes: number[],
  highs: number[],
  volumes: number[],
  symbol: string,
  storedATH?: number,
  options?: { skipFilters?: boolean },
): ScoreResult | null {
  const skipFilters = options?.skipFilters === true;
  const skipDays = PARAMS.skipMonths * 21; // engine.py:72
  const dateIdx = closes.length - 1;
  const effectiveIdx = dateIdx - skipDays; // engine.py:73

  // Pre-requisite: need at least ~247 trading days (~12 months) of history from today (engine.py:74).
  // Slightly below 252 to accommodate API history limits and market holidays.
  // All 3 Sharpe windows compute correctly at this threshold.
  if (dateIdx < 247) return null;

  const currentClose = closes[dateIdx]; // engine.py:77

  // 200 DMA filter (engine.py:79-85)
  const prefixSums = buildPrefixSums(closes);
  const dma200Raw = movingAveragePrefix(prefixSums, dateIdx, 200);
  if (!skipFilters && (dma200Raw === null || currentClose < dma200Raw)) return null;
  const dma200 = dma200Raw ?? 0; // null only possible when skipFilters is true (< 200 candles)

  // Price filter — ETF whitelist exempt (engine.py:88-89)
  if (!skipFilters && currentClose < PARAMS.minPrice && !isETFWhitelisted(symbol)) return null;

  // ATH proximity (engine.py:91-104)
  // Use stored ATH from monthly candles if available, else compute from highs array
  let ath: number;
  if (storedATH !== undefined && storedATH > 0) {
    // Update with any new highs in the daily data
    let maxHigh = storedATH;
    for (let i = 0; i <= dateIdx; i++) {
      if (highs[i] > maxHigh) maxHigh = highs[i];
    }
    ath = maxHigh;
  } else {
    // Full computation from available highs (engine.py:98)
    ath = 0;
    for (let i = 0; i <= dateIdx; i++) {
      if (highs[i] > ath) ath = highs[i];
    }
  }

  const proximity = ath > 0 ? currentClose / ath : 0; // engine.py:102
  const athPct = PARAMS.athProximityPct;
  const withinATH = athPct >= 100 || proximity >= (1 - athPct / 100); // engine.py:103-104

  // AND filter mode (engine.py:119-124): must pass both 200 DMA AND ATH proximity
  // 200 DMA already checked above. Check ATH:
  if (!skipFilters && !withinATH) return null;

  // Volume filter (engine.py:127-131)
  const volLookback = PARAMS.volumeLookbackDays;
  const volWindow: number[] = [];
  for (let i = Math.max(0, dateIdx - volLookback + 1); i <= dateIdx; i++) {
    volWindow.push(closes[i] * volumes[i]);
  }
  const medianTurnover = median(volWindow);
  if (!skipFilters && medianTurnover < PARAMS.volumeThresholdCr * 1e7) return null;

  // Sharpe ratios (engine.py:148-152)
  const closes12m = closes.slice(Math.max(0, dateIdx - 251), dateIdx + 1);
  const closes6m = closes.slice(Math.max(0, dateIdx - 125), dateIdx + 1);
  const closes3m = closes.slice(Math.max(0, effectiveIdx - 62), effectiveIdx + 1);

  const sharpe12m = sharpeRatio(computeReturns(closes12m));
  const sharpe6m = sharpeRatio(computeReturns(closes6m));
  const sharpe3m = sharpeRatio(computeReturns(closes3m));

  // All Sharpe values must be finite (engine.py:154)
  if (!Number.isFinite(sharpe12m) || !Number.isFinite(sharpe6m) || !Number.isFinite(sharpe3m)) {
    return null;
  }

  // Composite score (engine.py:157-158): pure Sharpe average
  const avgSharpe = (sharpe12m + sharpe6m + sharpe3m) / 3;
  const compositeScore = PARAMS.sharpeWeight * avgSharpe;

  // % above/below 200 DMA
  const aboveDma200Pct = dma200 > 0 ? ((currentClose - dma200) / dma200) * 100 : 0;

  // Additional DMA checks (display only — not filters)
  const dma10 = movingAveragePrefix(prefixSums, dateIdx, 10);
  const dma20 = movingAveragePrefix(prefixSums, dateIdx, 20);
  const dma50 = movingAveragePrefix(prefixSums, dateIdx, 50);
  const dma100 = movingAveragePrefix(prefixSums, dateIdx, 100);

  return {
    sharpe12m,
    sharpe6m,
    sharpe3m,
    avgSharpe,
    athProximity: proximity,
    compositeScore,
    ath,
    dma200,
    aboveDma200Pct,
    aboveDma10: dma10 !== null && currentClose >= dma10,
    aboveDma20: dma20 !== null && currentClose >= dma20,
    aboveDma50: dma50 !== null && currentClose >= dma50,
    aboveDma100: dma100 !== null && currentClose >= dma100,
    medianTurnoverCr: medianTurnover / 1e7, // Convert to Crores
    currentPrice: currentClose,
  };
}
