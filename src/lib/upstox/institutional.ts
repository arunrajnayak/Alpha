import 'server-only';

import { getAccessToken } from './auth';
import { UpstoxError } from './types';
import { todayISTYmd } from '@/lib/tz';
import { logger } from '@/lib/logger';

const institutionalLogger = logger.scope('Institutional');
const BASE_URL = 'https://api.upstox.com/v2';
const IST_TZ = 'Asia/Kolkata';

export type InstitutionalInterval = 'Daily' | 'Weekly' | 'Monthly';

export interface UpstoxInstitutionalRecord {
  time_stamp: number;
  buy_amount: number;
  sell_amount: number;
  buy_contracts?: number;
  sell_contracts?: number;
  oi_contracts?: number;
  oi_amount?: number;
  total_long_contracts?: number;
  total_short_contracts?: number;
}

export interface InstitutionalActivityPoint {
  date: string;          // YYYY-MM-DD
  timestamp: number;     // Epoch ms
  displayDate: string;   // Short date for XAxis e.g. "04 Sep"
  fullDate: string;      // Full date for Tooltip e.g. "04 Sept 2026"
  fiiBuy: number;        // in Crores
  fiiSell: number;       // in Crores
  fiiNet: number;        // in Crores
  diiBuy: number;        // in Crores
  diiSell: number;       // in Crores
  diiNet: number;        // in Crores
  netOverall: number;    // fiiNet + diiNet in Crores
}

export interface InstitutionalActivityResponse {
  interval: InstitutionalInterval;
  points: InstitutionalActivityPoint[];
  summary: {
    latestDate: string;
    latestFiiNet: number;
    latestDiiNet: number;
    latestNetOverall: number;
  } | null;
  lastUpdated: string;
}

// ============================================================================
// Server-Side In-Memory Cache (15-min TTL)
// ============================================================================
interface CacheEntry {
  data: InstitutionalActivityResponse;
  cachedAt: number;
}

const memoryCache = new Map<InstitutionalInterval, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function clearInstitutionalCache(): void {
  memoryCache.clear();
}

