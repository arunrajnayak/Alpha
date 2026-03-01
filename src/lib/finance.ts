import { prisma, chunkArray } from '@/lib/db';
import { addDays, isSameDay, startOfDay, format, differenceInDays, max as dateMax, subYears, isWeekend, getDay, subDays } from 'date-fns';
import xirr from 'xirr';
import { unstable_cache, revalidateTag } from 'next/cache';
import { PortfolioEngine } from './portfolio-engine';
import { getDataLockDate } from './config';
import { SectorAllocation } from './types';
import { getHistoricalCandles, hasValidToken, getLTP, UpstoxCandle } from './upstox-client';
import { getInstrumentKey, getInstrumentKeys } from './instrument-service';
import { getAMFICategoriesBatch, mapAMFIToMarketCapCategory, getSymbolResolver, AMFICategory, getCurrentAMFIPeriod } from './amfi-service';
import { roundPrice, roundPercent, roundQuantity, roundEquity, roundMarketCap } from './precision-utils';
import { getMarketHolidays, getSpecialTradingDays } from './upstox/market-info';
import { fetchNSEHistory, fetchNSEIndexHistory } from './nse-api';
import { isMarketOpenAsync } from './marketHours';
import { getMarketStatus } from './market-holidays-cache';
import { updateJob, failJob, completeJob } from './jobs';

// Feature flag for Upstox migration - set to true to use Upstox as primary data source
const USE_UPSTOX = process.env.USE_UPSTOX !== 'false'; // Default to true

// Default market cap thresholds (in Crores)


// Named constants for business logic thresholds
const NAV_MA_WINDOW = 200; // 200-day moving average window

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Stock quote data from various sources (Upstox, NSE, etc.) */
export interface StockQuote {
    date: Date;
    close: number;
    adjClose?: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
}

/** Stock split event data */
export interface SplitEvent {
    date: Date;
    numerator: number;
    denominator: number;
    ratio?: number;
}

/** Result from fetching stock history */
export interface StockHistoryResult {
    quotes: StockQuote[];
    events?: {
        splits?: SplitEvent[];
    };
}

/** Sector mapping from database */
export interface SectorMapping {
    symbol: string;
    sector: string;
    exchange?: string;
}

/** Request cache type for deduplicating API calls */
type RequestCache = Map<string, Promise<StockHistoryResult | null>>;

export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro';


// Legacy market cap logic removed in favor of AMFI data


export async function getDashboardHistory(days?: number) {
    // Only apply date filter if days is provided
    let whereClause = {};
    
    if (days) {
        const today = new Date();
        const startDate = new Date();
        startDate.setDate(today.getDate() - days);
        whereClause = {
            date: {
                gte: startDate
            }
        };
    }

    const snapshots = await prisma.dailyPortfolioSnapshot.findMany({
        where: whereClause,
        orderBy: {
            date: 'asc'
        },
        select: {
            date: true,
            totalEquity: true,
            portfolioNAV: true,
            drawdown: true
        }
    });

    return snapshots.map(s => ({
        date: s.date.toISOString(), // formatting for Recharts
        totalEquity: s.totalEquity,
        portfolioNAV: s.portfolioNAV,
        drawdown: s.drawdown ?? 0
    }));
}

// Request Cache to prevent duplicate calls in same execution
// Type defined above in TYPE DEFINITIONS section

/**
 * Fetch historical candle data from Upstox
 * Returns data in a format compatible with the existing processing logic
 */
async function fetchUpstoxHistory(
    symbol: string,
    startDate: Date,
    endDate: Date,
    cache: RequestCache
): Promise<StockHistoryResult | null> {
    const cacheKey = `upstox-${symbol}-${startDate.toISOString()}-${endDate.toISOString()}`;
    
    const cached = cache.get(cacheKey);
    if (cached) {
        console.debug(`[Cache Hit] Reusing Upstox request for ${symbol}`);
        return cached;
    }

    const promise = (async () => {
        try {
            // Get instrument key for the symbol
            const instrumentKey = await getInstrumentKey(symbol);
            
            if (!instrumentKey) {
                console.warn(`[Upstox] No instrument key found for ${symbol}`);
                return null;
            }

            // Format dates for Upstox API (YYYY-MM-DD)
            const fromDate = format(startDate, 'yyyy-MM-dd');
            const toDate = format(endDate, 'yyyy-MM-dd');

            console.debug(`[Upstox] Fetching history for ${symbol} (${instrumentKey}) from ${fromDate} to ${toDate}`);

            const result = await getHistoricalCandles(instrumentKey, 'day', fromDate, toDate);

            if (!result.candles || result.candles.length === 0) {
                console.warn(`[Upstox] No candle data returned for ${symbol}`);
                return null;
            }

            // Transform Upstox candles to the expected format
            // Upstox returns: { timestamp, open, high, low, close, volume, oi }
            // IMPORTANT: Upstox timestamps are in IST (e.g., "2024-08-12T00:00:00+05:30")
            // We need to extract just the date portion to avoid timezone conversion issues
            // that would shift the date backward when converting to UTC
            const quotes = result.candles.map((candle: UpstoxCandle) => {
                // Extract date portion from timestamp (YYYY-MM-DD) to avoid timezone shift
                const dateStr = candle.timestamp.split('T')[0];
                return {
                    date: new Date(dateStr + 'T00:00:00.000Z'), // Force UTC midnight
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume,
                };
            });

            console.debug(`[Upstox] Got ${quotes.length} candles for ${symbol}`);

            return { quotes };
        } catch (error) {
            console.error(`[Upstox] Failed to fetch history for ${symbol}:`, error);
            return null;
        }
    })();

    cache.set(cacheKey, promise);
    return promise;
}

/**
 * Get live prices from Upstox for EOD validation
 */
async function fetchUpstoxLiveQuotes(
    symbols: string[]
): Promise<Map<string, { last_price: number; open?: number; high?: number; low?: number; volume?: number }>> {
    const result = new Map<string, { last_price: number; open?: number; high?: number; low?: number; volume?: number }>();
    
    try {
        const hasToken = await hasValidToken();
        if (!hasToken) {
            console.warn('[Upstox] No valid token for live quotes');
            return result;
        }

        const instrumentKeyMap = await getInstrumentKeys(symbols);
        const instrumentKeys = Array.from(instrumentKeyMap.values());
        
        if (instrumentKeys.length === 0) {
            return result;
        }

        const ltpMap = await getLTP(instrumentKeys);
        
        // Map back to symbols
        for (const [symbol, key] of instrumentKeyMap.entries()) {
            const price = ltpMap.get(key);
            if (price !== undefined) {
                result.set(symbol, { last_price: price });
            }
        }
    } catch (error) {
        console.error('[Upstox] Failed to fetch live quotes:', error);
    }
    
    return result;
}

