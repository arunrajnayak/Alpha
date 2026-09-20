'use server';

import { computePortfolioState, MarketCapCategory } from '@/lib/finance';
import { fetchNseIndices } from './nse';
import { prisma, chunkArray } from '@/lib/db';
import { SectorAllocation } from '@/lib/types';
import { getLiveQuoteV3, hasValidToken, UpstoxLiveQuoteV3 } from '@/lib/upstox-client';
import { getInstrumentKeys } from '@/lib/instrument-service';
import { getAMFICategoriesBatch, mapAMFIToMarketCapCategory } from '@/lib/amfi';
import { isMarketOpenAsync } from '@/lib/marketHours';
import { isTradingHoliday } from '@/lib/market-holidays-cache';
import { subDays } from 'date-fns';
import { logger } from '@/lib/logger';
import { istDayOfWeek, todayUTCMidnightForISTDay } from '@/lib/tz';
import { getFullQuotes } from '@/lib/upstox/client';
import { isPreOpenSession, isPreMarketClosed } from '@/lib/market-status-utils';

const liveActionsLogger = logger.scope('LiveActions');

export interface LiveStockData {
  symbol: string;
  quantity: number;
  invested: number;
  currentPrice: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  marketCapCategory?: MarketCapCategory;
  sector?: string;
  isPreOpen?: boolean;
  indicativePrice?: number;
  // Intraday & Technical Dynamics
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  todayVolume?: number;
  high52w?: number;
  ath?: number;
  avgVolume1m?: number;
  recoveryFromLowPct?: number;
  fallFromHighPct?: number;
  changeFromOpenPct?: number;
  dist52wHighPct?: number;
  distAthPct?: number;
  rvol?: number;
  sparkline?: number[];
}

export interface BreadthByCategory {
  large: { advances: number; declines: number };
  mid: { advances: number; declines: number };
  small: { advances: number; declines: number };
  micro: { advances: number; declines: number };
}

export type MarketStatus = 'OPEN' | 'CLOSED' | 'PRE_OPEN' | 'UNKNOWN';

// Helper to get today's date in IST as a Date object at start of day (UTC).
// This matches how trading-day rows are stored in the DB.
function getTodayIST(): Date {
  return todayUTCMidnightForISTDay();
}

// Helper to get the last N trading days' stock prices from history
async function getLastTradingDayPrices(
  symbols: string[],
  lookbackDays: number = 10
): Promise<{ 
  lastDayPrices: Map<string, { close: number; date: Date }>;
  previousDayPrices: Map<string, { close: number; date: Date }>;
  lastTradingDate: Date | null;
}> {
  // Use IST-based "today" to correctly determine the date boundary
  const today = getTodayIST();
  const lookbackStart = subDays(today, lookbackDays);
  
  // Fetch recent stock history for all symbols
  const symbolChunks = chunkArray(symbols);
  const historyArrays = await Promise.all(
    symbolChunks.map(chunk =>
      prisma.stockHistory.findMany({
        where: {
          symbol: { in: chunk },
          date: { gte: lookbackStart, lt: today }
        },
        orderBy: { date: 'desc' }
      })
    )
  );
  const allHistory = historyArrays.flat();
  
  // Group by symbol and get the two most recent dates
  const symbolHistory = new Map<string, { close: number; date: Date }[]>();
  for (const record of allHistory) {
    const existing = symbolHistory.get(record.symbol) || [];
    existing.push({ close: record.close, date: record.date });
    symbolHistory.set(record.symbol, existing);
  }
  
  // Sort each symbol's history by date descending and take top 2
  const lastDayPrices = new Map<string, { close: number; date: Date }>();
  const previousDayPrices = new Map<string, { close: number; date: Date }>();
  let lastTradingDate: Date | null = null;
  
  for (const [symbol, history] of symbolHistory) {
    // Sort by date descending
    history.sort((a, b) => b.date.getTime() - a.date.getTime());
    
    if (history.length >= 1) {
      lastDayPrices.set(symbol, history[0]);
      // Track the most recent trading date across all symbols
      if (!lastTradingDate || history[0].date > lastTradingDate) {
        lastTradingDate = history[0].date;
      }
    }
    if (history.length >= 2) {
      previousDayPrices.set(symbol, history[1]);
    }
  }
  
  return { lastDayPrices, previousDayPrices, lastTradingDate };
}

