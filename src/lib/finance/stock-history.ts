import { prisma } from '@/lib/db';
import { addDays, isSameDay, startOfDay, format, differenceInDays, isWeekend } from 'date-fns';
import { getDataLockDate } from '../config';
import { getHistoricalCandles, hasValidToken, getLiveQuotes, UpstoxCandle } from '../upstox-client';
import { getInstrumentKey, getInstrumentKeys } from '../instrument-service';
import { fetchNSEHistory } from '../nse-api';
import { getMarketStatus } from '../market-holidays-cache';
import { getMarketHolidays } from '../upstox/market-info';
import { financeLogger } from '@/lib/logger';
import { istTimeParts, istDayOfWeek, todayISTYmd, utcMidnightOfISTDate } from '@/lib/tz';
import { StockQuote, StockHistoryResult, SplitEvent, RequestCache } from './types';

// Feature flag for Upstox migration - set to true to use Upstox as primary data source
const USE_UPSTOX = process.env.USE_UPSTOX !== 'false'; // Default to true

async function fetchUpstoxHistory(
    symbol: string,
    startDate: Date,
    endDate: Date,
    cache: RequestCache
): Promise<StockHistoryResult | null> {
    const cacheKey = `upstox-${symbol}-${startDate.toISOString()}-${endDate.toISOString()}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        financeLogger.debug(`[Cache Hit] Reusing Upstox request for ${symbol}`);
        return cached;
    }

    const promise = (async () => {
        try {
            // Get instrument key for the symbol
            const instrumentKey = await getInstrumentKey(symbol);

            if (!instrumentKey) {
                financeLogger.warn(`[Upstox] No instrument key found for ${symbol}`);
                return null;
            }

            // Format dates for Upstox API (YYYY-MM-DD)
            const fromDate = format(startDate, 'yyyy-MM-dd');
            const toDate = format(endDate, 'yyyy-MM-dd');

            financeLogger.debug(`[Upstox] Fetching history for ${symbol} (${instrumentKey}) from ${fromDate} to ${toDate}`);

            const result = await getHistoricalCandles(instrumentKey, 'day', fromDate, toDate);

            if (!result.candles || result.candles.length === 0) {
                financeLogger.warn(`[Upstox] No candle data returned for ${symbol}`);
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

            financeLogger.debug(`[Upstox] Got ${quotes.length} candles for ${symbol}`);

            return { quotes };
        } catch (error) {
            financeLogger.error(`[Upstox] Failed to fetch history for ${symbol}:`, error);
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
            financeLogger.warn('[Upstox] No valid token for live quotes');
            return result;
        }

        const instrumentKeyMap = await getInstrumentKeys(symbols);
        const instrumentKeys = Array.from(instrumentKeyMap.values());

        if (instrumentKeys.length === 0) {
            return result;
        }

        const liveMap = await getLiveQuotes(instrumentKeys);

        // Map back to symbols
        for (const [symbol, key] of instrumentKeyMap.entries()) {
            const quote = liveMap.get(key);
            if (quote !== undefined) {
                result.set(symbol, {
                    last_price: quote.last_price,
                    volume: quote.volume ?? 0,
                });
            }
        }
    } catch (error) {
        financeLogger.error('[Upstox] Failed to fetch live quotes:', error);
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

    // Fetch market holidays for validation
    let marketHolidays = new Set<string>();
    try {
        const holidays = await getMarketHolidays();
        marketHolidays = new Set(
            holidays.filter(h => h.holiday_type === 'TRADING_HOLIDAY').map(h => h.date)
        );
    } catch (e) {
        financeLogger.warn('[UpdateStockHistory] Failed to load market holidays:', e);
    }

    // Dynamic Market Status Check
    const status = await getMarketStatus();
    const todayYmd = todayISTYmd(today);
    const day = istDayOfWeek(today);
    const isWeekendDay = day === 0 || day === 6;
    const isHoliday = status.reason?.includes('Holiday') || status.reason?.includes('Weekend') || marketHolidays.has(todayYmd);

    // It is EOD only if today is a regular trading day AND the session has closed:
    let isEOD = false;

    if (!isWeekendDay && !isHoliday) {
        if (status.closeTime) {
             // Use API-provided close time
             isEOD = !status.isOpen || new Date() >= status.closeTime;
             if (isEOD) financeLogger.info(`[UpdateStockHistory] EOD Detected via API (Close Time: ${status.closeTime.toLocaleTimeString()})`);
        } else {
             // Fallback to static schedule (use IST hours, not server-local hours)
             isEOD = istTimeParts().hour >= 16; // After 4:00 PM IST
             financeLogger.info(`[UpdateStockHistory] EOD Detected via Static Fallback (No API status)`);
        }
    } else {
        financeLogger.info(`[UpdateStockHistory] Market is closed today (Weekend/Holiday: ${status.reason || todayYmd}). Skipping EOD live quotes.`);
    }

    // Check if Upstox is available
    const upstoxAvailable = USE_UPSTOX && (await hasValidToken());
    financeLogger.info(`[UpdateStockHistory] Data source: ${upstoxAvailable ? 'Upstox' : 'Yahoo Finance (fallback)'}`);

    // Pre-fetch live quotes for all symbols if we are looking for "Today"
    let upstoxLiveQuotes: Map<string, { last_price: number; volume?: number }> = new Map();

    if (isEOD && symbols.length > 0 && upstoxAvailable) {
        try {
            financeLogger.info(`[UpdateStockHistory] EOD Detected. Pre-fetching Upstox live quotes...`);
            upstoxLiveQuotes = await fetchUpstoxLiveQuotes(symbols);
            financeLogger.info(`[UpdateStockHistory] Got ${upstoxLiveQuotes.size} Upstox live quotes`);
        } catch (err) {
            financeLogger.warn(`[UpdateStockHistory] Upstox live quote pre-fetch failed:`, err);
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
                                 financeLogger.debug(`[UpdateStockHistory] Updating EOD price for ${symbol} via live quote: ${latest.close} -> ${livePrice}`);
                                 await prisma.stockHistory.update({
                                     where: { id: latest.id },
                                     data: { close: livePrice }
                                 });
                             }
                             // Skip historical fetch - we've updated with live data
                             return;
                         }
                         // No live quote available, fall back to historical fetch
                         financeLogger.debug(`[UpdateStockHistory] Re-verifying EOD price for ${symbol} (Existing: ${latest.close})`);
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
                     financeLogger.debug(`[UpdateStockHistory] Clamping fetch start for ${symbol} from ${fetchStart.toISOString().split('T')[0]} to ${newStart.toISOString().split('T')[0]} (Data Lock)`);
                 }
                 fetchStart = newStart;
            }

            if (fetchStart > today) return;

            financeLogger.debug(`Fetching history for ${symbol} from ${fetchStart.toISOString()}`);

            let result: StockHistoryResult | null = null;

            // PRIMARY: Try Upstox if available
            // Fetch historical data from Upstox
            if (upstoxAvailable) {
                result = await fetchUpstoxHistory(symbol, fetchStart, today, cache);

                if (result && result.quotes && result.quotes.length > 0) {
                    financeLogger.debug(`[Upstox] Got ${result.quotes.length} candles for ${symbol}`);
                }
            }

            // FALLBACK: Try NSE for delisted/unknown symbols
            if (!result || !result.quotes || result.quotes.length === 0) {
                financeLogger.debug(`[Stock History] Upstox has no data for ${symbol}, trying NSE fallback...`);
                try {
                    const nseData = await fetchNSEHistory(symbol, fetchStart, today);
                    if (nseData && nseData.data && nseData.data.length > 0) {
                        // Convert NSE format to standard quote format
                        // Note: d.CH_TIMESTAMP is in UTC format of IST midnight e.g. "2026-09-14T18:30:00.000Z".
                        // Must resolve the IST date ("2026-09-15") to avoid a 1-day backward shift!
                        const nseQuotes = nseData.data.map(d => {
                            const istDateStr = todayISTYmd(new Date(d.CH_TIMESTAMP));
                            return {
                                date: utcMidnightOfISTDate(istDateStr),
                                close: d.CH_CLOSING_PRICE,
                                adjClose: d.CH_CLOSING_PRICE,
                                open: d.CH_CLOSING_PRICE,
                                high: d.CH_CLOSING_PRICE,
                                low: d.CH_CLOSING_PRICE,
                                volume: 0
                            };
                        });
                        result = { quotes: nseQuotes };
                        financeLogger.debug(`[NSE Fallback] Got ${nseQuotes.length} records for ${symbol}`);
                    }
                } catch (nseErr) {
                    financeLogger.warn(`[NSE Fallback] Failed for ${symbol}:`, nseErr);
                }
            }

            // Skip if no data available from any source
            // MODIFIED: If EOD and we have a live quote for today, we proceed to allow injection
            const hasLiveQuoteForToday = isEOD && upstoxLiveQuotes.has(symbol) && fetchStart <= today;

            if ((!result || !result.quotes || result.quotes.length === 0) && !hasLiveQuoteForToday) {
                financeLogger.warn(`[Stock History] No data available for ${symbol} from any source`);
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
                           financeLogger.debug(`[UpdateStockHistory] Fixing stale chart price for ${symbol}: ${chartPrice} -> ${livePrice} (Live)`);
                           quotes[chartTodayIdx].close = livePrice;
                           quotes[chartTodayIdx].adjClose = livePrice;
                      }
                 } else {
                      // Chart missing today entirely, but we have a live quote for today
                      financeLogger.debug(`[UpdateStockHistory] Injecting missing today price for ${symbol}: ${livePrice} (Live)`);
                      quotes.push({
                          date: today,
                          close: livePrice,
                          adjClose: livePrice,
                          volume: upstoxLive?.volume ?? 0,
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
                    financeLogger.info(`[UpdateStockHistory] Overriding Yahoo Split (Detected near ${new Date(mergedSplits[existingIdx].date).toISOString().split('T')[0]}) with MANUAL_FIX for ${symbol} on ${manual.date.toISOString().split('T')[0]}`);
                    mergedSplits.splice(existingIdx, 1);
                } else {
                    financeLogger.info(`[UpdateStockHistory] Injecting MANUAL_FIX Split for ${symbol} on ${manual.date.toISOString().split('T')[0]}`);
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
                           financeLogger.debug(`[Split Check] Detected RAW data for ${symbol} around ${split.date.toISOString().split('T')[0]}. Drop ${priceRatio.toFixed(2)} ~ Ratio ${split.ratio}. Ignoring adjustment.`);
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
                const dStr = format(utcDate, 'yyyy-MM-dd');

                // Never insert price data on weekends or trading holidays
                if (isWeekend(utcDate) || marketHolidays.has(dStr)) {
                    continue;
                }

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
                         financeLogger.debug(`[UpdateStockHistory] Force update active, but respecting Data Lock <= ${lockDate.toISOString().split('T')[0]}`);
                         deleteCondition.date = {
                             gte: data[data.length - 1].date, // quotes are sorted DESC, so last is min
                             lte: data[0].date,
                             gt: lockDate
                         };
                     } else {
                         financeLogger.debug(`[UpdateStockHistory] Overwriting existing data range for ${symbol} due to force flag.`);
                         deleteCondition.date = {
                             gte: data[data.length - 1].date,
                             lte: data[0].date
                         };
                     }

                     const deleted = await prisma.stockHistory.deleteMany({
                         where: deleteCondition
                     });
                     financeLogger.debug(`[UpdateStockHistory] Deleted ${deleted.count} records for ${symbol} within range (Force Override).`);
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
                                  financeLogger.debug(`[UpdateStockHistory] Overwriting Today's record for ${symbol} via specific update.`);

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
                    financeLogger.debug(`[UpdateStockHistory] Successfully created ${created.count} records for ${symbol}.`);
                } else {
                    financeLogger.debug(`[UpdateStockHistory] No new rows to insert for ${symbol} (All already exist).`);
                }
            }

            // NOTE: Split storage moved to fetchCorporateActions() to avoid duplicates.
            // This function now only handles price history.

        } catch (e: unknown) {
            financeLogger.error(`Failed to fetch history for ${symbol}:`, e);
        }
    });

    // Log Summary
    financeLogger.info(`[UpdateStockHistory] Completed for ${symbols.length} symbols.`);
}