// Simple concurrency limiter
async function pMap<T, R>(
    items: T[],
    concurrency: number,
    iterator: (item: T) => Promise<R>
): Promise<R[]> {
    const results: Promise<R>[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
        const p = Promise.resolve().then(() => iterator(item));
        results.push(p);

        const e: Promise<void> = p.then(() => {
            executing.splice(executing.indexOf(e), 1);
        });
        executing.push(e);

        if (executing.length >= concurrency) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}


// Batch fetch and cache history
export async function updateStockHistory(
    symbols: string[], 
    startDate: Date, 
    cache: RequestCache,
    options?: { forceNSE?: boolean; forceSymbol?: string }
) {
    const today = new Date();
    const lockDate = await getDataLockDate();
    
    // Dynamic Market Status Check
    const status = await getMarketStatus();
    // It is EOD if:
    // 1. Market is explicitly CLOSED today (isOpen = false) AND closeTime exists (meaning it WAS open but is now closed)
    // 2. OR Market is actively OPEN (isOpen = true) but current time > closeTime (safety check)
    // Fallback: If API returns no closeTime (e.g. data missing), default to hardcoded 4:00 PM check
    let isEOD = false;
    
    if (status.closeTime) {
         // Use API-provided close time
         isEOD = !status.isOpen || new Date() >= status.closeTime;
         if (isEOD) console.log(`[UpdateStockHistory] EOD Detected via API (Close Time: ${status.closeTime.toLocaleTimeString()})`);
    } else {
         // Fallback to static schedule
         isEOD = today.getHours() >= 16; // After 4:00 PM IST
         console.log(`[UpdateStockHistory] EOD Detected via Static Fallback (No API status)`);
    }
    
    // Check if Upstox is available
    const upstoxAvailable = USE_UPSTOX && await hasValidToken();
    console.log(`[UpdateStockHistory] Data source: ${upstoxAvailable ? 'Upstox' : 'Yahoo Finance (fallback)'}`);
    
    // Pre-fetch live quotes for all symbols if we are looking for "Today"
    let upstoxLiveQuotes: Map<string, { last_price: number }> = new Map();
    
    if (isEOD && symbols.length > 0 && upstoxAvailable) {
        try {
            console.log(`[UpdateStockHistory] EOD Detected. Pre-fetching Upstox live quotes...`);
            upstoxLiveQuotes = await fetchUpstoxLiveQuotes(symbols);
            console.log(`[UpdateStockHistory] Got ${upstoxLiveQuotes.size} Upstox live quotes`);
        } catch (err) {
            console.warn(`[UpdateStockHistory] Upstox live quote pre-fetch failed:`, err);
        }
    }
    
    await pMap(symbols, 20, async (symbol) => {
        if (symbol === '^NSEI') return; 

        const forceThis = options?.forceNSE || (options?.forceSymbol && options.forceSymbol === symbol);

        try {
            // Check existing range
            const latest = await prisma.stockHistory.findFirst({
                where: { symbol },
                orderBy: { date: 'desc' }
            });
            
            const earliest = await prisma.stockHistory.findFirst({
                where: { symbol },
                orderBy: { date: 'asc' }
            });
            
            let fetchStart = startDate;

            // Optimization: If we already have history covering the requested start, 
            // we only need to append forward from the latest date.
            // UNLESS we are forcing a refresh (forceThis).
            if (earliest && latest && startDate >= earliest.date && !forceThis) {
                    // Start fetching from the day AFTER the latest record
                    fetchStart = addDays(latest.date, 1);
                    
                    // CRITICAL FIX: If 'latest' is TODAY (or Close to Today), and we are in EOD, 
                    // we MUST re-verify today's price because the existing record might be an intra-day snapshot 
                    // or a stale value from a laggy source.
                    if (isEOD && isSameDay(latest.date, today)) {
                         // OPTIMIZATION: If we have a live quote from Upstox, use it directly
                         // instead of fetching historical candles (which often return 0 for today)
                         const upstoxLive = upstoxLiveQuotes.get(symbol);
                         if (upstoxLive?.last_price) {
                             const livePrice = upstoxLive.last_price;
                             if (Math.abs(latest.close - livePrice) > 0.01) {
                                 console.debug(`[UpdateStockHistory] Updating EOD price for ${symbol} via live quote: ${latest.close} -> ${livePrice}`);
                                 await prisma.stockHistory.update({
                                     where: { id: latest.id },
                                     data: { close: livePrice }
                                 });
                             }
                             // Skip historical fetch - we've updated with live data
                             return;
                         }
                         // No live quote available, fall back to historical fetch
                         console.debug(`[UpdateStockHistory] Re-verifying EOD price for ${symbol} (Existing: ${latest.close})`);
                         fetchStart = startOfDay(today);
                    }
            }
            
            // If backfilling (startDate < earliest), we fetch from startDate to Today (full refresh) 
            // to ensure implicit split adjustments are correct for the new range.

            // OPTIMIZATION: Respect Data Lock Date for Fetching
            // If we have a lock date, we should NEVER fetch data before it, because we cannot write it anyway.
            if (lockDate && fetchStart <= lockDate) {
                 const newStart = addDays(lockDate, 1);
                 // only log if meaningful difference (> 7 days) to avoid spam on boundary
                 if (differenceInDays(newStart, fetchStart) > 7) {
                     console.debug(`[UpdateStockHistory] Clamping fetch start for ${symbol} from ${fetchStart.toISOString().split('T')[0]} to ${newStart.toISOString().split('T')[0]} (Data Lock)`);
                 }
                 fetchStart = newStart;
            }

            if (fetchStart > today) return;

            console.debug(`Fetching history for ${symbol} from ${fetchStart.toISOString()}`);

            let result: StockHistoryResult | null = null;

            // PRIMARY: Try Upstox if available
            // Fetch historical data from Upstox
            if (upstoxAvailable) {
                result = await fetchUpstoxHistory(symbol, fetchStart, today, cache);
                
                if (result && result.quotes && result.quotes.length > 0) {
                    console.debug(`[Upstox] Got ${result.quotes.length} candles for ${symbol}`);
                }
            }

            // FALLBACK: Try NSE for delisted/unknown symbols
            if (!result || !result.quotes || result.quotes.length === 0) {
                console.debug(`[Stock History] Upstox has no data for ${symbol}, trying NSE fallback...`);
                try {
                    const nseData = await fetchNSEHistory(symbol, fetchStart, today);
                    if (nseData && nseData.data && nseData.data.length > 0) {
                        // Convert NSE format to standard quote format
                        const nseQuotes = nseData.data.map(d => ({
                            date: new Date(d.CH_TIMESTAMP),
                            close: d.CH_CLOSING_PRICE,
                            adjClose: d.CH_CLOSING_PRICE,
                            open: d.CH_CLOSING_PRICE,
                            high: d.CH_CLOSING_PRICE,
                            low: d.CH_CLOSING_PRICE,
                            volume: 0
                        }));
                        result = { quotes: nseQuotes };
                        console.debug(`[NSE Fallback] Got ${nseQuotes.length} records for ${symbol}`);
                    }
                } catch (nseErr) {
                    console.warn(`[NSE Fallback] Failed for ${symbol}:`, nseErr);
                }
            }

            // Skip if no data available from any source
            // MODIFIED: If EOD and we have a live quote for today, we proceed to allow injection
            const hasLiveQuoteForToday = isEOD && upstoxLiveQuotes.has(symbol) && fetchStart <= today;

            if ((!result || !result.quotes || result.quotes.length === 0) && !hasLiveQuoteForToday) {
                console.warn(`[Stock History] No data available for ${symbol} from any source`);
                return;
            }

            // Initialize empty quotes if missing, so we can inject today's price
            if (!result) result = { quotes: [] };
            if (!result.quotes) result.quotes = [];

            const quotes = result.quotes || [];
            
            // --- TODAY PRICE FIX ---
            // If we are looking for Today and it's after market hours,
            // verify the latest price in chart against the live quote.
            const todayStr = format(today, 'yyyy-MM-dd');
            
            // Use Upstox live quote
            const upstoxLive = upstoxLiveQuotes.get(symbol);
            const livePrice = upstoxLive?.last_price;
            
            if (livePrice) {
                 const chartTodayIdx = quotes.findIndex((q: StockQuote) => format(new Date(q.date), 'yyyy-MM-dd') === todayStr);

                 if (chartTodayIdx !== -1) {
                      const chartPrice = quotes[chartTodayIdx].close;
                      if (Math.abs(chartPrice - livePrice) > 0.01) {
                           console.debug(`[UpdateStockHistory] Fixing stale chart price for ${symbol}: ${chartPrice} -> ${livePrice} (Live)`);
                           quotes[chartTodayIdx].close = livePrice;
                           quotes[chartTodayIdx].adjClose = livePrice;
                      }
                 } else {
                      // Chart missing today entirely, but we have a live quote for today
                      console.debug(`[UpdateStockHistory] Injecting missing today price for ${symbol}: ${livePrice} (Live)`);
                      quotes.push({
                          date: today,
                          close: livePrice,
                          adjClose: livePrice,
                          volume: 0,
                          open: livePrice,
                          high: livePrice,
                          low: livePrice
                      });
                 }
            }

            if (quotes.length === 0) return;

            const splits = result.events?.splits || [];

            // INJECT MANUAL FIXES: Fetch manual corporate actions for this symbol (from Transaction table)
            const manualActions = await prisma.transaction.findMany({
                where: { 
                    symbol: symbol,
                    type: { in: ['SPLIT', 'BONUS'] }
                }
            });

            // Convert manual actions to Yahoo event format
            const manualEvents = manualActions.map(ma => ({
                date: ma.date,
                numerator: ma.splitRatio || 1,
                denominator: 1
            }));

            // Merge: Prefer Manual over Yahoo for same date (fuzzy window to catch T+1/T+2 reporting)
            const mergedSplits: SplitEvent[] = [...splits];
            for (const manual of manualEvents) {
                const manualDate = new Date(manual.date).getTime();
                // Remove existing yahoo split if within 3 days of manual date
                const existingIdx = mergedSplits.findIndex((s: SplitEvent) => {
                    const diffDays = Math.abs(new Date(s.date).getTime() - manualDate) / (1000 * 60 * 60 * 24);
                    return diffDays <= 3;
                });
                
                if (existingIdx !== -1) {
                    console.log(`[UpdateStockHistory] Overriding Yahoo Split (Detected near ${new Date(mergedSplits[existingIdx].date).toISOString().split('T')[0]}) with MANUAL_FIX for ${symbol} on ${manual.date.toISOString().split('T')[0]}`);
                    mergedSplits.splice(existingIdx, 1);
                } else {
                    console.log(`[UpdateStockHistory] Injecting MANUAL_FIX Split for ${symbol} on ${manual.date.toISOString().split('T')[0]}`);
                }
                mergedSplits.push(manual);
            }

            // Sort splits descending by date for efficient processing
            const serializedSplits = mergedSplits.map((s: SplitEvent) => ({
                date: new Date(s.date), 
                numerator: s.numerator, 
                denominator: s.denominator,
                ratio: s.numerator / s.denominator
            })).sort((a, b) => b.date.getTime() - a.date.getTime());

            // Reverse Adjustment Logic (Newest -> Oldest)
            // Sort quotes descending (Newest first)
            quotes.sort((a: StockQuote, b: StockQuote) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            // ADAPTIVE SPLIT VERIFICATION:
            // Check if Yahoo data is already Raw (Unadjusted) or Adjusted.
            // If Raw, there will be a price drop around the split date matching the ratio.
            // If Adjusted, the price will be smooth (ratio ~1).
            const verifiedSplits = serializedSplits.map((split) => {
                 const splitTime = split.date.getTime();
                 // Find index of first quote OLDER than split (Pre-Split)
                 // Quotes are DESC, so we look for date < splitTime
                 const afterIdx = quotes.findIndex((q: StockQuote) => new Date(q.date).getTime() < splitTime);
                 
                 if (afterIdx > 0 && afterIdx < quotes.length) {
                      const qPre = quotes[afterIdx];
                      const qPost = quotes[afterIdx - 1]; // Newer, Post-Split
                      
                      const priceRatio = (qPre.close || 1) / (qPost.close || 1);
                      // If price drop matches split ratio (e.g. 2:1 split -> price ratio ~2)
                      // Then data is Raw. Do not adjust.
                      if (Math.abs(priceRatio - split.ratio) < 1.0 && Math.abs(priceRatio - split.ratio) < Math.abs(priceRatio - 1)) {
                           console.debug(`[Split Check] Detected RAW data for ${symbol} around ${split.date.toISOString().split('T')[0]}. Drop ${priceRatio.toFixed(2)} ~ Ratio ${split.ratio}. Ignoring adjustment.`);
                           return { ...split, ratio: 1 }; 
                      }
                 }
                 return split;
            });
            
            let accumulatedSplitFactor = 1;
            let splitIndex = 0;

            const data = [];
            
            for (const q of quotes) {
                const qDate = new Date(q.date);
                
                // Update accumulated split factor if we cross a split date moving backwards
                while (splitIndex < verifiedSplits.length && verifiedSplits[splitIndex].date > qDate) {
                    accumulatedSplitFactor *= verifiedSplits[splitIndex].ratio;
                    splitIndex++;
                }
                
                const rawClose = (q.close || 0) * accumulatedSplitFactor;

                if (!q.date || !q.close) continue;

                // Force UTC Midnight to avoid 18:30 IST offsets
                const yDate = new Date(q.date);
                const utcDate = new Date(Date.UTC(yDate.getUTCFullYear(), yDate.getUTCMonth(), yDate.getUTCDate()));

                data.push({
                    date: utcDate,
                    symbol: symbol,
                    close: rawClose
                });
            }

            // Batch insert history
            if (data.length > 0) {
                if (forceThis) {
                     interface DeleteCondition {
                         symbol: string;
                         date?: {
                             gte?: Date;
                             lte?: Date;
                             gt?: Date;
                         };
                     }
                     
                     const deleteCondition: DeleteCondition = {
                         symbol: symbol
                     };
                     
                     if (lockDate) {
                         console.debug(`[UpdateStockHistory] Force update active, but respecting Data Lock <= ${lockDate.toISOString().split('T')[0]}`);
                         deleteCondition.date = {
                             gte: data[data.length - 1].date, // quotes are sorted DESC, so last is min
                             lte: data[0].date,
                             gt: lockDate
                         };
                     } else {
                         console.debug(`[UpdateStockHistory] Overwriting existing data range for ${symbol} due to force flag.`);
                         deleteCondition.date = {
                             gte: data[data.length - 1].date,
                             lte: data[0].date
                         };
                     }

                     const deleted = await prisma.stockHistory.deleteMany({
                         where: deleteCondition
                     });
                     console.debug(`[UpdateStockHistory] Deleted ${deleted.count} records for ${symbol} within range (Force Override).`);
                }

                // Find existing dates to avoid constraint errors (since skipDuplicates might not be available)
                const existingRecords = await prisma.stockHistory.findMany({
                    where: { 
                        symbol: symbol, 
                        date: { in: data.map(d => d.date) } 
                    },
                    select: { date: true }
                });
                
                const existingDates = new Set(existingRecords.map(r => r.date.getTime()));
                
                // Deduplicate within the batch itself
                interface StockHistoryRow {
                    date: Date;
                    symbol: string;
                    close: number;
                }
                const uniqueNewRows = new Map<number, StockHistoryRow>();
                for (const d of data) {
                    const time = d.date.getTime();
                    if (existingDates.has(time)) {
                        // FIX: If verified "Live" price differs from DB, UPDATE IT.
                        if (isEOD && isSameDay(d.date, today)) {
                             const existing = existingRecords.find(r => r.date.getTime() === time);
                             // If existing record found and price difference > 0.5%
                             // We update it. (Note: standard createMany flow doesn't update, so we need a separate update call)
                             if (existing) {
                                  // We can't know the exact price without fetching the record's close, 
                                  // but we have `d.close` which is the NEW reliable price.
                                  // Since we don't have the existing close in `existingRecords` (we only selected date),
                                  // let's rely on the fact that we WANT the new price `d.close`.
                                  
                                  // Ideally we'd compare, but for now, let's just queue an update if it's "Today".
                                  // Actually, `uniqueNewRows` is for `createMany`. We should handle updates separately.
                                  console.debug(`[UpdateStockHistory] Overwriting Today's record for ${symbol} via specific update.`);
                                  
                                  // Perform individual update (Safe because this only happens for 1 record per symbol per run usually)
                                  await prisma.stockHistory.updateMany({
                                       where: { symbol, date: d.date },
                                       data: { close: d.close } 
                                  });
                             }
                        }
                    } else {
                        // Respect Data Lock: Do not insert if date is <= lockDate
                        if (lockDate && d.date <= lockDate) {
                           // Skip
                        } else {
                            uniqueNewRows.set(time, d);
                        }
                    }
                }
                
                const newRows = Array.from(uniqueNewRows.values());

                if (newRows.length > 0) {
                     const created = await prisma.stockHistory.createMany({
                        data: newRows
                    });
                    console.debug(`[UpdateStockHistory] Successfully created ${created.count} records for ${symbol}.`);
                } else {
                    console.debug(`[UpdateStockHistory] No new rows to insert for ${symbol} (All already exist).`);
                }
            }

            // NOTE: Split storage moved to fetchCorporateActions() to avoid duplicates.
            // This function now only handles price history.

        } catch (e: unknown) {
            console.error(`Failed to fetch history for ${symbol}:`, e);
        }
    });
    
    // Log Summary
    console.log(`[UpdateStockHistory] Completed for ${symbols.length} symbols.`);
}

// Fetch Nifty History
export async function updateIndexHistory(startDate: Date) {
    const indices = [
        { symbol: 'NIFTY50', displayName: 'NIFTY 50' },
        { symbol: 'NIFTY500_MOMENTUM50', displayName: 'NIFTY500 MOMENTUM 50' },
        { symbol: 'NIFTY_MIDCAP100', displayName: 'NIFTY MIDCAP 100' },
        { symbol: 'NIFTY_SMALLCAP250', displayName: 'NIFTY SMALLCAP 250' },
        { symbol: 'NIFTY_MICROCAP250', displayName: 'NIFTY MICROCAP 250' }
    ];
    const today = new Date();

    for (const { symbol, displayName } of indices) {
        try {
            const latest = await prisma.indexHistory.findFirst({
                where: { symbol },
                orderBy: { date: 'desc' }
            });
            // Refetch last 5 days to ensure any gap-filled days are corrected with real data if available
            const fetchStart = latest ? subDays(latest.date, 5) : startDate;

            if (fetchStart > today) continue;

            console.log(`[Index] Updating ${symbol} (${displayName}) from ${fetchStart.toISOString().split('T')[0]}`);

            let dataPoints: { date: Date, close: number }[] = [];
            const source = 'Upstox';

            try {
                const indexKey = await getInstrumentKey(displayName);
                if (indexKey) {
                    const fromDate = format(fetchStart, 'yyyy-MM-dd');
                    const toDate = format(today, 'yyyy-MM-dd');
                    
                    const result = await getHistoricalCandles(indexKey, 'day', fromDate, toDate);
                    if (result.candles && result.candles.length > 0) {
                        // Extract date portion from timestamp to avoid IST->UTC timezone shift
                        dataPoints = result.candles.map(c => {
                            const dateStr = c.timestamp.split('T')[0];
                            return {
                                date: new Date(dateStr + 'T00:00:00.000Z'),
                                close: c.close
                            };
                        });
                        console.debug(`[Index] Got ${dataPoints.length} records from Upstox for ${symbol}`);
                    }
                }
            } catch (error) {
                console.warn(`[Index] Upstox fetch failed for ${symbol}:`, error);
            }

            // FALLBACK: Try NSE if Upstox returned no data (e.g. Special Trading Session not yet in API or Upstox failure)
            if (dataPoints.length === 0) {
                try {
                    console.debug(`[Index] Falling back to NSE for ${symbol}...`);
                    const nseData = await fetchNSEIndexHistory(displayName, fetchStart, today);
                    
                    if (nseData && nseData.data) {
                        let records: { EOD_TIMESTAMP: string; EOD_CLOSE_INDEX_VAL: number }[] = [];
                        
                        if ('indexCloseOnlineRecords' in nseData.data) {
                             records = nseData.data.indexCloseOnlineRecords;
                        } else if (Array.isArray(nseData.data)) {
                             records = nseData.data;
                        }

                        if (records.length > 0) {
                            dataPoints = records.map((r) => ({
                                date: new Date(r.EOD_TIMESTAMP), // JS Date parsing handles "13-JAN-2025" usually
                                close: r.EOD_CLOSE_INDEX_VAL
                            })).filter((d) => !isNaN(d.date.getTime()));
                            
                            // Normalize dates to UTC midnight
                            dataPoints = dataPoints.map((d) => ({
                                ...d,
                                date: new Date(Date.UTC(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()))
                            }));
                            
                            console.debug(`[Index] Got ${dataPoints.length} records from NSE for ${symbol}`);
                        }
                    }
                } catch (nseError) {
                    console.warn(`[Index] NSE fallback failed for ${symbol}:`, nseError);
                }
            }

            // 2. Gap Filling (Weekend Propagation)
            // Ensure continuous series by filling weekends with last known price
            const fullSeries: { date: Date, close: number, symbol: string }[] = [];
            
            // Get last known close from DB (if available) BEFORE the content we are about to rewrite
            const previousRecord = await prisma.indexHistory.findFirst({
                where: { symbol, date: { lt: fetchStart } },
                orderBy: { date: 'desc' }
            });
            let lastClose = previousRecord ? previousRecord.close : (latest ? latest.close : 0); 
            
            // Create a Map for easy lookup of fetched data
            const fetchedMap = new Map<string, number>();
            dataPoints.forEach(d => fetchedMap.set(format(d.date, 'yyyy-MM-dd'), d.close));
            
            // Iterate from fetchStart to today
            let cursor = new Date(fetchStart);
            // Safety: Limit loop to avoid infinite loops if dates are weird
            const SAFETY_LIMIT = 365 * 2; 
            let loopCount = 0;

            while (cursor <= today && loopCount < SAFETY_LIMIT) {
                const dKey = format(cursor, 'yyyy-MM-dd');
                
                if (fetchedMap.has(dKey)) {
                     // We have fresh data
                     lastClose = fetchedMap.get(dKey)!;
                     fullSeries.push({ date: new Date(cursor), close: lastClose, symbol });
                } else if (lastClose > 0) {
                     // Missing data (Weekend OR Weekday Holiday) -> Propagate last close
                     // This handles "Future Proofing" for market holidays like Gandhi Jayanti etc.
                     // Note: If running mid-day during market hours, this effectively snapshots "yesterday's close" as "today",
                     // which is acceptable until EOD fetch overwrites it with real data.
                     fullSeries.push({ date: new Date(cursor), close: lastClose, symbol });
                     // console.log(`[Index] Patched gap (Weekend/Holiday) for ${symbol} on ${dKey} with ${lastClose}`);
                }
                
                cursor = addDays(cursor, 1);
                loopCount++;
            }

            if (fullSeries.length > 0) {
                // Delete existing records in the overlap range
                await prisma.indexHistory.deleteMany({
                    where: {
                        symbol: symbol,
                        date: {
                            gte: fullSeries[0].date,
                            lte: fullSeries[fullSeries.length - 1].date
                        }
                    }
                });

                // Insert new series
                await prisma.indexHistory.createMany({
                    data: fullSeries.map(d => ({
                        date: d.date,
                        close: d.close,
                        symbol: d.symbol
                    }))
                });
                console.log(`[Index] Upserted ${fullSeries.length} records for ${symbol}`);
            } else {
                console.warn(`[Index] Failed to fetch any data for ${symbol}`);
            }

        } catch(e) {
            console.error(`Failed to handle index ${symbol}:`, e);
        }
    }
}

// Internal implementation
export type ProgressCallback = (message: string, progress: number) => void;

export async function computePortfolioState(toDate?: Date) {
    const transactions = await prisma.transaction.findMany({
        where: toDate ? { date: { lte: toDate } } : undefined,
        orderBy: { date: 'asc' }
    });

    const engine = new PortfolioEngine();

    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);

    // Process all transactions (SPLIT/BONUS are handled directly by processTransaction)
    for (const tx of transactions) {
        engine.processTransaction({ ...tx, symbol: resolveSymbol(tx.symbol) });
    }

    console.log(`[PortfolioState] Final Holdings: ${engine.holdings.size}, Invested Capital: ${engine.investedCapital.toFixed(2)}`);
    return engine;
}

export async function recalculatePortfolioHistoryInternal(
    fromDate?: Date, 
    onProgress?: ProgressCallback,
    options?: { forceNSE?: boolean; forceSymbol?: string }
) {

    console.log("Starting Portfolio Recalculation (TWR + Cashflow)...");
    onProgress?.("Fetching Transactions...", 5);

    // 1. Get all events
    const transactionsRaw = await prisma.transaction.findMany({
        orderBy: { date: 'asc' }
    });
    
    // Normalize symbols using SymbolMapping
    const symbolMappings = await prisma.symbolMapping.findMany();
    const resolveSymbol = getSymbolResolver(symbolMappings);
    const transactions = transactionsRaw.map(t => ({
        ...t,
        symbol: resolveSymbol(t.symbol)
    }));


    if (transactions.length === 0) {
        // Clear snapshots if no data
        await prisma.dailyPortfolioSnapshot.deleteMany({});
        await prisma.weeklyPortfolioSnapshot.deleteMany({});
        await prisma.monthlyPortfolioSnapshot.deleteMany({});
        console.log("No data found. Cleared snapshots.");
        return;
    }

    console.log(`[Recalc] Data Loaded: ${transactions.length} transactions.`);

    // Determine Start Date
    const txStart = transactions.length > 0 ? transactions[0].date : new Date(2100, 0, 1);
    const startDate = startOfDay(txStart);
    let today = startOfDay(new Date());

    // If market is currently open (trading day, within market hours), exclude today
    // from the simulation to avoid creating snapshots with incomplete/stale intraday data.
    const marketStatus = await getMarketStatus();
    if (marketStatus.isOpen) {
        console.log(`[Recalc] Market is currently open — excluding today from snapshot generation.`);
        today = startOfDay(subDays(new Date(), 1));
    }

    // Effective Recalculation Date
    // If no fromDate (full recalc), this is startDate.
    // If fromDate is provided, we only write to DB from this date, but we SIMULATE from startDate.
    const effectiveFromDate = fromDate ? startOfDay(fromDate) : startDate;

    const requestCache: RequestCache = new Map();

    // 2. Identify all symbols for history fetching
    const txSymbols = new Set(transactions.map((t) => t.symbol));



    // Include Mapped Symbols (Ensure we fetch history for both Old and New names)
    try {
        const mappings = await prisma.symbolMapping.findMany();
        for (const m of mappings) {
            if (txSymbols.has(m.oldSymbol)) {
                 txSymbols.add(m.newSymbol);
            } else if (txSymbols.has(m.newSymbol)) {
                 txSymbols.add(m.oldSymbol);
            }
        }
    } catch (e) {
        console.error("Failed to load symbol mappings during recalc setup", e);
    }
    
    const symbols = Array.from(txSymbols);
    console.log(`[Recalc] Symbols to track: ${symbols.length} (From Txs: ${symbols.length})`);
    
    // 3. Update History IF needed (usually best to update anyway if partial)
    if (symbols.length > 0) {
        onProgress?.("Fetching Stock History & Corporate Actions...", 10);
        // We should ensure history up to today is present
        await updateStockHistory(symbols, startDate, requestCache, options);
        
        // DISABLE YAHOO CORPORATE ACTIONS (Moving to Manual Mode)
        // await fetchCorporateActions(symbols, startDate, requestCache);
    }
    await updateIndexHistory(startDate);

    // Fetch market holidays for the simulation period
    let marketHolidays = new Set<string>();
    let specialTradingDays = new Set<string>();
    try {
        const holidays = await getMarketHolidays();
        marketHolidays = new Set(holidays.map(h => format(new Date(h.date), 'yyyy-MM-dd')));
        
        // Also fetch special sessions (e.g. Budget Day Sunday) for relevant years
        // We broadly check the simulation range years
        const startYear = startDate.getFullYear();
        const endYear = today.getFullYear();
        for (let y = startYear; y <= endYear; y++) {
             const special = await getSpecialTradingDays(y);
             for (const d of special) specialTradingDays.add(d);
        }
        
        console.log(`[Recalc] Loaded ${marketHolidays.size} market holidays and ${specialTradingDays.size} special trading sessions`);
    } catch (e) {
        console.warn('[Recalc] Failed to load market holidays, will skip only weekends:', e);
    }

    // Helper to check if a date is a trading day
    const isTradingDay = (date: Date, hasPrices: boolean = false): boolean => {
        // If we have actual price data for this day, it IS a trading day (even if weekend/holiday)
        // This covers special trading sessions like Budget Day 2026 (Sunday) or Muhurat Trading
        if (hasPrices) return true;

        const dateStr = format(date, 'yyyy-MM-dd');

        // Check explicit Special Trading Sessions from API (e.g. Budget Day)
        if (specialTradingDays.has(dateStr)) return true;

        // Skip weekends
        if (isWeekend(date)) return false;
        // Skip market holidays
        if (marketHolidays.has(dateStr)) return false;
        return true;
    };



    // 3b. Corporate Actions are now stored in Transaction table (type='SPLIT' or 'BONUS')
    // They are processed automatically by engine.processTransaction()
    // This map is kept for backward compatibility but will be empty.
    const corpActionsByDate = new Map<string, { symbol: string; type: string; ratio: number }[]>();
    console.log(`Corporate actions now handled via Transaction table (Manual Mode)`);


    // 4. Pre-load prices (batched to avoid SQLite expression tree limit)
    const symbolChunks = chunkArray(symbols);
    const stockHistoryArrays = await Promise.all(
        symbolChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { symbol: { in: chunk }, date: { gte: startDate } }
            })
        )
    );
    const stockHistory = stockHistoryArrays.flat();

    // 4a. Use Symbol Mappings (loaded at start of function)
    const aliasMap = new Map<string, string[]>();
    for (const m of symbolMappings) {
        // Map Old -> New (If we have price for New, update Old)
        if (!aliasMap.has(m.newSymbol)) aliasMap.set(m.newSymbol, []);
        aliasMap.get(m.newSymbol)!.push(m.oldSymbol);
        
        // Map New -> Old (If we have price for Old, update New - less common but possible)
        if (!aliasMap.has(m.oldSymbol)) aliasMap.set(m.oldSymbol, []);
        aliasMap.get(m.oldSymbol)!.push(m.newSymbol);
    }

    // 4a2. Detect which symbols have ADJUSTED vs RAW price data
    // StockHistory may contain split-adjusted prices (from Upstox/Yahoo) that need unadjustment
    // We detect this by checking if there's a price drop around the split date
    const splitAdjustmentMap = new Map<string, { splitDate: Date; factor: number }[]>();
    
    const allSplits = transactions.filter(t => 
        (t.type === 'SPLIT' || t.type === 'BONUS') && t.splitRatio && t.splitRatio > 1
    );
    
    // Group corporate actions by symbol and date to handle multiple actions on same day
    // (e.g., BONUS 1:1 and SPLIT 1:2 on same day = combined 4x adjustment)
    const groupedActions = new Map<string, { splitDate: Date; combinedRatio: number; actions: string[] }>();
    
    for (const split of allSplits) {
        const sym = split.symbol.toUpperCase();
        const ratio = split.splitRatio || 1;
        const dateKey = `${sym}_${format(split.date, 'yyyy-MM-dd')}`;
        
        if (!groupedActions.has(dateKey)) {
            groupedActions.set(dateKey, { splitDate: split.date, combinedRatio: 1, actions: [] });
        }
        const group = groupedActions.get(dateKey)!;
        group.combinedRatio *= ratio;
        group.actions.push(`${split.type}(${ratio})`);
    }
    
    // Now process each grouped action
    for (const [key, group] of groupedActions) {
        // Extract symbol from the key (format: "SYMBOL_YYYY-MM-DD")
        const symbol = key.split('_')[0];
        
        const combinedRatio = group.combinedRatio;
        
        // Find prices around split date from stockHistory
        const pricesAroundSplit = stockHistory.filter(h => 
            h.symbol.toUpperCase() === symbol &&
            h.date >= new Date(group.splitDate.getTime() - 7 * 24 * 60 * 60 * 1000) &&
            h.date <= new Date(group.splitDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        ).sort((a, b) => a.date.getTime() - b.date.getTime());
        
        const preBefore = pricesAroundSplit.filter(p => p.date < group.splitDate);
        const postAfter = pricesAroundSplit.filter(p => p.date >= group.splitDate);
        
        let isAdjusted = true; // Default to adjusted (safer)
        
        if (preBefore.length > 0 && postAfter.length > 0) {
            const preSplitPrice = preBefore[preBefore.length - 1].close;
            const postSplitPrice = postAfter[0].close;
            const priceRatio = preSplitPrice / postSplitPrice;
            
            // If price dropped by approximately the COMBINED ratio, data is RAW
            if (Math.abs(priceRatio - combinedRatio) < 0.5) {
                isAdjusted = false;
                console.log(`[Recalc] ${symbol}: RAW data detected (price drop ${priceRatio.toFixed(2)} ≈ ${combinedRatio}) [${group.actions.join(' + ')}]`);
            } else {
                console.log(`[Recalc] ${symbol}: ADJUSTED data detected (price ratio ${priceRatio.toFixed(2)}, need to unadjust by ${combinedRatio}) [${group.actions.join(' + ')}]`);
            }
        } else if (postAfter.length === 0) {
            // No post-split prices available (split is today or in the future).
            // Upstox won't have retroactively adjusted prices for a split that hasn't happened yet,
            // so treat data as RAW — no unadjustment needed.
            isAdjusted = false;
            console.log(`[Recalc] ${symbol}: No post-split prices available (split date: ${format(group.splitDate, 'yyyy-MM-dd')}). Treating as RAW. [${group.actions.join(' + ')}]`);
        }
        
        if (isAdjusted) {
            // Need to unadjust prices BEFORE the split date using COMBINED ratio
            if (!splitAdjustmentMap.has(symbol)) splitAdjustmentMap.set(symbol, []);
            splitAdjustmentMap.get(symbol)!.push({ splitDate: group.splitDate, factor: combinedRatio });
        }
    }
    
    // Sort adjustments by date descending for each symbol
    for (const [, adjustments] of splitAdjustmentMap) {
        adjustments.sort((a, b) => b.splitDate.getTime() - a.splitDate.getTime());
    }

    const priceMap = new Map<string, Map<string, number>>();
    stockHistory.forEach((h) => {
        const istDate = new Date(h.date.getTime() + 5.5 * 60 * 60 * 1000);
        const dKey = format(istDate, 'yyyy-MM-dd');
        if (!priceMap.has(dKey)) priceMap.set(dKey, new Map());
        
        // Apply split adjustment if needed (unadjust split-adjusted prices)
        let adjustedPrice = h.close;
        const adjustments = splitAdjustmentMap.get(h.symbol.toUpperCase());
        if (adjustments) {
            for (const adj of adjustments) {
                // If this price is BEFORE the split date, multiply by the factor
                if (h.date < adj.splitDate) {
                    adjustedPrice *= adj.factor;
                }
            }
        }
        
        priceMap.get(dKey)!.set(h.symbol, adjustedPrice);
    });

    const indexHistory = await prisma.indexHistory.findMany({
        where: { date: { gte: startDate } }
    });
    // Map<DateString, Map<Symbol, Close>>
    const indexMap = new Map<string, Map<string, number>>();
    indexHistory.forEach((h) => {
        const istDate = new Date(h.date.getTime() + 5.5 * 60 * 60 * 1000);
        const dKey = format(istDate, 'yyyy-MM-dd');
        if (!indexMap.has(dKey)) indexMap.set(dKey, new Map());
        indexMap.get(dKey)!.set(h.symbol, h.close);
    });

    // 4b. AMFI Market Cap Classifications will be loaded dynamically in the loop below
    let amfiCategories = new Map<string, AMFICategory>();
    let lastAmfiPeriod: string | null = null;

    // 4c. Pre-load Sector Mappings (with symbol mapping support)
    const sectorMappingsList = await prisma.sectorMapping.findMany();
    const sectorMap = new Map<string, string>();
    sectorMappingsList.forEach((s: SectorMapping) => sectorMap.set(s.symbol, s.sector));
    
    // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
    // If we have a sector for oldSymbol but not newSymbol (or vice versa), copy it
    for (const m of symbolMappings) {
        const oldSector = sectorMap.get(m.oldSymbol);
        const newSector = sectorMap.get(m.newSymbol);
        
        if (oldSector && !newSector) {
            // Old symbol has sector, new doesn't - copy to new
            sectorMap.set(m.newSymbol, oldSector);
        } else if (newSector && !oldSector) {
            // New symbol has sector, old doesn't - copy to old
            sectorMap.set(m.oldSymbol, newSector);
        }
    }
    console.log(`[Recalc] Loaded ${sectorMappingsList.length} sector mappings, extended to ${sectorMap.size} with symbol mappings.`);

    // 5. Clear snapshots (PARTIALLY or FULLY)
    // Respect DATA_LOCK_DATE: only delete snapshots AFTER the lock date
    const dataLockDate = await getDataLockDate();
    const deleteFromDate = dataLockDate 
        ? dateMax([effectiveFromDate, addDays(dataLockDate, 1)])
        : effectiveFromDate;
    
    console.log(`Clearing snapshots from ${deleteFromDate.toISOString()}...`);
    if (dataLockDate) {
        console.log(`[Data Lock] Protecting snapshots on or before ${dataLockDate.toISOString().split('T')[0]}`);
    }
    onProgress?.("Simulating Portfolio...", 30);
    await prisma.dailyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });
    await prisma.weeklyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });
    await prisma.monthlyPortfolioSnapshot.deleteMany({
        where: { date: { gte: deleteFromDate } }
    });

    // 6. Simulation State using PortfolioEngine

    // Shared helper for weekly/monthly snapshot stats to avoid duplication
    function computeSnapshotStats(
        large: number, mid: number, small: number, micro: number,
        wins: number, losses: number, closedTradesCount: number,
        totalWinPct: number, totalLossPct: number, totalHoldDays: number
    ) {
        const stockTotal = large + mid + small + micro;
        return {
            largePct: stockTotal > 0 ? (large / stockTotal) * 100 : 0,
            midPct: stockTotal > 0 ? (mid / stockTotal) * 100 : 0,
            smallPct: stockTotal > 0 ? (small / stockTotal) * 100 : 0,
            microPct: stockTotal > 0 ? (micro / stockTotal) * 100 : 0,
            winPercent: closedTradesCount > 0 ? (wins / closedTradesCount) * 100 : 0,
            lossPercent: closedTradesCount > 0 ? (losses / closedTradesCount) * 100 : 0,
            avgWinnerGain: wins > 0 ? (totalWinPct / wins) * 100 : 0,
            avgLoserLoss: losses > 0 ? (totalLossPct / losses) * 100 : 0,
            avgHoldingPeriod: closedTradesCount > 0 ? totalHoldDays / closedTradesCount : 0,
        };
    }
    const engine = new PortfolioEngine();
    
    // TWR Metrics
    let nav = 100;
    
    // Index tracking state — data-driven instead of per-index variables
    type IndexTracker = { lastKnown: number; startValue: number };
    const indexTrackers = new Map<string, IndexTracker>([
        ['NIFTY50', { lastKnown: 0, startValue: 0 }],
        ['NIFTY500_MOMENTUM50', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_MIDCAP100', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_SMALLCAP250', { lastKnown: 0, startValue: 0 }],
        ['NIFTY_MICROCAP250', { lastKnown: 0, startValue: 0 }],
    ]);

    const lastKnownPrices = new Map<string, number>();

    // Snapshot metrics state
    let maxNav = 100;
    const navHistory: number[] = [];

    // Performance Stats State (Cumulative)
    let wins = 0, losses = 0;
    let totalWinPct = 0, totalLossPct = 0;
    let totalHoldDays = 0, closedTradesCount = 0;
    
    // Monthly Exit Stats
    let monthExits = 0;
    let monthsActive = 0;
    
    let currentDate = startDate;
    
    // Pointers
    let tIndex = 0;

    let prevTotalEquity = 0; 
    // Previous Weekly/Monthly NAVs for Return Calc
    let lastWeeklyNav = 0;
    let lastMonthlyNav = 0;


    
    // Batch Data Arrays with proper types
    type DailySnapshotInput = {
        date: Date;
        totalEquity: number;
        investedCapital: number;
        portfolioNAV: number;
        niftyNAV: number | null;
        nifty500Momentum50NAV: number | null;
        niftyMidcap100NAV: number | null;
        niftySmallcap250NAV: number | null;
        niftyMicrocap250NAV: number | null;
        units: number;
        cashflow: number;
        drawdown: number;
        dailyPnL: number;
        dailyReturn: number;
        navMA200: number | null;
    };
    
    type WeeklySnapshotInput = {
        date: Date;
        totalEquity: number;
        nav: number;
        weeklyReturn: number;
        largeCapPercent: number;
        midCapPercent: number;
        smallCapPercent: number;
        microCapPercent: number;

        marketCap: number;
        xirr: number;
        pnl: number;
        winPercent: number;
        lossPercent: number;
        avgHoldingPeriod: number;
        avgWinnerGain: number;
        avgLoserLoss: number;
        sectorAllocation: string;
    };
    
    type MonthlySnapshotInput = {
        date: Date;
        totalEquity: number;
        nav: number;
        monthlyReturn: number;
        largeCapPercent: number;
        midCapPercent: number;
        smallCapPercent: number;
        microCapPercent: number;
        marketCap: number;
        xirr: number;
        pnl: number;
        winPercent: number;
        lossPercent: number;
        avgHoldingPeriod: number;
        avgWinnerGain: number;
        avgLoserLoss: number;
        exitCount: number;
        avgExitsPerMonth: number;
        sectorAllocation: string;
    };
    
    const dailyData: DailySnapshotInput[] = [];
    const weeklyData: WeeklySnapshotInput[] = [];
    const monthlyData: MonthlySnapshotInput[] = [];

    // Prepare Loop Vars for Progress
    const totalSimDays = differenceInDays(today, currentDate);
    let daysProcessed = 0;
    const progressStart = 30; // Resume after fetching history
    const progressEnd = 90;   // Leave 10% for saving

    while (currentDate <= today) {
        // Progress Reporting (Every ~5% or at least every 30 days)
        if (totalSimDays > 0 && daysProcessed % 5 === 0) {
             const pct = daysProcessed / totalSimDays;
             const mapped = Math.floor(progressStart + (pct * (progressEnd - progressStart)));
             onProgress?.(`Simulating ${format(currentDate, 'MMM yyyy')}...`, mapped);
        }
        daysProcessed++;
        const dKey = format(currentDate, 'yyyy-MM-dd');

        // Update AMFI categories if period changes
        const amfiPeriod = getCurrentAMFIPeriod(currentDate);
        const amfiPeriodStr = `${amfiPeriod.year}_${amfiPeriod.halfYear}`;
        if (amfiPeriodStr !== lastAmfiPeriod) {
            console.log(`[Recalc] AMFI Period changed to ${amfiPeriodStr} at ${dKey}. Refreshing categories...`);
            // Pass the current date to use the appropriate AMFI period
            amfiCategories = await getAMFICategoriesBatch(symbols, currentDate);
            lastAmfiPeriod = amfiPeriodStr;
        }
        const isFriday = currentDate.getDay() === 5;
        // Check if Month End: Next day is 1st of new month OR Today is Today (last day of loop)
        const nextDay = addDays(currentDate, 1);
        const isMonthEnd = nextDay.getDate() === 1 || isSameDay(currentDate, today);
        // Also check if Today is Friday or we are at the end of loop, capture weekly
        const isWeekEnd = isFriday || isSameDay(currentDate, today);


        // A. Pricing & Market Value
        const prices = priceMap.get(dKey) || new Map();

        for (const [sym, price] of prices) {
            lastKnownPrices.set(sym, price);
            // Propagate price to aliases (e.g. if we have price for NEW, set it for OLD too)
            // IMPORTANT: Only propagate if the alias doesn't already have a price for TODAY
            // This prevents stale/wrong prices from overwriting correct ones when both
            // old and new symbols have price data (e.g., during symbol name changes)
            if (aliasMap.has(sym)) {
                for (const alias of aliasMap.get(sym)!) {
                    if (!prices.has(alias)) {
                        lastKnownPrices.set(alias, price);
                    }
                }
            }
        }
        
        engine.resetDailyFlow();

        // B. Process Events for Today
        let displayCashflow = 0; 

        // Process Transactions
        while(tIndex < transactions.length && isSameDay(transactions[tIndex].date, currentDate)) {
            const tx = transactions[tIndex];
            
            // Update Prices Fallback
            if (!lastKnownPrices.has(tx.symbol) && tx.price > 0) lastKnownPrices.set(tx.symbol, tx.price);

            const result = engine.processTransaction(tx);

            if (tx.type === 'BUY') {
                const tradeVal = tx.quantity * tx.price;
                displayCashflow -= tradeVal;
            } else if (tx.type === 'SELL') {
                const tradeVal = tx.quantity * tx.price;
                displayCashflow += tradeVal;
            }

            if (result) {
                // It was a SELL with realized result
                closedTradesCount++;
                monthExits++;
                totalHoldDays += result.holdDays;
                
                if (result.pnl > 0) {
                    wins++;
                    totalWinPct += result.returnPct;
                } else {
                    losses++;
                    totalLossPct += result.returnPct;
                }
            }
            
            tIndex++;
        }



        // B2. Apply Corporate Actions from Yahoo (auto-detected splits)
        const todaysCorpActions = corpActionsByDate.get(dKey) || [];
        for (const action of todaysCorpActions) {
           // My engine has applySplit(symbol, ratio). Let's use that.
           if (action.type === 'SPLIT') {
                engine.applySplit(action.symbol, action.ratio);
                
                // NOTE: DO NOT adjust price here. 
                // Yahoo Finance prices in stockHistory are already split-adjusted.
                // halving the price again here causes the double-adjustment bug.
                
                console.log(`Applied SPLIT for ${action.symbol} via Engine (Price already adjusted in History)`);
           }
        }

        // C. Calculate End-of-Day Equity
        let large = 0, mid = 0, small = 0, micro = 0;

        const valuation = engine.getValuation(lastKnownPrices);

        // Use AMFI classifications for market cap segmentation
        for (const h of valuation.holdings) {
            const val = h.currentValue;
            
            // Get AMFI category for this symbol
            const amfiCategory = amfiCategories.get(h.symbol) || 'Small';
            const category = mapAMFIToMarketCapCategory(amfiCategory);
            
            switch (category) {
                case 'Large': large += val; break;
                case 'Mid': mid += val; break;
                case 'Small': small += val; break;
                case 'Micro': micro += val; break;
            }
        }
        
        const totalEquity = valuation.totalEquity;
        const dailyNetFlow = engine.dailyNetFlow;
        const accumulatedInvestedCapital = engine.investedCapital;

        // D. NAV Calculation
        if (prevTotalEquity === 0) {
            if (dailyNetFlow > 0) {
                // First Day: Treat flow as start-of-day capital.
                // Growth = End / Start(Flow).
                const dailyReturn = (totalEquity - dailyNetFlow) / dailyNetFlow;
                // Actually if we treat Flow as Start:
                // End = 105. Start = 100. Return = (105-100)/100 = 0.05.
                // Formula: (TotalEquity - Flow) / Flow ?
                // 105 - 100 = 5. 5/100 = 0.05. Correct.
                nav = 100 * (1 + dailyReturn);
            } else {
                nav = 100;
            }
        } else {
            const adjustedEndValue = totalEquity - dailyNetFlow;
            const dailyReturn = adjustedEndValue / prevTotalEquity;
            nav = nav * dailyReturn;
            if (Number.isNaN(nav)) nav = 100;
        }

        // Track stats
        if (nav > maxNav) maxNav = nav;
        const drawdown = maxNav > 0 ? (nav / maxNav) - 1 : 0;
        
        let dailyPnL = 0;
        let dailyRet = 0;

        if (prevTotalEquity > 0) {
             dailyPnL = totalEquity - dailyNetFlow - prevTotalEquity;
             // TWR Return
             dailyRet = (totalEquity - dailyNetFlow) / prevTotalEquity - 1;
        } else if (dailyNetFlow > 0) {
             // First Day / Restart
             dailyPnL = totalEquity - dailyNetFlow;
             dailyRet = (totalEquity - dailyNetFlow) / dailyNetFlow;
        }
        
        navHistory.push(nav);
        let navMA200 = 0;
        if (navHistory.length >= NAV_MA_WINDOW) {
             const slice = navHistory.slice(-NAV_MA_WINDOW);
             const sum = slice.reduce((a, b) => a + b, 0);
             navMA200 = sum / NAV_MA_WINDOW;
        }

        // E. Index NAV Comparison (data-driven loop)
        const indexPrices = indexMap.get(dKey);
        const indexNavs = new Map<string, number>();

        for (const [key, tracker] of indexTrackers) {
            const val = indexPrices?.get(key);
            let indexNav = 0;
            if (val) {
                if (tracker.startValue === 0) tracker.startValue = val;
                tracker.lastKnown = val;
                indexNav = (val / tracker.startValue) * 100;
            } else if (tracker.lastKnown > 0 && tracker.startValue > 0) {
                indexNav = (tracker.lastKnown / tracker.startValue) * 100;
            }
            indexNavs.set(key, indexNav);
        }



        const units = nav > 0 ? totalEquity / nav : 0;
        const pnl = totalEquity - accumulatedInvestedCapital;

        // F. Save Daily Snapshot IF within recalculation window AND it's a trading day
        // Skip weekends and market holidays - no snapshot should be created for non-trading days
        // UNLESS we have explicit price data for that day (e.g. Budget Day special session)
        const hasPricesForDay = prices.size > 0;
        if (currentDate >= effectiveFromDate && isTradingDay(currentDate, hasPricesForDay)) {
            const d = new Date(currentDate);
            const utcSnapshotDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

            dailyData.push({
                date: utcSnapshotDate,
                totalEquity: roundEquity(totalEquity),
                investedCapital: roundEquity(accumulatedInvestedCapital),
                portfolioNAV: roundPrice(nav),
                niftyNAV: indexNavs.get('NIFTY50') ? roundPrice(indexNavs.get('NIFTY50')!) : null,
                nifty500Momentum50NAV: indexNavs.get('NIFTY500_MOMENTUM50') ? roundPrice(indexNavs.get('NIFTY500_MOMENTUM50')!) : null,
                niftyMidcap100NAV: indexNavs.get('NIFTY_MIDCAP100') ? roundPrice(indexNavs.get('NIFTY_MIDCAP100')!) : null,
                niftySmallcap250NAV: indexNavs.get('NIFTY_SMALLCAP250') ? roundPrice(indexNavs.get('NIFTY_SMALLCAP250')!) : null,
                niftyMicrocap250NAV: indexNavs.get('NIFTY_MICROCAP250') ? roundPrice(indexNavs.get('NIFTY_MICROCAP250')!) : null,
                units: roundQuantity(units),
                cashflow: roundEquity(displayCashflow),
                drawdown: roundPercent(drawdown),
                dailyPnL: roundEquity(dailyPnL),
                dailyReturn: roundPercent(dailyRet),
                navMA200: navMA200 ? roundPrice(navMA200) : null,
            });
        }


        // Calculate Sector Allocation for weekly/monthly snapshots
        let currentSectorAllocations: SectorAllocation[] = [];
        if (isWeekEnd || isMonthEnd) {
            const sectorAllocMap = new Map<string, { value: number, count: number }>();
            let totalSectorValue = 0;

            engine.holdings.forEach((h, sym) => {
                if (h.qty <= 0.001) return;
                const price = lastKnownPrices.get(sym) || 0;
                if (price <= 0) return;

                const val = h.qty * price;
                const sector = sectorMap.get(sym) || 'Unknown';
                
                const existing = sectorAllocMap.get(sector) || { value: 0, count: 0 };
                existing.value += val;
                existing.count += 1;
                sectorAllocMap.set(sector, existing);
                totalSectorValue += val;
            });

            currentSectorAllocations = Array.from(sectorAllocMap.entries()).map(([sector, data]) => ({
                sector,
                value: data.value,
                count: data.count,
                allocation: totalSectorValue > 0 ? (data.value / totalSectorValue) * 100 : 0,
                dayChangePercent: 0
            })).sort((a, b) => b.value - a.value);
        }

        // G. Weekly Snapshot
        if (isWeekEnd) {
             // Calculate Weekly Return
             let weeklyReturn = 0;
             const prevNav = lastWeeklyNav > 0 ? lastWeeklyNav : 100;
             weeklyReturn = (nav / prevNav) - 1;
             
             // Shared stats for weekly/monthly snapshots
             const stats = computeSnapshotStats(large, mid, small, micro, wins, losses, closedTradesCount, totalWinPct, totalLossPct, totalHoldDays);

             /**
              * XIRR LIMITATION:
              * XIRR is computationally expensive as it requires iterating over ALL cash flows 
              * from the portfolio start date up to the current snapshot date. Computing XIRR
              * for every daily/weekly/monthly snapshot in a loop would cause:
              * - O(n * m) complexity where n = days and m = cash flows
              * - Potential timeouts for portfolios with 1000+ days of history
              * 
              * WORKAROUND:
              * - XIRR is calculated on-demand via `calculatePortfolioXIRR()` in the dashboard stats
              * - Weekly/Monthly snapshot capture functions calculate XIRR individually
              * - The recalculation loop sets XIRR to 0 as a placeholder
              * 
              * For accurate XIRR in snapshots, use the individual capture functions or
              * implement incremental XIRR calculation that reuses previous computations.
              */
             const xirrVal = 0;

             if (currentDate >= effectiveFromDate) {
                 weeklyData.push({
                     date: currentDate, 
                     totalEquity: roundEquity(totalEquity), 
                     nav: roundPrice(nav), 
                     weeklyReturn: roundPercent(weeklyReturn), 
                     largeCapPercent: roundPercent(stats.largePct), 
                     midCapPercent: roundPercent(stats.midPct), 
                     smallCapPercent: roundPercent(stats.smallPct), 
                     microCapPercent: roundPercent(stats.microPct), 

                     marketCap: 0, 
                     xirr: roundPercent(xirrVal), 
                     pnl: roundEquity(pnl), 
                     winPercent: roundPercent(stats.winPercent), 
                     lossPercent: roundPercent(stats.lossPercent), 
                     avgHoldingPeriod: Math.round(stats.avgHoldingPeriod * 10) / 10,
                     avgWinnerGain: roundPercent(stats.avgWinnerGain), 
                     avgLoserLoss: roundPercent(stats.avgLoserLoss),
                     sectorAllocation: JSON.stringify(currentSectorAllocations)
                 });
             }

             lastWeeklyNav = nav;
        }


        // H. Monthly Snapshot
        if (isMonthEnd) {
             let monthlyReturn = 0;
             const prevNav = lastMonthlyNav > 0 ? lastMonthlyNav : 100;
             monthlyReturn = (nav / prevNav) - 1;
             
             const stats = computeSnapshotStats(large, mid, small, micro, wins, losses, closedTradesCount, totalWinPct, totalLossPct, totalHoldDays);
             
             // Exit Stats
             // const avgExitsPerMonth = monthsActive > 0 ? closedTradesCount / (monthsActive + 1) : closedTradesCount;
             // Note: using (monthsActive + 1) because current month is just finishing but monthsActive increments after.
             // Actually, let's execute increment at end of block. So dividing by (monthsActive + 1) is correct for "current month index + 1".
             // Or better: increment monthsActive AFTER using it?
             // Let's increment monthsActive at end of block. So logic:
             // 1st month: monthsActive=0. Div by 1.
             // 2nd month: monthsActive=1. Div by 2.
             const currentMonthsCount = monthsActive + 1;
             const calculatedAvgExits = closedTradesCount / currentMonthsCount;

             const xirrVal = 0; 

             if (currentDate >= effectiveFromDate) {
                 monthlyData.push({
                     date: currentDate, 
                     totalEquity: roundEquity(totalEquity), 
                     nav: roundPrice(nav), 
                     monthlyReturn: roundPercent(monthlyReturn), 
                     largeCapPercent: roundPercent(stats.largePct), 
                     midCapPercent: roundPercent(stats.midPct), 
                     smallCapPercent: roundPercent(stats.smallPct), 
                     microCapPercent: roundPercent(stats.microPct), 
                     marketCap: 0, 
                     xirr: roundPercent(xirrVal), 
                     pnl: roundEquity(pnl), 
                     winPercent: roundPercent(stats.winPercent), 
                     lossPercent: roundPercent(stats.lossPercent), 
                     avgHoldingPeriod: Math.round(stats.avgHoldingPeriod * 10) / 10,
                     avgWinnerGain: roundPercent(stats.avgWinnerGain), 
                     avgLoserLoss: roundPercent(stats.avgLoserLoss), 
                     exitCount: monthExits, 
                     avgExitsPerMonth: Math.round(calculatedAvgExits * 10) / 10,
                     sectorAllocation: JSON.stringify(currentSectorAllocations)
                 });
             }

             lastMonthlyNav = nav;
             
             // Reset Monthly Stats
             monthExits = 0;
             monthsActive++;
        }

        // Prep for next day
        prevTotalEquity = totalEquity;
        currentDate = addDays(currentDate, 1);
    }
    

    
    // Batch Insert Implementation
    // Filter out snapshots on or before dataLockDate (protected data)
    const filterLocked = <T extends { date: Date }>(data: T[]): T[] => {
        if (!dataLockDate) return data;
        return data.filter(d => d.date > dataLockDate!);
    };

    const filteredDaily = filterLocked(dailyData);
    const filteredWeekly = filterLocked(weeklyData);
    // Deduplicate monthly snapshots by year-month, keeping only the latest entry per month
    // This prevents duplicates when locked data protects an older entry in the same month
    const monthlyDeduped = new Map<string, typeof monthlyData[0]>();
    for (const entry of monthlyData) {
        const key = `${entry.date.getFullYear()}-${entry.date.getMonth()}`;
        monthlyDeduped.set(key, entry); // Later entries (closer to today) overwrite earlier ones
    }
    const filteredMonthly = filterLocked(Array.from(monthlyDeduped.values()));

    if (filteredDaily.length > 0) {
        console.log(`Bulk Inserting ${filteredDaily.length} daily snapshots...`);
        await prisma.dailyPortfolioSnapshot.createMany({ data: filteredDaily });
    }
    if (filteredWeekly.length > 0) {
        console.log(`Bulk Inserting ${filteredWeekly.length} weekly snapshots...`);
        await prisma.weeklyPortfolioSnapshot.createMany({ data: filteredWeekly });
    }
    if (filteredMonthly.length > 0) {
        console.log(`Bulk Inserting ${filteredMonthly.length} monthly snapshots...`);
        onProgress?.("Saving snapshots...", 90);
        // Clear any existing monthly snapshots in the date range we're inserting
        // This handles entries created by captureMonthlySnapshot() on different dates
        const minMonthlyDate = filteredMonthly.reduce((min, e) => e.date < min ? e.date : min, filteredMonthly[0].date);
        await prisma.monthlyPortfolioSnapshot.deleteMany({
            where: { date: { gte: minMonthlyDate } }
        });
        await prisma.monthlyPortfolioSnapshot.createMany({ data: filteredMonthly });
    }

    console.log("Recalculation Complete.");
    // Invalidate caches - using 'as any' to bypass potential signature mismatch in tooling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (revalidateTag as any)('portfolio-data');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (revalidateTag as any)('dashboard-stats');
}