// ============================================================================
// Raw Upstox API Fetchers
// ============================================================================
async function fetchUpstoxEndpoint(
  endpoint: 'fii' | 'dii',
  interval: '1D' | '1M',
  fromDate?: string
): Promise<UpstoxInstitutionalRecord[]> {
  const token = await getAccessToken();
  let url = `${BASE_URL}/market/${endpoint}?data_type=NSE_EQ|CASH&interval=${interval}`;
  if (fromDate) {
    url += `&from=${encodeURIComponent(fromDate)}`;
  }

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'AlphaPortfolioTracker/1.0 (Macintosh; Intel Mac OS X)',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new UpstoxError(
      `Upstox ${endpoint.toUpperCase()} cash market fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();
  const records: UpstoxInstitutionalRecord[] = json?.data?.['NSE_EQ|CASH'] || [];
  return records;
}

// ============================================================================
// IST Date Formatting Helpers
// ============================================================================
const dailyXFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TZ,
  day: '2-digit',
  month: 'short',
});

const dailyFullFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const monthlyXFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TZ,
  month: 'short',
  year: '2-digit',
});

const monthlyFullFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TZ,
  month: 'long',
  year: 'numeric',
});


// Helper to get ISO week key (e.g., "2026-W38") in IST
function getISTWeekKey(timestamp: number): { weekKey: string; startTimestamp: number; endTimestamp: number } {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value) - 1;
  const d = Number(parts.find((p) => p.type === 'day')?.value);

  // Reconstruct local midnight in IST reference
  const istDate = new Date(Date.UTC(y, m, d));
  const dayOfWeek = istDate.getUTCDay(); // 0 is Sunday, 1 is Monday ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(istDate);
  monday.setUTCDate(istDate.getUTCDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  const weekKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
  return {
    weekKey,
    startTimestamp: monday.getTime(),
    endTimestamp: friday.getTime(),
  };
}

// ============================================================================
// Service: Get Institutional Cash Activity
// ============================================================================
export async function getInstitutionalCashActivity(
  interval: InstitutionalInterval = 'Daily'
): Promise<InstitutionalActivityResponse> {
  const now = Date.now();
  const cached = memoryCache.get(interval);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  let points: InstitutionalActivityPoint[] = [];

  if (interval === 'Daily') {
    // 1D: Fetch up to 30 trading days
    const [fiiRecords, diiRecords] = await Promise.all([
      fetchUpstoxEndpoint('fii', '1D').catch((err) => {
        institutionalLogger.error('Failed to fetch FII 1D:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
      fetchUpstoxEndpoint('dii', '1D').catch((err) => {
        institutionalLogger.error('Failed to fetch DII 1D:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
    ]);

    const diiMap = new Map<number, UpstoxInstitutionalRecord>();
    for (const r of diiRecords) {
      diiMap.set(r.time_stamp, r);
    }

    const mergedPoints: InstitutionalActivityPoint[] = [];
    for (const fii of fiiRecords) {
      const dii = diiMap.get(fii.time_stamp);
      const fiiBuy = fii.buy_amount || 0;
      const fiiSell = fii.sell_amount || 0;
      const fiiNet = Number((fiiBuy - fiiSell).toFixed(2));

      const diiBuy = dii?.buy_amount || 0;
      const diiSell = dii?.sell_amount || 0;
      const diiNet = Number((diiBuy - diiSell).toFixed(2));

      const dateObj = new Date(fii.time_stamp);
      mergedPoints.push({
        date: todayISTYmd(new Date(fii.time_stamp)),
        timestamp: fii.time_stamp,
        displayDate: dailyXFormatter.format(dateObj),
        fullDate: dailyFullFormatter.format(dateObj),
        fiiBuy,
        fiiSell,
        fiiNet,
        diiBuy,
        diiSell,
        diiNet,
        netOverall: Number((fiiNet + diiNet).toFixed(2)),
      });
    }

    // Upstox returns newest first; sort chronological for the chart (left to right)
    mergedPoints.sort((a, b) => a.timestamp - b.timestamp);
    points = mergedPoints;
  } else if (interval === 'Weekly') {
    // Aggregate Daily records by calendar week (Monday to Friday)
    // Fetch recent daily data (up to 30 trading days = ~6-7 weeks of trading)
    const [fiiRecords, diiRecords] = await Promise.all([
      fetchUpstoxEndpoint('fii', '1D').catch((err) => {
        institutionalLogger.error('Failed to fetch FII 1D for Weekly:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
      fetchUpstoxEndpoint('dii', '1D').catch((err) => {
        institutionalLogger.error('Failed to fetch DII 1D for Weekly:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
    ]);

    const diiMap = new Map<number, UpstoxInstitutionalRecord>();
    for (const r of diiRecords) {
      diiMap.set(r.time_stamp, r);
    }

    interface WeeklyBucket {
      startTimestamp: number;
      endTimestamp: number;
      dates: string[];
      fiiBuy: number;
      fiiSell: number;
      diiBuy: number;
      diiSell: number;
    }

    const weeksMap = new Map<string, WeeklyBucket>();

    for (const fii of fiiRecords) {
      const dii = diiMap.get(fii.time_stamp);
      const { weekKey, startTimestamp, endTimestamp } = getISTWeekKey(fii.time_stamp);

      const existing = weeksMap.get(weekKey) || {
        startTimestamp,
        endTimestamp,
        dates: [],
        fiiBuy: 0,
        fiiSell: 0,
        diiBuy: 0,
        diiSell: 0,
      };

      existing.dates.push(todayISTYmd(new Date(fii.time_stamp)));
      existing.fiiBuy += fii.buy_amount || 0;
      existing.fiiSell += fii.sell_amount || 0;
      existing.diiBuy += dii?.buy_amount || 0;
      existing.diiSell += dii?.sell_amount || 0;

      weeksMap.set(weekKey, existing);
    }

    const sortedWeeks = Array.from(weeksMap.entries()).sort(
      (a, b) => a[1].startTimestamp - b[1].startTimestamp
    );

    points = sortedWeeks.map(([weekKey, bucket]) => {
      const fiiNet = Number((bucket.fiiBuy - bucket.fiiSell).toFixed(2));
      const diiNet = Number((bucket.diiBuy - bucket.diiSell).toFixed(2));
      const startDt = new Date(bucket.startTimestamp);
      const endDt = new Date(bucket.endTimestamp);

      const displayDate = `${dailyXFormatter.format(startDt)} - ${dailyXFormatter.format(endDt)}`;
      const fullDate = `Week of ${dailyFullFormatter.format(startDt)} (${bucket.dates.length} trading days)`;

      return {
        date: weekKey,
        timestamp: bucket.startTimestamp,
        displayDate,
        fullDate,
        fiiBuy: Number(bucket.fiiBuy.toFixed(2)),
        fiiSell: Number(bucket.fiiSell.toFixed(2)),
        fiiNet,
        diiBuy: Number(bucket.diiBuy.toFixed(2)),
        diiSell: Number(bucket.diiSell.toFixed(2)),
        diiNet,
        netOverall: Number((fiiNet + diiNet).toFixed(2)),
      };
    });
  } else if (interval === 'Monthly') {
    // 1M: Sourced directly from Upstox interval=1M
    const [fiiRecords, diiRecords] = await Promise.all([
      fetchUpstoxEndpoint('fii', '1M').catch((err) => {
        institutionalLogger.error('Failed to fetch FII 1M:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
      fetchUpstoxEndpoint('dii', '1M').catch((err) => {
        institutionalLogger.error('Failed to fetch DII 1M:', err);
        return [] as UpstoxInstitutionalRecord[];
      }),
    ]);

    const diiMap = new Map<number, UpstoxInstitutionalRecord>();
    for (const r of diiRecords) {
      diiMap.set(r.time_stamp, r);
    }

    const mergedPoints: InstitutionalActivityPoint[] = [];
    for (const fii of fiiRecords) {
      const dii = diiMap.get(fii.time_stamp);
      const fiiBuy = fii.buy_amount || 0;
      const fiiSell = fii.sell_amount || 0;
      const fiiNet = Number((fiiBuy - fiiSell).toFixed(2));

      const diiBuy = dii?.buy_amount || 0;
      const diiSell = dii?.sell_amount || 0;
      const diiNet = Number((diiBuy - diiSell).toFixed(2));

      const dateObj = new Date(fii.time_stamp);
      mergedPoints.push({
        date: todayISTYmd(new Date(fii.time_stamp)),
        timestamp: fii.time_stamp,
        displayDate: monthlyXFormatter.format(dateObj),
        fullDate: monthlyFullFormatter.format(dateObj),
        fiiBuy,
        fiiSell,
        fiiNet,
        diiBuy,
        diiSell,
        diiNet,
        netOverall: Number((fiiNet + diiNet).toFixed(2)),
      });
    }

    mergedPoints.sort((a, b) => a.timestamp - b.timestamp);
    points = mergedPoints;
  }

  // Calculate summary from the latest data point
  let summary = null;
  if (points.length > 0) {
    const latest = points[points.length - 1];
    summary = {
      latestDate: latest.fullDate,
      latestFiiNet: latest.fiiNet,
      latestDiiNet: latest.diiNet,
      latestNetOverall: latest.netOverall,
    };
  }

  const result: InstitutionalActivityResponse = {
    interval,
    points,
    summary,
    lastUpdated: new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TZ,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date()),
  };

  memoryCache.set(interval, { data: result, cachedAt: now });
  return result;
}