export interface LiveDashboardData {
  totalEquity: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayGain: number;
  dayGainPercent: number;
  topGainers: LiveStockData[];
  topLosers: LiveStockData[];
  advances: number;
  declines: number;
  breadthByCategory: BreadthByCategory;
  allHoldings: LiveStockData[];
  lastUpdated: string;
  indices: {
      name: string;
      symbol: string;
      percentChange: number;
      currentPrice: number;
  }[];
  sectorAllocations: SectorAllocation[];
  tokenStatus?: {
    hasToken: boolean;
    message?: string;
  };
  marketStatus: MarketStatus;
  dataDate?: string;
}

interface StockTechnicals {
  ath: number;
  avgVolume1m: number;
}

const technicalsCache = new Map<string, { data: StockTechnicals; cachedAt: number }>();
const TECHNICALS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getStockTechnicalsBatch(symbols: string[]): Promise<Map<string, StockTechnicals>> {
  const result = new Map<string, StockTechnicals>();
  const now = Date.now();
  const missingSymbols: string[] = [];

  for (const sym of symbols) {
    const cached = technicalsCache.get(sym);
    if (cached && now - cached.cachedAt < TECHNICALS_CACHE_TTL_MS) {
      result.set(sym, cached.data);
    } else {
      missingSymbols.push(sym);
    }
  }

  if (missingSymbols.length === 0) {
    return result;
  }

  try {
    const symbolChunks = chunkArray(missingSymbols);

    // 1. Fetch ATH from StockATH
    const athArrays = await Promise.all(
      symbolChunks.map(chunk =>
        prisma.stockATH.findMany({
          where: { symbol: { in: chunk } },
          select: { symbol: true, ath: true },
        })
      )
    );
    const athMap = new Map<string, number>();
    for (const row of athArrays.flat()) {
      if (row.ath > 0) athMap.set(row.symbol, row.ath);
    }

    // 2. Fetch last ~22 trading days of ScreenerPrice for 1-month average volume
    const screenerArrays = await Promise.all(
      symbolChunks.map(chunk =>
        prisma.screenerPrice.findMany({
          where: { symbol: { in: chunk } },
          orderBy: { date: 'desc' },
          take: chunk.length * 25,
          select: { symbol: true, volume: true },
        })
      )
    );
    const volumeBySymbol = new Map<string, number[]>();
    for (const row of screenerArrays.flat()) {
      const list = volumeBySymbol.get(row.symbol) || [];
      if (list.length < 22) {
        list.push(row.volume);
        volumeBySymbol.set(row.symbol, list);
      }
    }

    for (const sym of missingSymbols) {
      const ath = athMap.get(sym) || 0;
      const vols = volumeBySymbol.get(sym) || [];
      const avgVolume1m = vols.length > 0 ? vols.reduce((sum, v) => sum + v, 0) / vols.length : 0;
      const data: StockTechnicals = { ath, avgVolume1m };
      technicalsCache.set(sym, { data, cachedAt: now });
      result.set(sym, data);
    }
  } catch (err) {
    liveActionsLogger.warn('Failed to load stock technicals batch:', err);
  }

  return result;
}