// updateJob, failJob, completeJob are imported at the top of the file

export async function recalculatePortfolioHistory(
    fromDate?: Date, 
    onProgress?: ProgressCallback, 
    jobId?: string,
    options?: { forceNSE?: boolean; forceSymbol?: string }
) {
    try {
        await recalculatePortfolioHistoryInternal(fromDate, async (msg, progress) => {
             if (jobId) {
                 await updateJob(jobId, progress, msg).catch(e => console.error("Job Update Failed:", e));
             }
             onProgress?.(msg, progress);
        }, options);
        
        if (jobId) {
            await completeJob(jobId, { success: true });
        }
    } catch (error) {
        console.error("Critical Error in Portfolio Recalculation:", error);
        if (jobId) {
             await failJob(jobId, error);
        }
        throw error; 
    }
}

async function getPortfolioHoldingsInternal(options?: { useLivePrices?: boolean }) {
    const engine = await computePortfolioState();

    const activeHoldings: { symbol: string; quantity: number; invested: number }[] = [];
    for (const [symbol, data] of engine.holdings) {
        if (data.qty > 0.01) {
             activeHoldings.push({ symbol, quantity: data.qty, invested: data.invested });
        }
    }

    if (activeHoldings.length === 0) {
        return [];
    }

    const symbols = activeHoldings.map(h => h.symbol);

    // Batch fetch latest prices for all active holdings (batched to avoid SQLite expression tree limit)
    const priceChunks = chunkArray(symbols);
    const latestDatesArrays = await Promise.all(
        priceChunks.map(chunk =>
            prisma.stockHistory.groupBy({
                by: ['symbol'],
                where: { symbol: { in: chunk } },
                _max: { date: true }
            })
        )
    );
    const latestDates = latestDatesArrays.flat();
    
    // Batch the OR conditions for latest prices
    const orConditions = latestDates.map(ld => ({
        symbol: ld.symbol,
        date: ld._max.date!
    }));
    const orChunks = chunkArray(orConditions);
    const latestPricesArrays = await Promise.all(
        orChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { OR: chunk },
                select: { symbol: true, close: true }
            })
        )
    );
    const latestPrices = latestPricesArrays.flat();

    const priceMap = new Map<string, number>();
    for (const p of latestPrices) {
        priceMap.set(p.symbol, p.close);
    }

    // Optionally fetch live prices (LTP) during market hours
    let livePriceMap: Map<string, number> | null = null;
    if (options?.useLivePrices && USE_UPSTOX) {
        try {
            const instrumentKeyMap = await getInstrumentKeys(symbols);
            const instrumentKeys = Array.from(instrumentKeyMap.values());

            if (instrumentKeys.length > 0) {
                const ltpMap = await getLTP(instrumentKeys);
                livePriceMap = new Map<string, number>();

                for (const [symbol, key] of instrumentKeyMap.entries()) {
                    const price = ltpMap.get(key);
                    if (price !== undefined) {
                        livePriceMap.set(symbol, price);
                    }
                }
            }
        } catch (error) {
            console.warn('[Portfolio] Live price fetch failed, falling back to latest close:', error);
        }
    }

    // Fetch sector mappings (batched to avoid SQLite expression tree limit)
    // Also fetch symbol mappings to handle renamed/delisted stocks
    let sectorMap = new Map<string, string>();
    try {
        // Get symbol mappings first
        const symbolMappingsForSector = await prisma.symbolMapping.findMany();
        
        // Build expanded symbol list (include both old and new symbols)
        const expandedSymbols = new Set(symbols);
        for (const m of symbolMappingsForSector) {
            if (symbols.includes(m.oldSymbol)) expandedSymbols.add(m.newSymbol);
            if (symbols.includes(m.newSymbol)) expandedSymbols.add(m.oldSymbol);
        }
        
        const sectorChunks = chunkArray(Array.from(expandedSymbols));
        const sectorMappingsArrays = await Promise.all(
            sectorChunks.map(chunk =>
                prisma.sectorMapping.findMany({
                    where: { symbol: { in: chunk } },
                    select: { symbol: true, sector: true }
                })
            )
        );
        const sectorMappings = sectorMappingsArrays.flat();
        sectorMap = new Map(sectorMappings.map((s: { symbol: string; sector: string }) => [s.symbol, s.sector]));
        
        // Extend sector mappings using symbol mappings (for renamed/delisted stocks)
        for (const m of symbolMappingsForSector) {
            const oldSector = sectorMap.get(m.oldSymbol);
            const newSector = sectorMap.get(m.newSymbol);
            
            if (oldSector && !newSector) {
                sectorMap.set(m.newSymbol, oldSector);
            } else if (newSector && !oldSector) {
                sectorMap.set(m.oldSymbol, newSector);
            }
        }
        console.log(`[Portfolio] Fetched ${sectorMappings.length} sector mappings, extended to ${sectorMap.size} for ${symbols.length} symbols`);
    } catch (error) {
        // Table may not exist yet - continue without sector data
        console.warn('[Portfolio] Sector lookup failed:', (error as Error).message);
    }

    // Fetch AMFI market cap classifications
    const amfiCategories = await getAMFICategoriesBatch(symbols);

    const today = startOfDay(new Date());
    const holdingPeriodDaysMap = new Map<string, number>();
    for (const [symbol, batches] of engine.inventory.entries()) {
        if (!batches || batches.length === 0) continue;
        let totalQty = 0;
        let weightedDays = 0;
        for (const batch of batches) {
            if (batch.qty <= 0) continue;
            const days = differenceInDays(today, startOfDay(batch.date));
            weightedDays += days * batch.qty;
            totalQty += batch.qty;
        }
        if (totalQty > 0) {
            holdingPeriodDaysMap.set(symbol, Math.round(weightedDays / totalQty));
        }
    }

    // Build final holdings array
    const validHoldings = activeHoldings.map(h => {
        const price = livePriceMap?.get(h.symbol) ?? priceMap.get(h.symbol) ?? 0;
        const currentValue = h.quantity * price;
        const pnl = currentValue - h.invested;
        const pnlPercent = h.invested > 0 ? (pnl / h.invested) * 100 : 0;
        
        // Get market cap category from AMFI classification
        const amfiCategory = amfiCategories.get(h.symbol);
        const marketCapCategory = mapAMFIToMarketCapCategory(amfiCategory || 'Small');

        return {
            symbol: h.symbol,
            quantity: h.quantity,
            invested: h.invested,
            currentValue,
            price,
            pnl,
            pnlPercent,
            marketCap: 0, // No longer fetching raw market cap value
            marketCapCategory,
            sector: sectorMap.get(h.symbol),
            holdingPeriodDays: holdingPeriodDaysMap.get(h.symbol)
        };
    });

    return validHoldings.sort((a, b) => b.currentValue - a.currentValue);
}

