/**
 * Pure candle / indicator utilities for the Radar breakout scanner.
 *
 * No I/O, no server-only imports — safe to use on both the server (actions)
 * and the client (chart rendering). All timestamps are epoch milliseconds.
 */

export interface Candle {
  time: number; // epoch ms (candle open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M';

/** How each user-facing timeframe is built from a native Upstox interval. */
export const TIMEFRAME_CONFIG: Record<
  Timeframe,
  { base: '1minute' | '30minute' | 'day' | 'week' | 'month'; factor: number; lookbackDays: number; label: string }
> = {
  '1m':  { base: '1minute',  factor: 1,  lookbackDays: 5,    label: '1m' },
  '5m':  { base: '1minute',  factor: 5,  lookbackDays: 7,    label: '5m' },
  '15m': { base: '1minute',  factor: 15, lookbackDays: 10,   label: '15m' },
  '30m': { base: '30minute', factor: 1,  lookbackDays: 60,   label: '30m' },
  '1h':  { base: '30minute', factor: 2,  lookbackDays: 90,   label: '1h' },
  '4h':  { base: '30minute', factor: 8,  lookbackDays: 180,  label: '4h' },
  '1D':  { base: 'day',      factor: 1,  lookbackDays: 400,  label: '1D' },
  '1W':  { base: 'week',     factor: 1,  lookbackDays: 1400, label: '1W' },
  '1M':  { base: 'month',    factor: 1,  lookbackDays: 4000, label: '1M' },
};

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];

/** Local (IST) YYYY-MM-DD key used to keep resample buckets within one session. */
function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Normalise raw Upstox candles (array-of-objects with ISO timestamps, usually
 * newest-first) into ascending epoch-ms Candles.
 */