export async function getLiveDashboardData(): Promise<LiveDashboardData> {
  try {
    // 1. Get current holdings
    const engine = await computePortfolioState(new Date()); // Today's state
    const holdings = Array.from(engine.holdings.values()).filter(h => h.qty > 0.01);
    liveActionsLogger.info(`computed ${holdings.length} holdings`);

    // Check market status
    const isHoliday = await isTradingHoliday(new Date());
    const day = istDayOfWeek(new Date());
    const isWeekday = day >= 1 && day <= 5;
    const isTradingDayToday = isWeekday && !isHoliday;

    const isMarketOpen = await isMarketOpenAsync();
    const isPreOpen = isTradingDayToday && isPreOpenSession();

    let marketStatus: MarketStatus = 'CLOSED';
    if (isMarketOpen) {
      marketStatus = 'OPEN';
    } else if (isPreOpen) {
      marketStatus = 'PRE_OPEN';
    }
  
    // Check if we should use historical data:
    // Only when market is closed AND before 09:00 AM (pre-market closed) or on weekend/holiday.
    // In pre-open (09:00-09:15) or regular open or post-market, use real Upstox quote data!
    const useHistoricalData = !isMarketOpen && !isPreOpen && (!isTradingDayToday || isPreMarketClosed());
    
    if (useHistoricalData) {
      liveActionsLogger.info(`Market closed and pre-market hours - using last trading day's data`);
    } else if (isPreOpen) {
      liveActionsLogger.info(`Market in Pre-Open session (09:00-09:15 IST) - fetching live indicative quotes`);
    }

    const emptyBreadth: BreadthByCategory = {
      large: { advances: 0, declines: 0 },
      mid: { advances: 0, declines: 0 },
      small: { advances: 0, declines: 0 },
      micro: { advances: 0, declines: 0 }
    };

    if (holdings.length === 0) {
      return {
        totalEquity: 0,
        totalInvested: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        dayGain: 0,
        dayGainPercent: 0,
        topGainers: [],
        topLosers: [],
        advances: 0,
        declines: 0,
        breadthByCategory: emptyBreadth,
        allHoldings: [],
        lastUpdated: new Date().toISOString(),
        indices: [],
        sectorAllocations: [],
        marketStatus
      };
    }

    // 2. Check if we have a valid Upstox token
    const hasToken = await hasValidToken();
    
    // Fetch indices in parallel (uses Upstox internally now)
    const indicesPromise = fetchNseIndices();

    // 3. Get instrument keys for all holdings
    const holdingSymbols = holdings.map(h => h.symbol);
    const instrumentKeyMap = await getInstrumentKeys(holdingSymbols);
    
    // Build quote map
    const quoteMap = new Map<string, UpstoxLiveQuoteV3>();
    const fullQuoteDataMap = new Map<string, {
      open?: number;
      high?: number;
      low?: number;
      volume?: number;
      year_high?: number;
    }>();
    let latestTradeTime: number = 0;
    
    // Fetch historical prices if we need them (for pre-market display)
    let historicalPrices: {
      lastDayPrices: Map<string, { close: number; date: Date }>;
      previousDayPrices: Map<string, { close: number; date: Date }>;
      lastTradingDate: Date | null;
    } | null = null;
    
    if (useHistoricalData) {
      historicalPrices = await getLastTradingDayPrices(holdingSymbols);
      liveActionsLogger.info(`Fetched historical prices for ${historicalPrices.lastDayPrices.size} symbols, last trading date: ${historicalPrices.lastTradingDate?.toISOString().split('T')[0]}`);
    }
    
    if (hasToken && !useHistoricalData) {
      try {
        // Get all instrument keys that we found
        const instrumentKeys = Array.from(instrumentKeyMap.values());
        
        if (instrumentKeys.length > 0) {
          let quotesFetched = false;
          try {
            // Use V3 Full Quotes to capture Indicative Equilibrium Price (IEP) for Pre-Open & CAS
            const fullQuotes = await getFullQuotes(instrumentKeys);
            if (fullQuotes.size > 0) {
              quotesFetched = true;
              liveActionsLogger.info(`Fetched ${fullQuotes.size} Upstox V3 full quotes for ${instrumentKeys.length} instruments (isPreOpen: ${isPreOpen})`);
              for (const [symbol, key] of instrumentKeyMap.entries()) {
                const q = fullQuotes.get(key) || fullQuotes.get(key.replace(/\|/g, ':'));
                if (q) {
                  const iep = q.indicative_equilibrium_price && q.indicative_equilibrium_price > 0 
                    ? q.indicative_equilibrium_price 
                    : undefined;
                  const prevClose = q.prev_close_price || q.ohlc?.close || q.last_price;
                  const activePrice = (isPreOpen && iep) ? iep : (q.last_price || iep || prevClose);
                  
                  quoteMap.set(symbol, {
                    last_price: activePrice,
                    instrument_token: q.instrument_token || key,
                    previous_close: prevClose,
                    timestamp: q.ohlc?.ts ? q.ohlc.ts : undefined,
                    indicative_equilibrium_price: iep,
                    is_pre_open: isPreOpen,
                  });

                  fullQuoteDataMap.set(symbol, {
                    open: q.ohlc?.open,
                    high: q.ohlc?.high,
                    low: q.ohlc?.low,
                    volume: q.volume,
                    year_high: q.year_high,
                  });

                  if (q.ohlc?.ts && q.ohlc.ts > latestTradeTime) {
                    latestTradeTime = q.ohlc.ts;
                  }
                }
              }
            }
          } catch (fullQuoteErr) {
            liveActionsLogger.warn("V3 Full quote fetch failed, falling back to LTP V3:", fullQuoteErr);
          }

          if (!quotesFetched) {
            const quotes = await getLiveQuoteV3(instrumentKeys);
            liveActionsLogger.info(`Fetched ${quotes.size} Upstox quotes for ${instrumentKeys.length} instruments`);
            
            // Map instrument keys back to symbols
            for (const [symbol, key] of instrumentKeyMap.entries()) {
              const quote = quotes.get(key);
              if (quote) {
                quoteMap.set(symbol, quote);
                
                // Track latest trade time to determine data date
                if (quote.timestamp && quote.timestamp > latestTradeTime) {
                  latestTradeTime = quote.timestamp;
                }
              }
            }
          }
        }
      } catch (error) {
        liveActionsLogger.error("Error fetching Upstox quotes:", error);
      }
    } else if (!useHistoricalData) {
      liveActionsLogger.warn("No valid Upstox token - using fallback prices");
    }

  // Fetch AMFI market cap classifications for all holdings
  const amfiCategories = await getAMFICategoriesBatch(holdingSymbols);

  // Fetch technicals (ATH and 1-month average volume) for all holdings
  const technicalsMap = await getStockTechnicalsBatch(holdingSymbols);

  // Fetch sector mappings for all holdings (batched to avoid SQLite expression tree limit)
  // Also fetch symbol mappings to handle renamed/delisted stocks
  let sectorMap = new Map<string, string>();
  try {
    // Get symbol mappings only for current holding symbols
    const symbolMappings = await prisma.symbolMapping.findMany({
      where: {
        OR: [
          { oldSymbol: { in: holdingSymbols } },
          { newSymbol: { in: holdingSymbols } }
        ]
      }
    });
    
    // Build expanded symbol list (include both old and new symbols)
    const expandedSymbols = new Set(holdingSymbols);
    for (const m of symbolMappings) {
      if (holdingSymbols.includes(m.oldSymbol)) expandedSymbols.add(m.newSymbol);
      if (holdingSymbols.includes(m.newSymbol)) expandedSymbols.add(m.oldSymbol);
    }
    
    const symbolChunks = chunkArray(Array.from(expandedSymbols));
    const allMappings = await Promise.all(
      symbolChunks.map(chunk =>
        prisma.sectorMapping.findMany({
          where: { symbol: { in: chunk } },
          select: { symbol: true, sector: true }
        })
      )
    );
    sectorMap = new Map(allMappings.flat().map(s => [s.symbol, s.sector]));
    
    // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
    for (const m of symbolMappings) {
      const oldSector = sectorMap.get(m.oldSymbol);
      const newSector = sectorMap.get(m.newSymbol);
      
      if (oldSector && !newSector) {
        sectorMap.set(m.newSymbol, oldSector);
      } else if (newSector && !oldSector) {
        sectorMap.set(m.oldSymbol, newSector);
      }
    }
  } catch (error) {
    liveActionsLogger.warn('Sector lookup failed:', (error as Error).message);
  }

  // 4. Match holdings with quotes and calculate metrics
  const liveData: LiveStockData[] = [];
  let totalEquity = 0;
  let totalPreviousEquity = 0;
  let totalInvested = 0;

  for (const h of holdings) {
    const quote = quoteMap.get(h.symbol);
    const fullQuote = fullQuoteDataMap.get(h.symbol);
    const tech = technicalsMap.get(h.symbol);

    const invested = h.invested;
    const fallbackPrice = h.qty > 0 ? invested / h.qty : 0;

    let price = fallbackPrice; 
    let prevClose = fallbackPrice;

    // Use historical data if available (pre-market scenario)
    if (useHistoricalData && historicalPrices) {
      const lastDay = historicalPrices.lastDayPrices.get(h.symbol);
      const prevDay = historicalPrices.previousDayPrices.get(h.symbol);
      
      if (lastDay) {
        price = lastDay.close;
        // Use previous day's close as the "previous close" for day change calculation
        prevClose = prevDay?.close || lastDay.close;
      }
    } else if (quote) {
      price = quote.last_price || price;
      // Previous close is directly available from LTP V3 (cp)
      prevClose = quote.previous_close || price;
    }

    // Intraday prices and technical metrics
    const dayOpen = fullQuote?.open && fullQuote.open > 0 ? fullQuote.open : (prevClose || price);
    const dayHigh = fullQuote?.high && fullQuote.high > 0 ? Math.max(fullQuote.high, price) : Math.max(price, dayOpen);
    const dayLow = fullQuote?.low && fullQuote.low > 0 ? Math.min(fullQuote.low, price) : Math.min(price, dayOpen);
    const todayVolume = fullQuote?.volume || 0;
    const high52w = fullQuote?.year_high || (tech?.ath || 0);
    const ath = Math.max(tech?.ath || 0, high52w || 0, dayHigh || 0);
    const effectiveHigh52w = high52w > 0 ? high52w : ath;
    const avgVolume1m = tech?.avgVolume1m || 0;

    const recoveryFromLowPct = dayLow > 0 ? ((price - dayLow) / dayLow) * 100 : 0;
    const fallFromHighPct = dayHigh > 0 ? ((price - dayHigh) / dayHigh) * 100 : 0;
    const changeFromOpenPct = dayOpen > 0 ? ((price - dayOpen) / dayOpen) * 100 : 0;
    const dist52wHighPct = effectiveHigh52w > 0 ? ((price - effectiveHigh52w) / effectiveHigh52w) * 100 : 0;
    const distAthPct = ath > 0 ? ((price - ath) / ath) * 100 : 0;
    const rvol = avgVolume1m > 0 ? todayVolume / avgVolume1m : (todayVolume > 0 ? 1 : 0);

    // Get market cap category from AMFI classification
    // getAMFICategoriesBatch returns original symbol keys
    const amfiCategory = amfiCategories.get(h.symbol);
    const marketCapCategory: MarketCapCategory | undefined = amfiCategory 
      ? mapAMFIToMarketCapCategory(amfiCategory)
      : undefined;

    const value = h.qty * price;
    const prevValue = h.qty * prevClose;

    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    
    // Calculate Per-Stock Total P&L
    const stockInvested = h.invested;
    const stockTotalPnl = value - stockInvested;
    const stockTotalPnlPercent = stockInvested !== 0 ? (stockTotalPnl / stockInvested) * 100 : 0;

    totalEquity += value;
    totalPreviousEquity += prevValue;
    totalInvested += stockInvested;

    liveData.push({
      symbol: h.symbol,
      quantity: h.qty,
      invested: stockInvested,
      currentPrice: price,
      previousClose: prevClose,
      dayChange: change,
      dayChangePercent: changePercent,
      currentValue: value,
      totalPnl: stockTotalPnl,
      totalPnlPercent: stockTotalPnlPercent,
      marketCapCategory,
      sector: sectorMap.get(h.symbol),
      isPreOpen,
      indicativePrice: quote?.indicative_equilibrium_price,
      dayOpen,
      dayHigh,
      dayLow,
      todayVolume,
      high52w: effectiveHigh52w,
      ath,
      avgVolume1m,
      recoveryFromLowPct,
      fallFromHighPct,
      changeFromOpenPct,
      dist52wHighPct,
      distAthPct,
      rvol,
    });
  }

  // 5. Calculate Aggregates
  const dayGain = totalEquity - totalPreviousEquity;
  const dayGainPercent = totalPreviousEquity !== 0 ? (dayGain / totalPreviousEquity) * 100 : 0;
  
  const totalPnl = totalEquity - totalInvested;
  const totalPnlPercent = totalInvested !== 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Advances/Declines
  const advances = liveData.filter(d => d.dayChange > 0).length;
  const declines = liveData.filter(d => d.dayChange < 0).length;

  // Breadth by Category
  const breadthByCategory: BreadthByCategory = {
    large: { advances: 0, declines: 0 },
    mid: { advances: 0, declines: 0 },
    small: { advances: 0, declines: 0 },
    micro: { advances: 0, declines: 0 }
  };

  for (const stock of liveData) {
    if (!stock.marketCapCategory) continue;
    const key = stock.marketCapCategory.toLowerCase() as 'large' | 'mid' | 'small' | 'micro';
    if (stock.dayChange > 0) {
      breadthByCategory[key].advances++;
    } else if (stock.dayChange < 0) {
      breadthByCategory[key].declines++;
    }
  }

  // Sorting for Movers
  const sortedByPercent = [...liveData].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
  const topGainers = sortedByPercent.slice(0, 5);
  const topLosers = sortedByPercent.slice(-5).reverse();

  // Calculate Sector Allocations
  const sectorGroups = new Map<string, { value: number; count: number; weightedChange: number }>();
  
  for (const holding of liveData) {
    const sector = holding.sector || 'Unknown';
    const existing = sectorGroups.get(sector) || { value: 0, count: 0, weightedChange: 0 };
    
    existing.value += holding.currentValue;
    existing.count += 1;
    existing.weightedChange += holding.currentValue * holding.dayChangePercent;
    
    sectorGroups.set(sector, existing);
  }

  const sectorAllocations: SectorAllocation[] = [];
  const validTotalEquity = totalEquity || 1;
  
  for (const [sector, data] of sectorGroups) {
    sectorAllocations.push({
      sector,
      value: data.value,
      allocation: (data.value / validTotalEquity) * 100,
      count: data.count,
      dayChangePercent: data.value > 0 ? data.weightedChange / data.value : 0
    });
  }
  sectorAllocations.sort((a, b) => b.allocation - a.allocation);

  let dataDate: string | undefined;
  if (useHistoricalData && historicalPrices?.lastTradingDate) {
    // Use the last trading date from historical data
    dataDate = historicalPrices.lastTradingDate.toISOString();
  } else if (isPreOpen) {
    dataDate = new Date().toISOString();
  } else if (latestTradeTime > 0) {
    dataDate = new Date(latestTradeTime).toISOString();
  }

  const result: LiveDashboardData = {
    totalEquity,
    totalInvested,
    totalPnl,
    totalPnlPercent,
    dayGain,
    dayGainPercent,
    topGainers,
    topLosers,
    advances,
    declines,
    breadthByCategory,
    allHoldings: sortedByPercent,
    lastUpdated: new Date().toISOString(),
    indices: [],
    sectorAllocations,
    tokenStatus: {
      hasToken,
      message: hasToken ? undefined : 'No valid Upstox token. Please approve the token request on your phone.'
    },
    marketStatus,
    dataDate
  };
  
  // Resolve indices data
  const indicesData = await indicesPromise;
  
  if (indicesData && indicesData.length > 0) {
    result.indices = indicesData;
  } else {
    liveActionsLogger.info("Index fetch failed or empty.");
    result.indices = [];
  }

    return result;
  } catch (error: any) {
    const errorMessage = error?.message || '';
    if (errorMessage.includes('no such table')) {
        liveActionsLogger.error('Database initialization error: Missing tables. Run "npx prisma db push".');
        throw new Error('DATABASE_NOT_INITIALIZED: Missing database tables. Please run "npx prisma db push" to initialize your database.');
    }
    liveActionsLogger.error("Error fetching dashboard data:", error);
    throw error;
  }
}