const getPortfolioHoldingsCached = unstable_cache(
    getPortfolioHoldingsInternal,
    ['portfolio-holdings-list'],
    { tags: ['portfolio-data'] }
);

export async function getPortfolioHoldings() {
    // Use live prices during market hours when Upstox token is available
    const [hasToken, marketOpen] = await Promise.all([
        hasValidToken(),
        isMarketOpenAsync()
    ]);

    if (USE_UPSTOX && hasToken && marketOpen) {
        return getPortfolioHoldingsInternal({ useLivePrices: true });
    }

    return getPortfolioHoldingsCached();
}

// Fetch 1-year price history for sparkline charts
export async function getStockPriceHistory(symbols: string[]): Promise<Map<string, { date: string; close: number }[]>> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    // Batch queries to avoid SQLite expression tree limit
    const historyChunks = chunkArray(symbols);
    const historyArrays = await Promise.all(
        historyChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: {
                    symbol: { in: chunk },
                    date: { gte: oneYearAgo }
                },
                orderBy: { date: 'asc' }
            })
        )
    );
    const history = historyArrays.flat();
    
    // Group by symbol and sample to ~52 data points (weekly)
    const result = new Map<string, { date: string; close: number }[]>();
    
    for (const symbol of symbols) {
        const symbolHistory = history.filter(h => h.symbol === symbol);
        
        // Sample to weekly data points for performance
        const step = Math.max(1, Math.floor(symbolHistory.length / 52));
        const sampled = symbolHistory
            .filter((_, i) => i % step === 0 || i === symbolHistory.length - 1)
            .map(h => ({
                date: format(h.date, 'yyyy-MM-dd'),
                close: h.close
            }));
        
        result.set(symbol, sampled);
    }
    
    return result;
}