export function toCandles(
  raw: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }[]
): Candle[] {
  return raw
    .map((c) => ({
      time: new Date(c.timestamp).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    .filter((c) => Number.isFinite(c.time))
    .sort((a, b) => a.time - b.time);
}

/**
 * Resample ascending candles into buckets of `factor` consecutive candles,
 * grouped within a single trading day so buckets stay session-aligned
 * (native NSE candles start at 09:15 IST).
 */
export function resample(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let currentDay = '';

  const flush = () => {
    if (bucket.length === 0) return;
    out.push({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map((b) => b.high)),
      low: Math.min(...bucket.map((b) => b.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((s, b) => s + (b.volume || 0), 0),
    });
    bucket = [];
  };

  for (const c of candles) {
    const day = dayKey(c.time);
    if (day !== currentDay) {
      flush();
      currentDay = day;
    }
    bucket.push(c);
    if (bucket.length >= factor) flush();
  }
  flush();
  return out;
}

/** Highest high / lowest low over the `n` candles PRIOR to the last one. */
export function donchian(candles: Candle[], n: number): { high: number; low: number } | null {
  if (candles.length < n + 1) return null;
  const window = candles.slice(-(n + 1), -1); // exclude the current (last) bar
  return {
    high: Math.max(...window.map((c) => c.high)),
    low: Math.min(...window.map((c) => c.low)),
  };
}

/** Latest-bar volume divided by the average volume of the prior `n` bars. */
export function volumeRatio(candles: Candle[], n: number): number {
  if (candles.length < n + 1) return 1;
  const prior = candles.slice(-(n + 1), -1);
  const avg = prior.reduce((s, c) => s + (c.volume || 0), 0) / prior.length;
  if (avg <= 0) return 1;
  return (candles[candles.length - 1].volume || 0) / avg;
}

export type BreakoutDirection = 'breakout' | 'breakdown' | 'none';

export interface BreakoutSignal {
  direction: BreakoutDirection;
  volRatio: number;
  level: number | null; // the donchian level that was broken (or nearest)
  distancePct: number; // signed % of close vs the broken level
  changePct: number; // % change of last close vs previous close
  score: number; // ranking magnitude (positive = breakout, negative = breakdown)
  lastClose: number;
  startIndex: number; // candle index where the current breakout/breakdown run began (-1 if none)
}

/**
 * Compute a breakout/breakdown signal for the most recent bar.
 * `n` is the Donchian lookback (number of prior bars that define the range).
 */
export function computeBreakout(candles: Candle[], n = 20): BreakoutSignal {
  const empty: BreakoutSignal = {
    direction: 'none', volRatio: 1, level: null, distancePct: 0, changePct: 0, score: 0, lastClose: 0, startIndex: -1,
  };
  if (candles.length < 2) return empty;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const changePct = prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const volRatio = volumeRatio(candles, n);
  const dc = donchian(candles, n);

  if (!dc) {
    return { ...empty, volRatio, changePct, lastClose: last.close };
  }

  let direction: BreakoutDirection = 'none';
  let level: number | null = null;
  let distancePct = 0;

  if (last.close > dc.high) {
    direction = 'breakout';
    level = dc.high;
    distancePct = dc.high ? ((last.close - dc.high) / dc.high) * 100 : 0;
  } else if (last.close < dc.low) {
    direction = 'breakdown';
    level = dc.low;
    distancePct = dc.low ? ((last.close - dc.low) / dc.low) * 100 : 0;
  } else {
    // Not broken yet — report proximity to the nearer band (for context).
    const distToHigh = dc.high ? ((dc.high - last.close) / dc.high) * 100 : Infinity;
    const distToLow = dc.low ? ((last.close - dc.low) / dc.low) * 100 : Infinity;
    level = distToHigh <= distToLow ? dc.high : dc.low;
  }

  // Ranking magnitude: volume surge amplified by how decisively price cleared
  // the level. A pure "none" still ranks a little by volume so the list isn't empty.
  const magnitude = direction === 'none'
    ? (volRatio - 1) * 0.25
    : volRatio * (1 + Math.abs(distancePct) / 5);
  const signed = direction === 'breakdown' ? -magnitude : magnitude;

  // Origin of the current move: walk back while price stays beyond the level.
  let startIndex = -1;
  if (direction !== 'none' && level != null) {
    startIndex = candles.length - 1;
    for (let i = candles.length - 1; i >= 0; i--) {
      const beyond = direction === 'breakout' ? candles[i].close > level : candles[i].close < level;
      if (beyond) startIndex = i;
      else break;
    }
  }

  return {
    direction,
    volRatio,
    level,
    distancePct,
    changePct,
    score: signed,
    lastClose: last.close,
    startIndex,
  };
}

export type PivotType = 'high' | 'low';
export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: PivotType;
  label?: SwingLabel;
}

/**
 * Detect swing pivots: a candle is a swing high if its high is the max within
 * +/- `lookback` bars, and a swing low if its low is the min within that window.
 * Each pivot is then labelled HH/HL/LH/LL relative to the previous same-type pivot.
 */
export function detectPivots(candles: Candle[], lookback = 3): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < lookback * 2 + 1) return pivots;

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, time: candles[i].time, price: candles[i].high, type: 'high' });
    else if (isLow) pivots.push({ index: i, time: candles[i].time, price: candles[i].low, type: 'low' });
  }

  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (const p of pivots) {
    if (p.type === 'high') {
      p.label = lastHigh == null ? 'HH' : p.price >= lastHigh ? 'HH' : 'LH';
      lastHigh = p.price;
    } else {
      p.label = lastLow == null ? 'HL' : p.price <= lastLow ? 'LL' : 'HL';
      lastLow = p.price;
    }
  }
  return pivots;
}

export type Trend = 'up' | 'down' | 'range';

/** Read a coarse trend from the last few swing labels. */
export function trendFromPivots(pivots: Pivot[]): Trend {
  const recent = pivots.slice(-4);
  const ups = recent.filter((p) => p.label === 'HH' || p.label === 'HL').length;
  const downs = recent.filter((p) => p.label === 'LL' || p.label === 'LH').length;
  if (ups > downs) return 'up';
  if (downs > ups) return 'down';
  return 'range';
}
