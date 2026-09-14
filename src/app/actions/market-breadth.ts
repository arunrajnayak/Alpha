'use server';

/**
 * Market Breadth & Health Server Action
 *
 * Provides real-time advances/declines and stock moves distribution
 * across all active NSE stocks, as well as historical market health
 * breadth metrics (DMA & ATH breadth trends).
 */

import * as fs from 'fs/promises';
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

// Load active NSE stock universe (All ~3,394 NSE listed equities)
async function getActiveNSEUniverse(): Promise<UniverseItem[]> {
  const now = Date.now();
  if (cachedUniverse && cachedUniverse.length > 0 && now - universeCacheTime < UNIVERSE_CACHE_TTL_MS) {
    return cachedUniverse;
  }

  try {
    // 1. Ensure fresh instrument master from Upstox (cached locally with 7-day TTL)
    await ensureInstrumentMaster();
    const data = await fs.readFile('/tmp/upstox-cache/nse_instruments.json', 'utf-8');
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

    // 2. Load AMFI classifications for cap tier mapping (Large, Mid, Small)
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

    // 3. Load ATH from StockATH
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

    if (items.length > 0) {
      cachedUniverse = items;
      universeCacheTime = now;
      breadthLogger.info(`Loaded ${items.length} all-NSE active equity keys for market breadth`);
      return items;
    }
  } catch (error) {
    breadthLogger.warn('Could not load from instrument master, falling back to DB:', error);
  }

  // Fallback to MomentumScore in DB if instrument master read failed
  try {
    const latestDateRecord = await prisma.momentumScore.findFirst({
      select: { computedDate: true },
      orderBy: { computedDate: 'desc' },
    });

    if (!latestDateRecord?.computedDate) {
      return [];
    }

    const scores = await prisma.momentumScore.findMany({
      where: {
        computedDate: latestDateRecord.computedDate,
        rankType: 'all',
      },
      select: {
        symbol: true,
        instrumentKey: true,
        marketCapCategory: true,
        currentPrice: true,
        ath: true,
      },
    });

    const items: UniverseItem[] = scores
      .filter((s) => s.instrumentKey && s.instrumentKey.startsWith('NSE_EQ'))
      .map((s) => {
        const cat = (s.marketCapCategory || '').toLowerCase();
        let category: 'large' | 'mid' | 'small' | 'micro' = 'micro';
        if (cat.includes('large')) category = 'large';
        else if (cat.includes('mid')) category = 'mid';
        else if (cat.includes('small')) category = 'small';

        return {
          symbol: s.symbol,
          instrumentKey: s.instrumentKey,
          category,
          currentPrice: s.currentPrice,
          ath: s.ath || 0,
        };
      });

    cachedUniverse = items;
    universeCacheTime = now;
    breadthLogger.info(`Loaded ${items.length} fallback NSE equity keys from DB`);
    return items;
  } catch (error) {
    breadthLogger.error('Failed to load NSE universe from DB:', error);
    return cachedUniverse || [];
  }
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

// Build empty ATH drawdown buckets template
function createEmptyATHBuckets(): DistributionBucket[] {
  return [
    { label: '0-5%', min: 0, max: 5, count: 0, percent: 0 },
    { label: '5-10%', min: 5, max: 10, count: 0, percent: 0 },
    { label: '10-15%', min: 10, max: 15, count: 0, percent: 0 },
    { label: '15-20%', min: 15, max: 20, count: 0, percent: 0 },
    { label: '20-30%', min: 20, max: 30, count: 0, percent: 0 },
    { label: '30-40%', min: 30, max: 40, count: 0, percent: 0 },
    { label: '40-50%', min: 40, max: 50, count: 0, percent: 0 },
    { label: '> 50%', min: 50, max: Infinity, count: 0, percent: 0 },
  ];
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
    awayFromAth: number;
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
            const awayFromAth = item.ath > 0 ? Math.max(0, ((item.ath - q.last_price) / item.ath) * 100) : 0;
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

  // 4. Fallback to latest DB closing data if live quotes weren't obtained
  if (moves.length === 0) {
    try {
      const latestDateRecord = await prisma.momentumScore.findFirst({
        select: { computedDate: true },
        orderBy: { computedDate: 'desc' },
      });

      if (latestDateRecord?.computedDate) {
        const scores = await prisma.momentumScore.findMany({
          where: {
            computedDate: latestDateRecord.computedDate,
            rankType: 'all',
          },
          select: {
            symbol: true,
            currentPrice: true,
            ath: true,
            sparklineData: true,
            marketCapCategory: true,
          },
        });

        for (const s of scores) {
          let changePercent = 0;
          if (s.sparklineData) {
            try {
              const spark: number[] = JSON.parse(s.sparklineData);
              if (spark.length >= 2) {
                const prev = spark[spark.length - 2];
                const curr = spark[spark.length - 1];
                if (prev > 0) {
                  changePercent = ((curr - prev) / prev) * 100;
                }
              }
            } catch {
              // ignore json parse error
            }
          }

          const cat = (s.marketCapCategory || '').toLowerCase();
          let category: 'large' | 'mid' | 'small' | 'micro' = 'micro';
          if (cat.includes('large')) category = 'large';
          else if (cat.includes('mid')) category = 'mid';
          else if (cat.includes('small')) category = 'small';

          const awayFromAth = s.ath > 0 ? Math.max(0, ((s.ath - s.currentPrice) / s.ath) * 100) : 0;

          moves.push({
            symbol: s.symbol,
            changePercent,
            lastPrice: s.currentPrice,
            category,
            awayFromAth,
          });
        }
      }
    } catch (err) {
      breadthLogger.error('Failed to load fallback breadth from DB:', err);
    }
  }

  // 5. Aggregate metrics
  let advances = 0;
  let declines = 0;
  let unchanged = 0;

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

    // ATH drawdown bucket assignment
    for (const b of athBuckets) {
      if (m.awayFromAth >= b.min && (b.max === Infinity ? true : m.awayFromAth < b.max)) {
        b.count++;
        break;
      }
    }
  }

  const total = moves.length;

  // Percentage calculations
  for (const b of buckets) {
    b.percent = total > 0 ? Number(((b.count / total) * 100).toFixed(1)) : 0;
  }

  for (const b of athBuckets) {
    b.percent = total > 0 ? Number(((b.count / total) * 100).toFixed(1)) : 0;
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

  // Auto-record snapshot if market is currently open and at least 2 minutes passed since last save
  if (isLive && marketStatus === 'OPEN' && total > 0 && now - lastSavedBreadthTime > 2 * 60 * 1000) {
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

export async function fetchMarketHealthHistory(
  period: '1Y' | 'ALL' = '1Y'
): Promise<MarketHealthHistoryData> {
  try {
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

    if (!rawHistory || rawHistory.length === 0) {
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

    // Filter by period (1Y = 250 trading days, ALL = entire history)
    let sliceLength = rawHistory.length;
    if (period === '1Y') sliceLength = 250;

    const filtered = rawHistory.slice(-Math.min(sliceLength, rawHistory.length));
    const latest = rawHistory[rawHistory.length - 1];

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
        date: h.computedDate,
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
    if (breadthData.total === 0) return false;
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
        where: { date: today },
      });

      // If today has no records (e.g. weekend, holiday, or before market opens), find latest available date
      if (countToday === 0) {
        const latestRecord = await prisma.intradayMarketBreadth.findFirst({
          select: { date: true },
          orderBy: { timestamp: 'desc' },
        });
        if (latestRecord?.date) {
          selectedDate = latestRecord.date;
        }
      }
    }

    const records = await prisma.intradayMarketBreadth.findMany({
      where: { date: selectedDate },
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