async function getHistoricalPortfolioHoldingsInternal() {
    const engine = await computePortfolioState();
    
    const symbols = Array.from(engine.holdings.keys());
    
    if (symbols.length === 0) {
        return [];
    }

    // Batch fetch all latest prices (batched to avoid SQLite expression tree limit)
    const histPriceChunks = chunkArray(symbols);
    const latestDatesArrays = await Promise.all(
        histPriceChunks.map(chunk =>
            prisma.stockHistory.groupBy({
                by: ['symbol'],
                where: { symbol: { in: chunk } },
                _max: { date: true }
            })
        )
    );
    const latestDates = latestDatesArrays.flat();

    const orConditions = latestDates
        .filter(ld => ld._max.date !== null)
        .map(ld => ({
            symbol: ld.symbol,
            date: ld._max.date!
        }));
    const orChunks = chunkArray(orConditions);
    const latestPricesArrays = await Promise.all(
        orChunks.map(chunk =>
            prisma.stockHistory.findMany({
                where: { OR: chunk },
                select: { symbol: true, close: true }
            })
        )
    );
    const latestPrices = latestPricesArrays.flat();

    const priceMap = new Map<string, number>();
    for (const p of latestPrices) {
        priceMap.set(p.symbol, p.close);
    }

    const finalHoldings = symbols.map(sym => {
        const h = engine.holdings.get(sym)!;
        const currentPrice = priceMap.get(sym) || 0;

        const safeQty = Math.abs(h.qty) < 0.01 ? 0 : h.qty;
        const safeCurrentVal = safeQty * currentPrice;
        const safeCostOfHeld = Math.abs(h.qty) < 0.01 ? 0 : h.invested;

        const unrealizedPnl = safeCurrentVal - safeCostOfHeld;
        const totalPnl = h.realizedPnl + unrealizedPnl;
        
        return {
            symbol: sym,
            quantity: safeQty,
            currentPrice,
            currentValue: safeCurrentVal,
            invested: safeCostOfHeld,
            realizedPnl: h.realizedPnl,
            unrealizedPnl: unrealizedPnl,
            totalPnl: totalPnl
        };
    });

    return finalHoldings.sort((a, b) => b.totalPnl - a.totalPnl);
}

