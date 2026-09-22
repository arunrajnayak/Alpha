import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/upstox/auth';
import { getInstrumentKeys } from '@/lib/instrument-service';
import { computePortfolioState } from '@/lib/finance/recalculation';
import { format, subDays } from 'date-fns';
import { istDayOfWeek } from '@/lib/tz';
import { toDateStr } from '@/lib/screener/dates';
import { isTradingHoliday } from '@/lib/market-holidays-cache';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const sparklineLogger = logger.scope('LiveSparklines');

interface SparklineCacheEntry {
  data: Record<string, number[]>;
  timestamp: number;
}

// In-memory route cache (2 minutes TTL)
let memoryCache: SparklineCacheEntry | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

async function fetchCandlesForInstrument(
  instrumentKey: string,
  token: string,
  previousTradingDateStr: string
): Promise<number[]> {
  try {
    const encodedKey = encodeURIComponent(instrumentKey);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // 1. Always attempt today's intraday 5-min candles first.
    // Upstox serves today's session candles on /intraday during and after market hours until midnight.
    const intradayUrl = `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/5`;
    const res = await fetch(intradayUrl, {
      headers,
      next: { revalidate: 120 },
    });

    if (res.ok) {
      const json = await res.json();
      const candles = json?.data?.candles || [];
      if (candles.length > 0) {
        return processCandles(candles);
      }
    }

    // 2. Fallback to previous completed trading day (e.g. weekends, holidays, pre-market < 9:15 AM)
    const fallbackUrl = `https://api.upstox.com/v3/historical-candle/${encodedKey}/minutes/5/${previousTradingDateStr}/${previousTradingDateStr}`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers,
      next: { revalidate: 300 },
    });

    if (fallbackRes.ok) {
      const fallbackJson = await fallbackRes.json();
      const fallbackCandles = fallbackJson?.data?.candles || [];
      if (fallbackCandles.length > 0) {
        return processCandles(fallbackCandles);
      }
    }

    return [];
  } catch (err) {
    sparklineLogger.warn(`Failed to fetch candles for ${instrumentKey}:`, err);
    return [];
  }
}

/**
 * Upstox candles are returned newest-first: [timestamp, open, high, low, close, volume, oi].
 * We want chronological order (oldest to newest) and sample ~20 points for sparkline.
 */
function processCandles(rawCandles: Array<[string, number, number, number, number, number, number]>): number[] {
  if (!rawCandles || rawCandles.length === 0) return [];

  // Reverse so it's chronological: oldest -> newest
  const sorted = [...rawCandles].reverse();
  const closes = sorted.map(c => c[4]); // close price

  // If we have <= 25 points, return all
  if (closes.length <= 25) return closes;

  // Sample down to ~20-25 points preserving first and last
  const targetCount = 20;
  const step = (closes.length - 1) / (targetCount - 1);
  const sampled: number[] = [];

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(Math.round(i * step), closes.length - 1);
    sampled.push(closes[idx]);
  }

  // Ensure last point is exactly the most recent close
  sampled[sampled.length - 1] = closes[closes.length - 1];

  return sampled;
}

// Concurrency limiter
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then(res => {
      results.push(res);
    });
    const e: Promise<void> = p.then(() => {
      executing.splice(executing.indexOf(e), 1);
    });
    executing.push(e);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

async function getPreviousTradingDate(): Promise<string> {
  let d = subDays(new Date(), 1);
  // If weekend or holiday, step back
  for (let i = 0; i < 10; i++) {
    const day = istDayOfWeek(d);
    const isHoliday = await isTradingHoliday(d);
    if (day >= 1 && day <= 5 && !isHoliday) {
      return toDateStr(d);
    }
    d = subDays(d, 1);
  }
  return format(subDays(new Date(), 1), 'yyyy-MM-dd');
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    if (memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({
        status: 'success',
        sparklines: memoryCache.data,
        cached: true,
      });
    }

    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    let symbols: string[] = [];
    if (symbolsParam) {
      symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else {
      const engine = await computePortfolioState(new Date());
      symbols = Array.from(engine.holdings.values())
        .filter(h => h.qty > 0.01)
        .map(h => h.symbol);
    }

    if (symbols.length === 0) {
      return NextResponse.json({ status: 'success', sparklines: {} });
    }

    const token = await getAccessToken().catch(() => '');
    const instrumentKeyMap = await getInstrumentKeys(symbols);
    const previousTradingDateStr = await getPreviousTradingDate();

    const sparklinesMap: Record<string, number[]> = {};

    const itemsToFetch = symbols
      .map(sym => ({ symbol: sym, key: instrumentKeyMap.get(sym) }))
      .filter((item): item is { symbol: string; key: string } => !!item.key);

    await mapConcurrent(itemsToFetch, 8, async ({ symbol, key }) => {
      const points = await fetchCandlesForInstrument(key, token, previousTradingDateStr);
      if (points.length > 0) {
        sparklinesMap[symbol] = points;
      }
    });

    memoryCache = {
      data: sparklinesMap,
      timestamp: now,
    };

    return NextResponse.json({
      status: 'success',
      sparklines: sparklinesMap,
      cached: false,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err: any) {
    sparklineLogger.error('Failed to get intraday sparklines:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch sparklines' },
      { status: 500 }
    );
  }
}
