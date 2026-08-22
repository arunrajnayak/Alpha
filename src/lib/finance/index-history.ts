import { prisma } from '@/lib/db';
import { addDays, format, subDays } from 'date-fns';
import { getHistoricalCandles } from '../upstox-client';
import { getInstrumentKey } from '../instrument-service';
import { fetchNSEIndexHistory } from '../nse-api';
import { financeLogger } from '@/lib/logger';

// Fetch Nifty History
export async function updateIndexHistory(startDate: Date) {
    const indices = [
        { symbol: 'NIFTY50', displayName: 'NIFTY 50' },
        { symbol: 'NIFTY_500', displayName: 'NIFTY 500' },
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

            financeLogger.info(`[Index] Updating ${symbol} (${displayName}) from ${fetchStart.toISOString().split('T')[0]}`);

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
                        financeLogger.debug(`[Index] Got ${dataPoints.length} records from Upstox for ${symbol}`);
                    }
                }
            } catch (error) {
                financeLogger.warn(`[Index] Upstox fetch failed for ${symbol}:`, error);
            }

            // FALLBACK: Try NSE if Upstox returned no data (e.g. Special Trading Session not yet in API or Upstox failure)
            if (dataPoints.length === 0) {
                try {
                    financeLogger.debug(`[Index] Falling back to NSE for ${symbol}...`);
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

                            financeLogger.debug(`[Index] Got ${dataPoints.length} records from NSE for ${symbol}`);
                        }
                    }
                } catch (nseError) {
                    financeLogger.warn(`[Index] NSE fallback failed for ${symbol}:`, nseError);
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
                financeLogger.info(`[Index] Upserted ${fullSeries.length} records for ${symbol}`);
            } else {
                financeLogger.warn(`[Index] Failed to fetch any data for ${symbol}`);
            }

        } catch(e) {
            financeLogger.error(`Failed to handle index ${symbol}:`, e);
        }
    }
}