// Keep a placeholder for the rest to be deleted in part 2 if needed

export const getHistoricalPortfolioHoldings = unstable_cache(
    getHistoricalPortfolioHoldingsInternal,
    ['portfolio-historical-holdings'],
    { tags: ['portfolio-data'] }
);


async function calculatePortfolioXIRRInternal(currentValue: number) {
    const transactions = await prisma.transaction.findMany({});
    // Flow: -BuyAmount, +SellAmount
    // And finally +CurrentValuation at today.
    
    if (transactions.length === 0) return 0;
    
    const flows = transactions.map((t) => ({
        amount: t.type === 'BUY' ? -(t.quantity * t.price) : (t.quantity * t.price),
        when: t.date
    }));
    
    // Add current valuation
    flows.push({
        amount: currentValue,
        when: new Date()
    });
    
    try {
        const rate = xirr(flows);
        return rate * 100; // Convert to percentage
    } catch (e) {
        console.error("XIRR Calculation failed:", e);
        return 0;
    }
}

export const calculatePortfolioXIRR = unstable_cache(
    calculatePortfolioXIRRInternal,
    ['portfolio-xirr'],
    { tags: ['portfolio-data'] }
);

// Shared helper for market cap segmentation with concurrent fetching
type Holding = { symbol: string; currentValue: number };

