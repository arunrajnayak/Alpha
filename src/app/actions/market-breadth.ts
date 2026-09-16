'use server';

/**
 * Market Breadth & Health Server Action
 *
 * Provides real-time advances/declines and stock moves distribution
 * across all active NSE stocks, as well as historical market health
 * breadth metrics (DMA & ATH breadth trends).
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { prisma } from '@/lib/db';
import { getLiveQuotes } from '@/lib/upstox/client';
import { hasValidToken } from '@/lib/upstox-client';
import { ensureInstrumentMaster } from '@/lib/upstox/instruments';
import { logger } from '@/lib/logger';
import { isMarketOpen, isPreOpenSession } from '@/lib/market-status-utils';
import { isTradingHoliday } from '@/lib/market-holidays-cache';
import { istDayOfWeek, todayISTYmd } from '@/lib/tz';

const breadthLogger = logger.scope('MarketBreadth');

// ============================================================================
// Types
// ============================================================================

export interface DistributionBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  percent: number;
}

export interface CapTierBreadth {
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
  advPercent: number;
}

export interface TopMoverItem {
  symbol: string;
  changePercent: number;
  lastPrice: number;
}

export interface NSEMarketBreadthData {
  total: number;
  advances: number;
  declines: number;
  unchanged: number;
  advPercent: number;
  decPercent: number;
  adRatio: number;
  netAdvances: number;
  distribution: DistributionBucket[];
  athDistribution: DistributionBucket[];
  athTrackedStocks?: number;
  tiers: {
    large: CapTierBreadth;
    mid: CapTierBreadth;
    small: CapTierBreadth;
    micro: CapTierBreadth;
  };
  topGainers: TopMoverItem[];
  topLosers: TopMoverItem[];
  medianMove: number;
  marketStatus: 'OPEN' | 'CLOSED' | 'PRE_OPEN';
  lastUpdated: string;
  isLive: boolean;
  tokenStatus?: {
    hasToken: boolean;
    message?: string;
  };
}

export interface MarketHealthPoint {
  date: string;
  totalStocks: number;
  pctAbove200Dma: number;
  pctAbove100Dma: number;
  pctAbove50Dma: number;
  pctAbove20Dma: number;
  pctNearAth10: number;
  pctNearAth20: number;
  pctNearAth30: number;
}

export interface MarketHealthHistoryData {
  history: MarketHealthPoint[];
  currentStats: {
    pctAbove200Dma: number;
    pctAbove100Dma: number;
    pctAbove50Dma: number;
    pctAbove20Dma: number;
    pctNearAth10: number;
    pctNearAth20: number;
    pctNearAth30: number;
    totalStocks: number;
    regime: 'Strong Bullish' | 'Bullish' | 'Neutral' | 'Bearish / Correction';
  };
}

export interface IntradayBreadthPoint {
  time: string;
  timestamp: string;
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
  netAdvances: number;
  adRatio: number;
}

export interface IntradayMarketBreadthData {
  date: string;
  isToday: boolean;
  points: IntradayBreadthPoint[];
}

// ============================================================================
// In-Memory Cache
// ============================================================================

interface UniverseItem {
  symbol: string;
  instrumentKey: string;
  category: 'large' | 'mid' | 'small' | 'micro';
  currentPrice: number;
  ath: number;
  prevPrice?: number;
}

let cachedUniverse: UniverseItem[] | null = null;
let universeCacheTime = 0;
const UNIVERSE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedBreadthData: NSEMarketBreadthData | null = null;
let breadthCacheTime = 0;
const BREADTH_CACHE_TTL_MS = 6000; // 6 seconds server-side cache for 10s client polling
let lastSavedBreadthTime = 0;

// Helper for median
function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const NSE_ACTIVE_UNIVERSE_CONFIG_KEY = 'nse_active_equity_universe';
const LATEST_NSE_BREADTH_CONFIG_KEY = 'latest_nse_market_breadth';

// Load active NSE stock universe (All ~3,394 NSE listed equities)
async function getActiveNSEUniverse(): Promise<UniverseItem[]> {
  const now = Date.now();
  if (cachedUniverse && cachedUniverse.length >= 3000 && now - universeCacheTime < UNIVERSE_CACHE_TTL_MS) {
    return cachedUniverse;
  }

  // 1. Try to load from instrument master JSON file if it exists or is downloaded
  try {
    await ensureInstrumentMaster();
    const primaryPath = '/tmp/upstox-cache/nse_instruments.json';
    const fallbackPath = path.join(os.tmpdir(), 'upstox-cache', 'nse_instruments.json');
    const targetFile = existsSync(primaryPath) ? primaryPath : existsSync(fallbackPath) ? fallbackPath : null;

    if (targetFile) {
      const data = await fs.readFile(targetFile, 'utf-8');
      const instruments: Array<{
        instrument_key: string;
        trading_symbol?: string;
        tradingsymbol?: string;
        instrument_type: string;
        name?: string;
      }> = JSON.parse(data);

      // Filter for all active NSE equity instruments (EQ, BE, SM SME, BZ)
      const equityInstruments = instruments.filter(
        (i) =>
          i.instrument_key?.startsWith('NSE_EQ') &&
          ['EQ', 'BE', 'SM', 'BZ'].includes(i.instrument_type)
      );

      if (equityInstruments.length >= 3000) {
        // Load AMFI classifications for cap tier mapping (Large, Mid, Small)
        const amfiRecords = await prisma.aMFIClassification.findMany({
          select: { symbol: true, category: true },
          distinct: ['symbol'],
        });
        const amfiMap = new Map<string, 'large' | 'mid' | 'small' | 'micro'>();
        for (const a of amfiRecords) {
          const cat = (a.category || '').toLowerCase();
          if (cat.includes('large')) amfiMap.set(a.symbol.toUpperCase(), 'large');
          else if (cat.includes('mid')) amfiMap.set(a.symbol.toUpperCase(), 'mid');
          else if (cat.includes('small')) amfiMap.set(a.symbol.toUpperCase(), 'small');
        }

        // Load ATH from StockATH
        const athRecords = await prisma.stockATH.findMany({
          select: { symbol: true, ath: true },
        });
        const athMap = new Map<string, number>();
        for (const a of athRecords) {
          if (a.ath > 0) athMap.set(a.symbol.toUpperCase(), a.ath);
        }

        const items: UniverseItem[] = equityInstruments
          .map((inst) => {
            const symbol = (inst.trading_symbol || inst.tradingsymbol || '').toUpperCase();
            const category = amfiMap.get(symbol) || 'micro';
            const ath = athMap.get(symbol) || 0;
            return {
              symbol,
              instrumentKey: inst.instrument_key,
              category,
              currentPrice: 0,
              ath,
            };
          })
          .filter((i) => i.symbol && i.instrumentKey);

        if (items.length >= 3000) {
          cachedUniverse = items;
          universeCacheTime = now;
          // Keep AppConfig in Turso updated so serverless instances have instant access
          prisma.appConfig.upsert({
            where: { key: NSE_ACTIVE_UNIVERSE_CONFIG_KEY },
            update: { value: JSON.stringify(items) },
            create: { key: NSE_ACTIVE_UNIVERSE_CONFIG_KEY, value: JSON.stringify(items) },
          }).catch(() => {});
          breadthLogger.info(`Loaded ${items.length} all-NSE active equity keys for market breadth`);
          return items;
        }
      }
    }
  } catch (error) {
    breadthLogger.warn('Could not load from instrument master file, checking AppConfig:', error);
  }

  // 2. Primary Persistent Source: Load full universe from AppConfig in Turso
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: NSE_ACTIVE_UNIVERSE_CONFIG_KEY },
    });
    if (config?.value) {
      const items: UniverseItem[] = JSON.parse(config.value);
      if (items.length >= 3000) {
        cachedUniverse = items;
        universeCacheTime = now;
        breadthLogger.info(`Loaded ${items.length} all-NSE active equity keys from AppConfig`);
        return items;
      }
    }
  } catch (error) {
    breadthLogger.warn('Failed to load universe from AppConfig:', error);
  }

  // 3. Fallback to existing cachedUniverse if available
  if (cachedUniverse && cachedUniverse.length >= 3000) {
    return cachedUniverse;
  }

  return cachedUniverse || [];
}

// Build empty stock moves buckets template (including +/- 10% and +/- 15% baskets)
function createEmptyBuckets(): DistributionBucket[] {
  return [
    { label: '< -15%', min: -Infinity, max: -15, count: 0, percent: 0 },
    { label: '-15% to -10%', min: -15, max: -10, count: 0, percent: 0 },
    { label: '-10% to -5%', min: -10, max: -5, count: 0, percent: 0 },
    { label: '-5% to -3%', min: -5, max: -3, count: 0, percent: 0 },
    { label: '-3% to -1%', min: -3, max: -1, count: 0, percent: 0 },
    { label: '-1% to 0%', min: -1, max: -0.01, count: 0, percent: 0 },
    { label: '0%', min: -0.01, max: 0.01, count: 0, percent: 0 },
    { label: '0% to +1%', min: 0.01, max: 1, count: 0, percent: 0 },
    { label: '+1% to +3%', min: 1, max: 3, count: 0, percent: 0 },
    { label: '+3% to +5%', min: 3, max: 5, count: 0, percent: 0 },
    { label: '+5% to +10%', min: 5, max: 10, count: 0, percent: 0 },
    { label: '+10% to +15%', min: 10, max: 15, count: 0, percent: 0 },
    { label: '> +15%', min: 15, max: Infinity, count: 0, percent: 0 },
  ];
}

// Build fine-grained ATH drawdown buckets: 100 × 1% buckets (0-1%, 1-2%, …, 99-100%+)
function createEmptyATHBuckets(): DistributionBucket[] {
  const buckets: DistributionBucket[] = [];
  for (let i = 0; i < 100; i++) {
    buckets.push({ label: `${i}%`, min: i, max: i === 99 ? Infinity : i + 1, count: 0, percent: 0 });
  }
  return buckets;
}

function upgradeAthDistributionTo100(oldBuckets?: DistributionBucket[]): DistributionBucket[] {
  const newBuckets = createEmptyATHBuckets();
  if (!oldBuckets || oldBuckets.length === 0) return newBuckets;
  if (oldBuckets.length === 100) return oldBuckets;

  for (const b of oldBuckets) {
    const min = Math.max(0, Math.floor(b.min));
    const max = b.max === Infinity ? 100 : Math.min(100, Math.ceil(b.max));
    const span = Math.max(1, max - min);
    const countPerBucket = b.count / span;
    const percentPerBucket = b.percent / span;
    for (let i = min; i < max; i++) {
      newBuckets[i].count += countPerBucket;
      newBuckets[i].percent += percentPerBucket;
    }
  }

  for (const b of newBuckets) {
    b.count = Math.round(b.count);
    b.percent = Number(b.percent.toFixed(2));
  }
  return newBuckets;
}

// ============================================================================
// Server Action: fetchNSEMarketBreadth
// ============================================================================

export async function fetchNSEMarketBreadth(forceRefresh = false): Promise<NSEMarketBreadthData> {
  const now = Date.now();
  if (!forceRefresh && cachedBreadthData && now - breadthCacheTime < BREADTH_CACHE_TTL_MS) {
    return cachedBreadthData;
  }

  // 1. Market Status
  const isHoliday = await isTradingHoliday(new Date());
  const day = istDayOfWeek(new Date());
  const isTradingDayToday = day >= 1 && day <= 5 && !isHoliday;
  const isPreOpen = isTradingDayToday && isPreOpenSession();
  const isRegularOpen = isTradingDayToday && isMarketOpen();

  let marketStatus: 'OPEN' | 'CLOSED' | 'PRE_OPEN' = 'CLOSED';
  if (isRegularOpen) {
    marketStatus = 'OPEN';
  } else if (isPreOpen) {
    marketStatus = 'PRE_OPEN';
  }

  // 2. Check token
  const hasToken = await hasValidToken();
  const tokenStatus = {
    hasToken,
    message: hasToken ? undefined : 'No active Upstox token available',
  };

  const universe = await getActiveNSEUniverse();
  if (universe.length === 0) {
    return {
      total: 0,
      advances: 0,
      declines: 0,
      unchanged: 0,
      advPercent: 0,
      decPercent: 0,
      adRatio: 0,
      netAdvances: 0,
      distribution: createEmptyBuckets(),
      athDistribution: createEmptyATHBuckets(),
      tiers: {
        large: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
        mid: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
        small: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
        micro: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
      },
      topGainers: [],
      topLosers: [],
      medianMove: 0,
      marketStatus,
      lastUpdated: new Date().toISOString(),
      isLive: false,
      tokenStatus,
    };
  }

  // 3. Try live quotes if token is valid
  let isLive = false;
  const moves: Array<{
    symbol: string;
    changePercent: number;
    lastPrice: number;
    category: 'large' | 'mid' | 'small' | 'micro';
    awayFromAth: number | null;
  }> = [];

  if (hasToken) {
    try {
      const keys = universe.map((u) => u.instrumentKey);
      const quotesMap = await getLiveQuotes(keys);

      if (quotesMap.size > 0) {
        isLive = true;
        for (const item of universe) {
          const q = quotesMap.get(item.instrumentKey);
          if (q && q.previous_close > 0 && q.last_price > 0) {
            const changePercent = ((q.last_price - q.previous_close) / q.previous_close) * 100;
            const awayFromAth = item.ath > 0 ? Math.max(0, ((item.ath - q.last_price) / item.ath) * 100) : null;
            moves.push({
              symbol: item.symbol,
              changePercent,
              lastPrice: q.last_price,
              category: item.category,
              awayFromAth,
            });
          }
        }
      }
    } catch (err) {
      breadthLogger.error('Error fetching live quotes for market breadth:', err);
    }
  }

  // 4. Fallback if live quotes were not obtained or returned insufficient data (< 3000)
  if (moves.length < 3000) {
    // 4a. If in-memory cache has full breadth data, use it
    if (cachedBreadthData && cachedBreadthData.total >= 3000) {
      return {
        ...cachedBreadthData,
        marketStatus,
        tokenStatus,
        isLive: false,
      };
    }

    // 4b. Load latest full breadth snapshot from AppConfig in Turso
    try {
      const config = await prisma.appConfig.findUnique({
        where: { key: LATEST_NSE_BREADTH_CONFIG_KEY },
      });
      if (config?.value) {
        const stored: NSEMarketBreadthData = JSON.parse(config.value);
        if (stored && stored.total >= 3000) {
          if (stored.athDistribution && stored.athDistribution.length !== 100) {
            stored.athDistribution = upgradeAthDistributionTo100(stored.athDistribution);
          }
          cachedBreadthData = stored;
          breadthCacheTime = now;
          return {
            ...stored,
            marketStatus,
            tokenStatus,
            isLive: false,
          };
        }
      }
    } catch (err) {
      breadthLogger.error('Failed to load fallback breadth from AppConfig:', err);
    }

    // 4c. Load latest IntradayMarketBreadth record with total >= 3000
    try {
      const latestBreadth = await prisma.intradayMarketBreadth.findFirst({
        where: { total: { gte: 3000 } },
        orderBy: { timestamp: 'desc' },
      });

      if (latestBreadth) {
        const advPercent =
          latestBreadth.total > 0
            ? Number(((latestBreadth.advances / latestBreadth.total) * 100).toFixed(1))
            : 0;
        const decPercent =
          latestBreadth.total > 0
            ? Number(((latestBreadth.declines / latestBreadth.total) * 100).toFixed(1))
            : 0;
        const largeAdv = latestBreadth.largeAdv ?? 0;
        const largeDec = latestBreadth.largeDec ?? 0;
        const largeTotal = largeAdv + largeDec;

        const midAdv = latestBreadth.midAdv ?? 0;
        const midDec = latestBreadth.midDec ?? 0;
        const midTotal = midAdv + midDec;

        const smallAdv = latestBreadth.smallAdv ?? 0;
        const smallDec = latestBreadth.smallDec ?? 0;
        const smallTotal = smallAdv + smallDec;

        const microAdv = latestBreadth.microAdv ?? 0;
        const microDec = latestBreadth.microDec ?? 0;
        const microTotal = microAdv + microDec;

        const fallbackResult: NSEMarketBreadthData = {
          total: latestBreadth.total,
          advances: latestBreadth.advances,
          declines: latestBreadth.declines,
          unchanged: latestBreadth.unchanged,
          advPercent,
          decPercent,
          adRatio: latestBreadth.adRatio,
          netAdvances: latestBreadth.netAdvances,
          distribution: createEmptyBuckets(),
          athDistribution: createEmptyATHBuckets(),
          tiers: {
            large: {
              advances: largeAdv,
              declines: largeDec,
              unchanged: 0,
              total: largeTotal,
              advPercent: largeTotal > 0 ? Number(((largeAdv / largeTotal) * 100).toFixed(1)) : 0,
            },
            mid: {
              advances: midAdv,
              declines: midDec,
              unchanged: 0,
              total: midTotal,
              advPercent: midTotal > 0 ? Number(((midAdv / midTotal) * 100).toFixed(1)) : 0,
            },
            small: {
              advances: smallAdv,
              declines: smallDec,
              unchanged: 0,
              total: smallTotal,
              advPercent: smallTotal > 0 ? Number(((smallAdv / smallTotal) * 100).toFixed(1)) : 0,
            },
            micro: {
              advances: microAdv,
              declines: microDec,
              unchanged: 0,
              total: microTotal,
              advPercent: microTotal > 0 ? Number(((microAdv / microTotal) * 100).toFixed(1)) : 0,
            },
          },
          topGainers: [],
          topLosers: [],
          medianMove: 0,
          marketStatus,
          lastUpdated: latestBreadth.timestamp.toISOString(),
          isLive: false,
          tokenStatus,
        };

        return fallbackResult;
      }
    } catch (err) {
      breadthLogger.error('Failed to load fallback breadth from IntradayMarketBreadth:', err);
    }
  }

  // 5. Aggregate metrics
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let athTotalWithData = 0;

  const tiers: NSEMarketBreadthData['tiers'] = {
    large: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
    mid: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
    small: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
    micro: { advances: 0, declines: 0, unchanged: 0, total: 0, advPercent: 0 },
  };

  const buckets = createEmptyBuckets();
  const athBuckets = createEmptyATHBuckets();

  for (const m of moves) {
    const tier = tiers[m.category];
    tier.total++;

    if (m.changePercent > 0.01) {
      advances++;
      tier.advances++;
    } else if (m.changePercent < -0.01) {
      declines++;
      tier.declines++;
    } else {
      unchanged++;
      tier.unchanged++;
    }

    // Stock moves bucket assignment
    for (const b of buckets) {
      if (m.changePercent >= b.min && m.changePercent < b.max) {
        b.count++;
        break;
      }
    }

    // ATH drawdown bucket assignment (only for stocks with valid ATH history)
    if (m.awayFromAth !== null && m.awayFromAth !== undefined && !isNaN(m.awayFromAth)) {
      const athIdx = Math.min(99, Math.max(0, Math.floor(m.awayFromAth)));
      athBuckets[athIdx].count++;
      athTotalWithData++;
    }
  }

  const total = moves.length;

  // Percentage calculations
  for (const b of buckets) {
    b.percent = total > 0 ? Number(((b.count / total) * 100).toFixed(1)) : 0;
  }

  for (const b of athBuckets) {
    b.percent = athTotalWithData > 0 ? Number(((b.count / athTotalWithData) * 100).toFixed(2)) : 0;
  }

  for (const t of Object.values(tiers)) {
    t.advPercent = t.total > 0 ? Number(((t.advances / t.total) * 100).toFixed(1)) : 0;
  }

  const advPercent = total > 0 ? Number(((advances / total) * 100).toFixed(1)) : 0;
  const decPercent = total > 0 ? Number(((declines / total) * 100).toFixed(1)) : 0;
  const adRatio = declines > 0 ? Number((advances / declines).toFixed(2)) : advances;
  const netAdvances = advances - declines;

  // Top gainers & losers
  const sorted = [...moves].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers: TopMoverItem[] = sorted
    .filter((s) => s.changePercent > 0)
    .slice(0, 10)
    .map((s) => ({
      symbol: s.symbol,
      changePercent: Number(s.changePercent.toFixed(2)),
      lastPrice: s.lastPrice,
    }));

  const losers = sorted.filter((s) => s.changePercent < 0);
  const topLosers: TopMoverItem[] = losers
    .slice(-Math.min(10, losers.length))
    .reverse()
    .map((s) => ({
      symbol: s.symbol,
      changePercent: Number(s.changePercent.toFixed(2)),
      lastPrice: s.lastPrice,
    }));

  const medianMove = Number(computeMedian(moves.map((m) => m.changePercent)).toFixed(2));

  const result: NSEMarketBreadthData = {
    total,
    advances,
    declines,
    unchanged,
    advPercent,
    decPercent,
    adRatio,
    netAdvances,
    distribution: buckets,
    athDistribution: athBuckets,
    athTrackedStocks: athTotalWithData,
    tiers,
    topGainers,
    topLosers,
    medianMove,
    marketStatus,
    lastUpdated: new Date().toISOString(),
    isLive,
    tokenStatus,
  };

  cachedBreadthData = result;
  breadthCacheTime = now;

  // Persist latest complete breadth snapshot to AppConfig so all serverless instances have access
  if (result.total >= 3000) {
    prisma.appConfig
      .upsert({
        where: { key: LATEST_NSE_BREADTH_CONFIG_KEY },
        update: { value: JSON.stringify(result) },
        create: { key: LATEST_NSE_BREADTH_CONFIG_KEY, value: JSON.stringify(result) },
      })
      .catch((err) => breadthLogger.warn('Failed to cache latest breadth to AppConfig:', err));
  }

  // Auto-record snapshot if market is currently open, we have full universe (>= 3000), and at least 2 minutes passed
  if (isLive && marketStatus === 'OPEN' && total >= 3000 && now - lastSavedBreadthTime > 2 * 60 * 1000) {
    lastSavedBreadthTime = now;
    saveIntradayMarketBreadth(result).catch((err) => {
      breadthLogger.error('Auto-save of intraday breadth failed:', err);
    });
  }

  return result;
}

// ============================================================================
// Server Action: fetchMarketHealthHistory
// ============================================================================

export type MarketHealthPeriod = '6M' | '1Y' | 'ALL';

export async function fetchMarketHealthHistory(
  period: MarketHealthPeriod | '1Y' | 'ALL' = '1Y'
): Promise<MarketHealthHistoryData> {
  try {
    let combinedHistory: Array<{
      date: string;
      totalStocks: number;
      pctAbove200Dma: number;
      pctAbove100Dma: number;
      pctAbove50Dma: number;
      pctAbove20Dma: number;
      pctNearAth10: number;
      pctNearAth20: number;
      pctNearAth30: number;
    }> = [];

    // 1. Try reading precomputed history from AppConfig
    try {
      const config = await prisma.appConfig.findUnique({
        where: { key: 'market_health_history_daily' },
      });
      if (config?.value) {
        combinedHistory = JSON.parse(config.value);
      }
    } catch (err) {
      breadthLogger.warn('Failed to read precomputed market health history from AppConfig:', err);
    }

    const lastCachedDate = combinedHistory.length > 0 ? combinedHistory[combinedHistory.length - 1].date : null;

    // 2. Query MomentumScore for any dates newer than our cached history (or all if no cache)
    if (lastCachedDate) {
      const newerRows = await prisma.$queryRaw<
        Array<{
          computedDate: string;
          totalStocks: number;
          pctAbove200Dma: number;
          pctAbove100Dma: number;
          pctAbove50Dma: number;
          pctAbove20Dma: number;
          pctNearAth10: number;
          pctNearAth20: number;
          pctNearAth30: number;
        }>
      >`
        SELECT 
          computedDate,
          COUNT(*) as totalStocks,
          ROUND(AVG(aboveDma200Pct > 0) * 100, 1) as pctAbove200Dma,
          ROUND(AVG(aboveDma100) * 100, 1) as pctAbove100Dma,
          ROUND(AVG(aboveDma50) * 100, 1) as pctAbove50Dma,
          ROUND(AVG(aboveDma20) * 100, 1) as pctAbove20Dma,
          ROUND(AVG(athProximity >= 0.90) * 100, 1) as pctNearAth10,
          ROUND(AVG(athProximity >= 0.80) * 100, 1) as pctNearAth20,
          ROUND(AVG(athProximity >= 0.70) * 100, 1) as pctNearAth30
        FROM "MomentumScore"
        WHERE rankType = 'all' AND computedDate > ${lastCachedDate}
        GROUP BY computedDate
        ORDER BY computedDate ASC
      `;

      if (newerRows && newerRows.length > 0) {
        for (const h of newerRows) {
          combinedHistory.push({
            date: h.computedDate,
            totalStocks: Number(h.totalStocks),
            pctAbove200Dma: Number(h.pctAbove200Dma),
            pctAbove100Dma: Number(h.pctAbove100Dma),
            pctAbove50Dma: Number(h.pctAbove50Dma),
            pctAbove20Dma: Number(h.pctAbove20Dma),
            pctNearAth10: Number(h.pctNearAth10),
            pctNearAth20: Number(h.pctNearAth20),
            pctNearAth30: Number(h.pctNearAth30),
          });
        }
      }
    } else {
      // Fallback if AppConfig cache is empty: read directly from MomentumScore
      const rawHistory = await prisma.$queryRaw<
        Array<{
          computedDate: string;
          totalStocks: number;
          pctAbove200Dma: number;
          pctAbove100Dma: number;
          pctAbove50Dma: number;
          pctAbove20Dma: number;
          pctNearAth10: number;
          pctNearAth20: number;
          pctNearAth30: number;
        }>
      >`
        SELECT 
          computedDate,
          COUNT(*) as totalStocks,
          ROUND(AVG(aboveDma200Pct > 0) * 100, 1) as pctAbove200Dma,
          ROUND(AVG(aboveDma100) * 100, 1) as pctAbove100Dma,
          ROUND(AVG(aboveDma50) * 100, 1) as pctAbove50Dma,
          ROUND(AVG(aboveDma20) * 100, 1) as pctAbove20Dma,
          ROUND(AVG(athProximity >= 0.90) * 100, 1) as pctNearAth10,
          ROUND(AVG(athProximity >= 0.80) * 100, 1) as pctNearAth20,
          ROUND(AVG(athProximity >= 0.70) * 100, 1) as pctNearAth30
        FROM "MomentumScore"
        WHERE rankType = 'all'
        GROUP BY computedDate
        ORDER BY computedDate ASC
      `;

      if (rawHistory && rawHistory.length > 0) {
        combinedHistory = rawHistory.map((h) => ({
          date: h.computedDate,
          totalStocks: Number(h.totalStocks),
          pctAbove200Dma: Number(h.pctAbove200Dma),
          pctAbove100Dma: Number(h.pctAbove100Dma),
          pctAbove50Dma: Number(h.pctAbove50Dma),
          pctAbove20Dma: Number(h.pctAbove20Dma),
          pctNearAth10: Number(h.pctNearAth10),
          pctNearAth20: Number(h.pctNearAth20),
          pctNearAth30: Number(h.pctNearAth30),
        }));
      }
    }

    if (combinedHistory.length === 0) {
      return {
        history: [],
        currentStats: {
          pctAbove200Dma: 0,
          pctAbove100Dma: 0,
          pctAbove50Dma: 0,
          pctAbove20Dma: 0,
          pctNearAth10: 0,
          pctNearAth20: 0,
          pctNearAth30: 0,
          totalStocks: 0,
          regime: 'Neutral',
        },
      };
    }

    // 3. Filter by period (6M = 125 trading days, 1Y = 250 trading days, ALL = entire history)
    let sliceLength = combinedHistory.length;
    if (period === '6M') sliceLength = 125;
    else if (period === '1Y') sliceLength = 250;

    const filtered = combinedHistory.slice(-Math.min(sliceLength, combinedHistory.length));
    const latest = combinedHistory[combinedHistory.length - 1];

    // Determine market health regime
    let regime: MarketHealthHistoryData['currentStats']['regime'] = 'Neutral';
    if (latest.pctAbove200Dma >= 65 && latest.pctAbove50Dma >= 55) {
      regime = 'Strong Bullish';
    } else if (latest.pctAbove200Dma >= 50 && latest.pctAbove50Dma >= 45) {
      regime = 'Bullish';
    } else if (latest.pctAbove200Dma < 40 || latest.pctAbove50Dma < 35) {
      regime = 'Bearish / Correction';
    }

    return {
      history: filtered.map((h) => ({
        date: h.date,
        totalStocks: Number(h.totalStocks),
        pctAbove200Dma: Number(h.pctAbove200Dma),
        pctAbove100Dma: Number(h.pctAbove100Dma),
        pctAbove50Dma: Number(h.pctAbove50Dma),
        pctAbove20Dma: Number(h.pctAbove20Dma),
        pctNearAth10: Number(h.pctNearAth10),
        pctNearAth20: Number(h.pctNearAth20),
        pctNearAth30: Number(h.pctNearAth30),
      })),
      currentStats: {
        pctAbove200Dma: Number(latest.pctAbove200Dma),
        pctAbove100Dma: Number(latest.pctAbove100Dma),
        pctAbove50Dma: Number(latest.pctAbove50Dma),
        pctAbove20Dma: Number(latest.pctAbove20Dma),
        pctNearAth10: Number(latest.pctNearAth10),
        pctNearAth20: Number(latest.pctNearAth20),
        pctNearAth30: Number(latest.pctNearAth30),
        totalStocks: Number(latest.totalStocks),
        regime,
      },
    };
  } catch (error) {
    breadthLogger.error('Failed to fetch market health history:', error);
    return {
      history: [],
      currentStats: {
        pctAbove200Dma: 0,
        pctAbove100Dma: 0,
        pctAbove50Dma: 0,
        pctAbove20Dma: 0,
        pctNearAth10: 0,
        pctNearAth20: 0,
        pctNearAth30: 0,
        totalStocks: 0,
        regime: 'Neutral',
      },
    };
  }
}

// ============================================================================
// Server Action: saveIntradayMarketBreadth
// ============================================================================

export async function saveIntradayMarketBreadth(
  breadthData: NSEMarketBreadthData
): Promise<boolean> {
  try {
    if (!breadthData || breadthData.total < 3000) {
      breadthLogger.warn(`Skipping saveIntradayMarketBreadth: total (${breadthData?.total}) is below 3000`);
      return false;
    }
    const today = todayISTYmd();

    await prisma.intradayMarketBreadth.create({
      data: {
        date: today,
        timestamp: new Date(),
        advances: breadthData.advances,
        declines: breadthData.declines,
        unchanged: breadthData.unchanged,
        total: breadthData.total,
        adRatio: breadthData.adRatio,
        netAdvances: breadthData.netAdvances,
        largeAdv: breadthData.tiers.large.advances,
        largeDec: breadthData.tiers.large.declines,
        midAdv: breadthData.tiers.mid.advances,
        midDec: breadthData.tiers.mid.declines,
        smallAdv: breadthData.tiers.small.advances,
        smallDec: breadthData.tiers.small.declines,
        microAdv: breadthData.tiers.micro.advances,
        microDec: breadthData.tiers.micro.declines,
      },
    });

    breadthLogger.info(
      `Saved intraday breadth for ${today}: Adv=${breadthData.advances}, Dec=${breadthData.declines}, Net=${breadthData.netAdvances}`
    );
    return true;
  } catch (error) {
    breadthLogger.error('Failed to save intraday market breadth:', error);
    return false;
  }
}

// ============================================================================
// Server Action: getIntradayMarketBreadth
// ============================================================================

export async function getIntradayMarketBreadth(
  targetDate?: string
): Promise<IntradayMarketBreadthData> {
  const today = todayISTYmd();
  let selectedDate = targetDate || today;

  try {
    // If no targetDate passed, check if we have data for today
    if (!targetDate) {
      const countToday = await prisma.intradayMarketBreadth.count({
        where: { date: today, total: { gte: 3000 } },
      });

      // If today has no records (e.g. weekend, holiday, or before market opens), find latest available date
      if (countToday === 0) {
        const latestRecord = await prisma.intradayMarketBreadth.findFirst({
          where: { total: { gte: 3000 } },
          select: { date: true },
          orderBy: { timestamp: 'desc' },
        });
        if (latestRecord?.date) {
          selectedDate = latestRecord.date;
        }
      }
    }

    const records = await prisma.intradayMarketBreadth.findMany({
      where: { date: selectedDate, total: { gte: 3000 } },
      orderBy: { timestamp: 'asc' },
    });

    const points: IntradayBreadthPoint[] = records.map((r) => {
      const timeStr = r.timestamp.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      return {
        time: timeStr,
        timestamp: r.timestamp.toISOString(),
        advances: r.advances,
        declines: r.declines,
        unchanged: r.unchanged,
        total: r.total,
        netAdvances: r.netAdvances,
        adRatio: r.adRatio,
      };
    });

    return {
      date: selectedDate,
      isToday: selectedDate === today,
      points,
    };
  } catch (error) {
    breadthLogger.error('Failed to fetch intraday market breadth:', error);
    return {
      date: selectedDate,
      isToday: selectedDate === today,
      points: [],
    };
  }
}
