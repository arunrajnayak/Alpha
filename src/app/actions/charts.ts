'use server';

/**
 * Server actions powering the Radar page: candle fetch + breakout scan.
 *
 * Leverages the existing Upstox historical API and instrument-key mapping,
 * plus the pure indicator lib in `src/lib/charts/candles.ts`.
 */

import { prisma } from '@/lib/db';
import { getHistoricalCandles } from '@/lib/upstox-client';
import { getInstrumentKeys } from '@/lib/instrument-service';
import { withConcurrency } from '@/lib/screener/utils';
import {
  toCandles,
  resample,
  computeBreakout,
  detectPivots,
  donchian,
  trendFromPivots,
  TIMEFRAME_CONFIG,
  type Timeframe,
  type Candle,
  type Pivot,
  type BreakoutSignal,
  type Trend,
} from '@/lib/charts/candles';

const DONCHIAN_N = 20;
const PIVOT_LOOKBACK = 3;
const MAX_BARS = 200; // cap payload for the chart

// ---------------------------------------------------------------------------
// Small in-memory cache (per server instance) keyed by symbol+timeframe.
// ---------------------------------------------------------------------------
interface CacheEntry {
  ts: number;
  candles: Candle[];
}
const candleCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function ymd(d: Date): string {
  // Format as YYYY-MM-DD in IST regardless of server timezone.
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function dateRange(lookbackDays: number): { from: string; to: string } {
  const now = Date.now();
  return {
    to: ymd(new Date(now)),
    from: ymd(new Date(now - lookbackDays * 24 * 60 * 60 * 1000)),
  };
}

/** Fetch native candles for a timeframe's base interval and resample. */
async function loadResampled(instrumentKey: string, tf: Timeframe): Promise<Candle[]> {
  const cfg = TIMEFRAME_CONFIG[tf];
  const cacheKey = `${instrumentKey}::${tf}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.candles;

  const { from, to } = dateRange(cfg.lookbackDays);
  const { candles: raw } = await getHistoricalCandles(instrumentKey, cfg.base, from, to);
  const base = toCandles(raw);
  const resampled = resample(base, cfg.factor);
  const trimmed = resampled.slice(-MAX_BARS);

  candleCache.set(cacheKey, { ts: Date.now(), candles: trimmed });
  return trimmed;
}

// ---------------------------------------------------------------------------
// validateSymbol — does this trading symbol map to a real instrument?
// ---------------------------------------------------------------------------
export async function validateSymbol(
  symbol: string,
): Promise<{ valid: boolean; symbol: string; instrumentKey: string | null }> {
  const clean = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  if (!clean) return { valid: false, symbol: clean, instrumentKey: null };
  try {
    const keyMap = await getInstrumentKeys([clean]);
    const instrumentKey = keyMap.get(clean) ?? null;
    return { valid: !!instrumentKey, symbol: clean, instrumentKey };
  } catch {
    return { valid: false, symbol: clean, instrumentKey: null };
  }
}

// ---------------------------------------------------------------------------
// Radar watchlist — DB-backed custom symbols (cross-device persistence).
// ---------------------------------------------------------------------------
function cleanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
}

// NOTE: these intentionally let DB errors propagate (reject) so the client can
// keep its optimistic/cached list instead of wiping it to an empty result.
export async function getWatchlist(): Promise<string[]> {
  const rows = await prisma.radarWatchlist.findMany({
    select: { symbol: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.symbol);
}

export async function addWatchlistSymbol(symbol: string): Promise<string[]> {
  const clean = cleanSymbol(symbol);
  if (!clean) return getWatchlist();
  await prisma.radarWatchlist.upsert({
    where: { symbol: clean },
    update: {},
    create: { symbol: clean },
  });
  return getWatchlist();
}

export async function removeWatchlistSymbol(symbol: string): Promise<string[]> {
  const clean = cleanSymbol(symbol);
  if (clean) {
    await prisma.radarWatchlist.deleteMany({ where: { symbol: clean } });
  }
  return getWatchlist();
}

// ---------------------------------------------------------------------------
// getCandles — full data for the selected symbol's chart.
// ---------------------------------------------------------------------------
export interface CandlesResult {
  symbol: string;
  timeframe: Timeframe;
  instrumentKey: string | null;
  candles: Candle[];
  pivots: Pivot[];
  donchianHigh: number | null;
  donchianLow: number | null;
  breakout: BreakoutSignal;
  trend: Trend;
  error?: string;
}

export async function getCandles(symbol: string, tf: Timeframe): Promise<CandlesResult> {
  const empty = (error?: string, instrumentKey: string | null = null): CandlesResult => ({
    symbol,
    timeframe: tf,
    instrumentKey,
    candles: [],
    pivots: [],
    donchianHigh: null,
    donchianLow: null,
    breakout: computeBreakout([], DONCHIAN_N),
    trend: 'range',
    error,
  });

  try {
    const keyMap = await getInstrumentKeys([symbol]);
    const instrumentKey = keyMap.get(symbol) ?? null;
    if (!instrumentKey) return empty('No instrument mapping', null);

    const candles = await loadResampled(instrumentKey, tf);
    if (candles.length === 0) return empty('No candle data', instrumentKey);

    const pivots = detectPivots(candles, PIVOT_LOOKBACK);
    const dc = donchian(candles, DONCHIAN_N);
    const breakout = computeBreakout(candles, DONCHIAN_N);

    return {
      symbol,
      timeframe: tf,
      instrumentKey,
      candles,
      pivots,
      donchianHigh: dc?.high ?? null,
      donchianLow: dc?.low ?? null,
      breakout,
      trend: trendFromPivots(pivots),
    };
  } catch (err) {
    return empty((err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// scanBreakouts — ranked breakout/breakdown list over a symbol universe.
// ---------------------------------------------------------------------------
export interface ScanRow {
  symbol: string;
  instrumentKey: string | null;
  direction: BreakoutSignal['direction'];
  volRatio: number;
  changePct: number;
  distancePct: number;
  lastClose: number;
  score: number;
  trend: Trend;
}

export interface ScanResult {
  timeframe: Timeframe;
  rows: ScanRow[];
  scannedAt: number;
  errors: number;
}

export async function scanBreakouts(symbols: string[], tf: Timeframe): Promise<ScanResult> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim()).filter(Boolean)));
  const keyMap = await getInstrumentKeys(unique);

  const rows: ScanRow[] = [];
  let errors = 0;

  await withConcurrency(
    unique,
    async (symbol) => {
      const instrumentKey = keyMap.get(symbol) ?? null;
      if (!instrumentKey) {
        errors++;
        return;
      }
      try {
        const candles = await loadResampled(instrumentKey, tf);
        if (candles.length < 2) {
          errors++;
          return;
        }
        const breakout = computeBreakout(candles, DONCHIAN_N);
        const pivots = detectPivots(candles, PIVOT_LOOKBACK);
        rows.push({
          symbol,
          instrumentKey,
          direction: breakout.direction,
          volRatio: breakout.volRatio,
          changePct: breakout.changePct,
          distancePct: breakout.distancePct,
          lastClose: breakout.lastClose,
          score: breakout.score,
          trend: trendFromPivots(pivots),
        });
      } catch {
        errors++;
      }
    },
    6,   // concurrency
    80,  // stagger between workers (ms) — avoid burst
    120, // throttle per request (ms)
  );

  rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return { timeframe: tf, rows, scannedAt: Date.now(), errors };
}