interface MarketCapResult {
    large: number;
    mid: number;
    small: number;
    micro: number;
}

async function computeMarketCapSegmentation(
    holdings: Holding[]
): Promise<MarketCapResult> {
    // Fetch AMFI classifications for all holdings
    const symbols = holdings.map(h => h.symbol);
    const amfiCategories = await getAMFICategoriesBatch(symbols);
    
    let large = 0, mid = 0, small = 0, micro = 0;
    
    for (const holding of holdings) {
        const amfiCategory = amfiCategories.get(holding.symbol) || 'Small';
        const category = mapAMFIToMarketCapCategory(amfiCategory);
        
        switch (category) {
            case 'Large': large += holding.currentValue; break;
            case 'Mid': mid += holding.currentValue; break;
            case 'Small': small += holding.currentValue; break;
            case 'Micro': micro += holding.currentValue; break;
        }
    }
    
    return { large, mid, small, micro };
}


export async function captureWeeklySnapshot() {
    console.log("Capturing Weekly Snapshot...");
    const today = new Date();
    const todayStart = startOfDay(today);

    // 1. Get Current Holdings
    const holdings = await getPortfolioHoldings();
    
    // 2. Get latest Daily Snapshot for TotalEquity/NAV/Invested
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });
    
    if (!latestDaily) {
        console.error("No daily snapshot found. Cannot capture weekly stats.");
        return;
    }
    
    const totalEquity = latestDaily.totalEquity;
    const nav = latestDaily.portfolioNAV;
    const investedCapital = latestDaily.investedCapital;

    // 3. Market Cap Segmentation (using AMFI classifications)
    const mcapResult = await computeMarketCapSegmentation(holdings);
    const { large, mid, small, micro } = mcapResult;
    
    const stockTotal = large + mid + small + micro;
    const largePct = stockTotal > 0 ? (large / stockTotal) * 100 : 0;
    const midPct = stockTotal > 0 ? (mid / stockTotal) * 100 : 0;
    const smallPct = stockTotal > 0 ? (small / stockTotal) * 100 : 0;
    const microPct = stockTotal > 0 ? (micro / stockTotal) * 100 : 0;
    
    // Note: portfolioMcap (weighted average market cap) is no longer calculated
    // as we use AMFI categories instead of raw market cap values
    const portfolioMcap = 0;

    // 4. Performance Stats (Win/Loss)
    const allTx = await prisma.transaction.findMany({ 
        orderBy: { date: 'asc' } 
    });
    
    let wins = 0, losses = 0;
    let totalWinPct = 0, totalLossPct = 0;
    let totalHoldDays = 0, closedTradesCount = 0;

    const inventory = new Map<string, { qty: number, price: number, date: Date }[]>();
    
    for (const tx of allTx) {
        if (!inventory.has(tx.symbol)) inventory.set(tx.symbol, []);
        const queue = inventory.get(tx.symbol)!;
        
        if (tx.type === 'BUY') {
            queue.push({ qty: tx.quantity, price: tx.price, date: tx.date });
        } else {
            // SELL
            let qtySold = tx.quantity;
            let aquiredDateSum = 0;
            let currentTradeCost = 0;
            const batchSize = qtySold; 
            
            while (qtySold > 0 && queue.length > 0) {
                 const batch = queue[0];
                 const take = Math.min(batch.qty, qtySold);
                 
                 currentTradeCost += take * batch.price;
                 const days = (tx.date.getTime() - batch.date.getTime()) / (1000 * 3600 * 24);
                 aquiredDateSum += days * take;

                 batch.qty -= take;
                 if (batch.qty < 0.0001) queue.shift();
                 qtySold -= take;
            }
            
            const soldVal = batchSize * tx.price;
            const tradePnl = soldVal - currentTradeCost;
            const tradePct = currentTradeCost > 0 ? tradePnl / currentTradeCost : 0;
            
            if (tradePnl > 0) {
                wins++;
                totalWinPct += tradePct;
            } else {
                losses++;
                totalLossPct += tradePct;
            }
            
            const avgDuration = batchSize > 0 ? aquiredDateSum / batchSize : 0;
            totalHoldDays += avgDuration;
            closedTradesCount++;
        }
    }

    const winPercent = closedTradesCount > 0 ? (wins / closedTradesCount) * 100 : 0;
    const lossPercent = closedTradesCount > 0 ? (losses / closedTradesCount) * 100 : 0;
    const avgWinnerGain = wins > 0 ? (totalWinPct / wins) * 100 : 0;
    const avgLoserLoss = losses > 0 ? (totalLossPct / losses) * 100 : 0;
    const avgHoldingPeriod = closedTradesCount > 0 ? totalHoldDays / closedTradesCount : 0;
    
    // Stats
    const xirrVal = await calculatePortfolioXIRR(totalEquity);
    const pnl = totalEquity - investedCapital;

    // Calc Weekly Return
    let weeklyReturn = 0;
    const prevSnapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
        where: { date: { lt: todayStart } },
        orderBy: { date: 'desc' }
    });
    if (prevSnapshot && prevSnapshot.nav > 0) {
        weeklyReturn = (nav / prevSnapshot.nav) - 1;
    }

    // Save
    await prisma.weeklyPortfolioSnapshot.upsert({
        where: { date: todayStart },
        update: {
             totalEquity,
             nav,
             weeklyReturn,
             largeCapPercent: largePct,
             midCapPercent: midPct,
             smallCapPercent: smallPct,
             microCapPercent: microPct,

             marketCap: portfolioMcap,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss
        },
        create: {
             date: todayStart,
             totalEquity,
             nav,
             weeklyReturn,
             largeCapPercent: largePct,
             midCapPercent: midPct,
             smallCapPercent: smallPct,
             microCapPercent: microPct,

             marketCap: portfolioMcap,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss
        }
    });
    
    console.log("Weekly Snapshot Captured.");
}