// ----- Intraday P/L History Functions -----

export interface IntradayPnLPoint {
  time: Date;
  pnl: number;
  percent: number;
  nifty50Percent?: number | null;
  n500m50Percent?: number | null;
}

/**
 * Save a P/L snapshot to the database.
 * Also cleans up data from previous days.
 */
export async function saveIntradayPnL(
  pnl: number,
  percent: number,
  nifty50Percent?: number | null,
  n500m50Percent?: number | null,
): Promise<void> {
  const now = new Date();
  const todayIST = getTodayIST();
  
  try {
    await prisma.$transaction([
      // Clean up old data (from previous days)
      prisma.intradayPnL.deleteMany({
        where: {
          date: { lt: todayIST }
        }
      }),
      // Insert new data point
      prisma.intradayPnL.create({
        data: {
          timestamp: now,
          date: todayIST,
          pnl,
          percent,
          nifty50Percent: nifty50Percent ?? null,
          n500m50Percent: n500m50Percent ?? null,
        }
      }),
    ]);
  } catch (error: any) {
    const errorMessage = error?.message || '';
    if (errorMessage.includes('no such table')) {
        liveActionsLogger.error('IntradayPnL: Database initialization error: Missing tables. Run "npx prisma db push".');
        return; // Silent fail for cron/background tasks but log is there
    }
    liveActionsLogger.error('IntradayPnL: Error saving P/L point:', error);
  }
}

/**
 * Get today's P/L history from the database.
 */
export async function getIntradayPnLHistory(): Promise<IntradayPnLPoint[]> {
  const todayStart = getTodayIST();
  // Create tomorrow's date for range query
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  
  try {
    const records = await prisma.intradayPnL.findMany({
      where: {
        date: {
          gte: todayStart,
          lt: tomorrowStart
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });
    
    liveActionsLogger.info(`IntradayPnL: Found ${records.length} records for date range ${todayStart.toISOString()} to ${tomorrowStart.toISOString()}`);
    
    return records.map(r => ({
      time: r.timestamp,
      pnl: r.pnl,
      percent: r.percent,
      nifty50Percent: r.nifty50Percent ?? null,
      n500m50Percent: r.n500m50Percent ?? null,
    }));
  } catch (error: any) {
    const errorMessage = error?.message || '';
    if (errorMessage.includes('no such table')) {
        liveActionsLogger.error('IntradayPnL: Database initialization error: Missing tables. Run "npx prisma db push".');
        return [];
    }
    liveActionsLogger.error('IntradayPnL: Error fetching P/L history:', error);
    return [];
  }
}