export async function captureMonthlySnapshot() {
    console.log("Capturing Monthly Snapshot...");
    const today = new Date();
    const todayStart = startOfDay(today);

    // Delete any existing monthly snapshot from the same month to prevent duplicates
    // (recalculation may have created one on a different date within this month)
    const monthStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
    const monthEnd = new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999));
    await prisma.monthlyPortfolioSnapshot.deleteMany({
        where: { date: { gte: monthStart, lte: monthEnd } }
    });

    // 1. Get Current Holdings
    const holdings = await getPortfolioHoldings();
    
    // 2. Get latest Daily Snapshot for TotalEquity/NAV
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });
    
    if (!latestDaily) {
        console.error("No daily snapshot found. Cannot capture monthly stats.");
        return;
    }
    
    const totalEquity = latestDaily.totalEquity;
    const nav = latestDaily.portfolioNAV;
    
    // 3. Market Cap Segmentation (using AMFI classifications)
    const mcapResult = await computeMarketCapSegmentation(holdings);
    const { large, mid, small, micro } = mcapResult;
    
    const stockTotal = large + mid + small + micro;
    const largePct = stockTotal > 0 ? (large / stockTotal) * 100 : 0;
    const midPct = stockTotal > 0 ? (mid / stockTotal) * 100 : 0;
    const smallPct = stockTotal > 0 ? (small / stockTotal) * 100 : 0;
    const microPct = stockTotal > 0 ? (micro / stockTotal) * 100 : 0;
    // Note: portfolioMcap is no longer calculated as we use AMFI categories
    const portfolioMcap = 0;

    // 4. Performance Stats (Same as Weekly)
    const allTx = await prisma.transaction.findMany({ orderBy: { date: 'asc' } });
    let wins = 0, losses = 0;
    let totalWinPct = 0, totalLossPct = 0;
    let totalHoldDays = 0, closedTradesCount = 0;
    const inventory = new Map<string, { qty: number, price: number, date: Date }[]>();
    
    for (const tx of allTx) {
        if (!inventory.has(tx.symbol)) inventory.set(tx.symbol, []);
        const queue = inventory.get(tx.symbol)!;
        if (tx.type === 'BUY') {
            queue.push({ qty: tx.quantity, price: tx.price, date: tx.date });
        } else {
             // SELL
            let qtySold = tx.quantity;
            let aquiredDateSum = 0;
            let currentTradeCost = 0;
            const batchSize = qtySold; 
            
            while (qtySold > 0 && queue.length > 0) {
                 const batch = queue[0];
                 const take = Math.min(batch.qty, qtySold);
                 currentTradeCost += take * batch.price;
                 const days = (tx.date.getTime() - batch.date.getTime()) / (1000 * 3600 * 24);
                 aquiredDateSum += days * take;
                 batch.qty -= take;
                 if (batch.qty < 0.0001) queue.shift();
                 qtySold -= take;
            }
            const soldVal = batchSize * tx.price;
            const tradePnl = soldVal - currentTradeCost;
            const tradePct = currentTradeCost > 0 ? tradePnl / currentTradeCost : 0;
            if (tradePnl > 0) { wins++; totalWinPct += tradePct; }
            else { losses++; totalLossPct += tradePct; }
            totalHoldDays += batchSize > 0 ? aquiredDateSum / batchSize : 0;
            closedTradesCount++;
        }
    }

    const winPercent = closedTradesCount > 0 ? (wins / closedTradesCount) * 100 : 0;
    const lossPercent = closedTradesCount > 0 ? (losses / closedTradesCount) * 100 : 0;
    const avgWinnerGain = wins > 0 ? (totalWinPct / wins) * 100 : 0;
    const avgLoserLoss = losses > 0 ? (totalLossPct / losses) * 100 : 0;
    const avgHoldingPeriod = closedTradesCount > 0 ? totalHoldDays / closedTradesCount : 0;
    
    const xirrVal = await calculatePortfolioXIRR(totalEquity);
    // PnL based on Invested Capital
    // Need invested capital from latest daily
    const investedCapital = latestDaily.investedCapital;
    const pnl = totalEquity - investedCapital;

    // Calc Monthly Return
    let monthlyReturn = 0;
    const prevSnapshot = await prisma.monthlyPortfolioSnapshot.findFirst({
        where: { date: { lt: todayStart } },
        orderBy: { date: 'desc' }
    });
    if (prevSnapshot && prevSnapshot.nav > 0) {
        monthlyReturn = (nav / prevSnapshot.nav) - 1;
    }

    await prisma.monthlyPortfolioSnapshot.upsert({
        where: { date: todayStart },
        update: {
             totalEquity,
             nav,
             monthlyReturn,
             largeCapPercent: largePct,
             midCapPercent: midPct,
             smallCapPercent: smallPct,
             microCapPercent: microPct,
             marketCap: portfolioMcap,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss
        },
        create: {
             date: todayStart,
             totalEquity,
             nav,
             monthlyReturn,
             largeCapPercent: largePct,
             midCapPercent: midPct,
             smallCapPercent: smallPct,
             microCapPercent: microPct,
             marketCap: portfolioMcap,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss
        }
    });
    console.log("Monthly Snapshot Captured.");
}

// Get latest portfolio stats for dashboard
async function getLatestPortfolioStatsInternal() {
    const snapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });
    
    if (!snapshot) {
        return {
            largeCapPercent: 0,
            midCapPercent: 0,
            smallCapPercent: 0,
            microCapPercent: 0,
            winPercent: 0,
            lossPercent: 0,
            avgHoldingPeriod: 0,
            avgWinnerGain: 0,
            avgLoserLoss: 0
        };
    }
    
    return {
        largeCapPercent: snapshot.largeCapPercent || 0,
        midCapPercent: snapshot.midCapPercent || 0,
        smallCapPercent: snapshot.smallCapPercent || 0,
        microCapPercent: snapshot.microCapPercent || 0,
        winPercent: snapshot.winPercent || 0,
        lossPercent: 100 - (snapshot.winPercent || 0), // Losers = 100 - Winners
        avgHoldingPeriod: snapshot.avgHoldingPeriod || 0,
        avgWinnerGain: snapshot.avgWinnerGain || 0,
        avgLoserLoss: snapshot.avgLoserLoss || 0
    };
}

export const getLatestPortfolioStats = unstable_cache(
    getLatestPortfolioStatsInternal,
    ['portfolio-latest-stats'],
    { tags: ['portfolio-data'] }
);

// Get dashboard stats (NAV, DD, returns)
async function getDashboardStatsInternal() {
    // Get latest daily snapshot for NAV and DD
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // Get latest weekly snapshot for weekly return
    // If we're at the start of a new week (Monday-Thursday) and the latest weekly snapshot
    // is from this week with 0 return, show the previous week's data instead
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday
    
    let weeklySnapshotToUse = await prisma.weeklyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // If it's Monday (1) through Thursday (4) and the latest snapshot is from this week with 0 return
    // Or if it's Friday but the snapshot is from today (just created)
    if (weeklySnapshotToUse && dayOfWeek >= 1 && dayOfWeek <= 4) {
        const snapshotDate = new Date(weeklySnapshotToUse.date);
        const daysSinceSnapshot = differenceInDays(today, snapshotDate);
        
        // If the snapshot is from this week (less than 7 days old) and return is 0,
        // fetch the previous week's snapshot
        if (daysSinceSnapshot < 7 && Math.abs(weeklySnapshotToUse.weeklyReturn ?? 0) < 0.0001) {
            const previousWeekSnapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
                where: { date: { lt: snapshotDate } },
                orderBy: { date: 'desc' }
            });
            if (previousWeekSnapshot) {
                weeklySnapshotToUse = previousWeekSnapshot;
            }
        }
    }

    // Get latest monthly snapshot for monthly return
    const latestMonthly = await prisma.monthlyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // Calculate YTD return: from first daily snapshot of current year
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    
    const firstOfYear = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: { gte: startOfYear } },
        orderBy: { date: 'asc' }
    });

    let yearReturn = 0;
    if (firstOfYear && latestDaily && firstOfYear.portfolioNAV > 0) {
        yearReturn = ((latestDaily.portfolioNAV / firstOfYear.portfolioNAV) - 1) * 100;
    }

    // Calculate 1Y return: from snapshot ~1 year ago
    const oneYearAgo = subYears(new Date(), 1);
    const oneYearSnapshot = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: { gte: oneYearAgo } },
        orderBy: { date: 'asc' }
    });

    let oneYearReturn = 0;
    if (oneYearSnapshot && latestDaily && oneYearSnapshot.portfolioNAV > 0) {
        oneYearReturn = ((latestDaily.portfolioNAV / oneYearSnapshot.portfolioNAV) - 1) * 100;
    }

    return {
        currentNAV: latestDaily?.portfolioNAV || 0,
        currentDD: (latestDaily?.drawdown || 0) * 100,
        weekReturn: (weeklySnapshotToUse?.weeklyReturn || 0) * 100,
        monthReturn: (latestMonthly?.monthlyReturn || 0) * 100,
        yearReturn,
        oneYearReturn
    };
}

export const getDashboardStats = unstable_cache(
    getDashboardStatsInternal,
    ['dashboard-stats'],
    { tags: ['portfolio-data'] }
);

/**
 * Capture a holiday snapshot by cloning the previous day's data.
 * Used when the market is closed to avoid unnecessary recalculation.
 */
export async function captureHolidaySnapshot(date: Date = new Date()) {
    const today = startOfDay(date);
    
    // Check if snapshot already exists for today
    const existing = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: today }
    });
    
    if (existing) {
        console.log(`[Snapshot] Snapshot for ${format(today, 'yyyy-MM-dd')} already exists. Skipping holiday clone.`);
        return;
    }

    // Get latest available snapshot
    const latest = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    if (!latest) {
        console.warn('[Snapshot] No previous snapshot found to clone.');
        return;
    }

    console.log(`[Snapshot] Cloning snapshot from ${format(latest.date, 'yyyy-MM-dd')} for Holiday/Closed Market (${format(today, 'yyyy-MM-dd')})`);

    // Create new snapshot with same values but today's date
    await prisma.dailyPortfolioSnapshot.create({
        data: {
            date: today,
            totalEquity: latest.totalEquity,
            investedCapital: latest.investedCapital,
            portfolioNAV: latest.portfolioNAV,
            niftyNAV: latest.niftyNAV,
            units: latest.units,
            
            // Zero out daily changes
            cashflow: 0,
            dailyPnL: 0,
            dailyReturn: 0,
            
            // Carry over risk metrics
            drawdown: latest.drawdown,
            navMA200: latest.navMA200,
            
            // Carry over index benchmarks
            nifty500Momentum50NAV: latest.nifty500Momentum50NAV,
            niftyMicrocap250NAV: latest.niftyMicrocap250NAV,
            niftyMidcap100NAV: latest.niftyMidcap100NAV,
            niftySmallcap250NAV: latest.niftySmallcap250NAV
        }
    });

    // Also revalidate paths
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (revalidateTag as any)('portfolio-data', 'max');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (revalidateTag as any)('dashboard-stats', 'max');
}
