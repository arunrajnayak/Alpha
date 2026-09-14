/**
 * Screener price ingestion — fetch daily OHLCV candles from Upstox and store in ScreenerPrice.
 * Incremental: only fetches candles from last stored date to today.
 */

import { prisma, chunkArray, SQLITE_IN_CLAUSE_LIMIT } from '@/lib/db';
import { getHistoricalCandles, getOHLC } from '@/lib/upstox-client';
import { toDateStr, daysAgo, todayIST } from './dates';
import { withConcurrency, withRetry } from './utils';
import { logger } from '@/lib/logger';

const priceLogger = logger.scope('ScreenerPrices');

interface InstrumentInfo {
  symbol: string;
  instrumentKey: string;
}

/**
 * Patch today's prices for all instruments using the batch market-quote OHLC endpoint.
 * ~4 API calls for 2000 stocks (vs 2000 individual historical-candle calls).
 * Deletes and re-inserts today's row so it's safe to call multiple times.
 */
export async function patchTodayPrices(
  instruments: InstrumentInfo[],
  forDate: string,
  duringMarket = false,
): Promise<{ patched: number; errors: string[]; missing: InstrumentInfo[] }> {
  const instrumentKeys = instruments.map(i => i.instrumentKey);

  // Chunk to 500 per request (Upstox batch limit).
  // Catch per-batch so one failure doesn't kill the entire step.
  const ohlcMap = new Map<string, { open: number; high: number; low: number; close: number; volume?: number }>();
  const batchErrors: string[] = [];
  const chunks = chunkArray(instrumentKeys, 500);
  for (let i = 0; i < chunks.length; i++) {
    // 250ms spacing between batches to stay well within 50 req/s rate limit
    if (i > 0) await new Promise(r => setTimeout(r, 250));
    try {
      const chunkMap = await getOHLC(chunks[i], '1d', duringMarket);
      for (const [key, val] of chunkMap) ohlcMap.set(key, val);
    } catch (err) {
      batchErrors.push(`OHLC batch ${i + 1}/${chunks.length}: ${(err as Error).message}`);
      priceLogger.error(`OHLC batch ${i + 1} failed, continuing with remaining batches`);
    }
  }

  const rows: Array<{
    symbol: string; instrumentKey: string; date: string;
    open: number; high: number; low: number; close: number; volume: number;
  }> = [];
  const missing: InstrumentInfo[] = [];

  for (const inst of instruments) {
    const ohlc = ohlcMap.get(inst.instrumentKey);
    if (!ohlc?.close) {
      missing.push(inst);
      continue;
    }
    rows.push({
      symbol: inst.symbol,
      instrumentKey: inst.instrumentKey,
      date: forDate,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
      volume: Math.round(ohlc.volume ?? 0),
    });
  }

  if (rows.length === 0) {
    return { patched: 0, errors: [...batchErrors, 'No OHLC data returned — market may be closed'], missing };
  }

  // Delete then re-insert today's rows (idempotent)
  // Use larger chunks (500) — Turso batches via HTTP, not raw SQL, so the SQLite
  // 999-variable limit doesn't apply. This cuts 60 round-trips to ~8.
  for (const chunk of chunkArray(rows.map(r => r.symbol), 500)) {
    await prisma.screenerPrice.deleteMany({ where: { symbol: { in: chunk }, date: forDate } });
  }
  for (const chunk of chunkArray(rows, 500)) {
    await prisma.screenerPrice.createMany({ data: chunk });
  }

  priceLogger.info(`Patched ${rows.length} stocks with today's OHLC (${forDate}); ${missing.length} had no live_ohlc`);
  return { patched: rows.length, errors: batchErrors, missing };
}

/**
 * Fetch and store daily candles for all instruments.
 * Incremental: finds last stored date per stock, only fetches missing days.
 * First run: backfills 400 calendar days (~12+ months of trading days).
 */
export async function fetchAndStoreCandles(
  instruments: InstrumentInfo[],
  toDate?: string, // defaults to todayIST(); pass T-1 during market hours
): Promise<{ fetched: number; inserted: number; errors: string[] }> {
  const today = toDate ?? todayIST();
  const defaultFromDate = daysAgo(400, today); // ~12+ months (safety buffer) for first run

  // Get last stored date per symbol in batch
  const lastDates = await getLastStoredDates(instruments.map(i => i.symbol));

  let totalInserted = 0;
  const instrumentsToFetch: { inst: InstrumentInfo; fromDate: string }[] = [];

  for (const inst of instruments) {
    const lastDate = lastDates.get(inst.symbol);
    if (lastDate === today) continue; // Already up to date

    const fromDate = lastDate
      ? nextDay(lastDate) // Day after last stored
      : defaultFromDate;

    if (fromDate > today) continue; // Already up to date
    instrumentsToFetch.push({ inst, fromDate });
  }

  priceLogger.info(`Fetching candles for ${instrumentsToFetch.length} stocks (${instruments.length - instrumentsToFetch.length} already up to date)`);

  const fetchStock = async ({ inst, fromDate }: { inst: InstrumentInfo; fromDate: string }) => {
    const candles = await withRetry(() =>
      getHistoricalCandles(inst.instrumentKey, 'day', fromDate, today)
    );

    if (!candles?.candles || candles.candles.length === 0) return;

    const rows = candles.candles.map(c => ({
      symbol: inst.symbol,
      instrumentKey: inst.instrumentKey,
      date: c.timestamp.slice(0, 10), // Extract YYYY-MM-DD directly from IST timestamp (avoids UTC shift)
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Math.round(c.volume),
    }));

    const existingDates = new Set(
      (await prisma.screenerPrice.findMany({
        where: { symbol: inst.symbol, date: { in: rows.map(r => r.date) } },
        select: { date: true },
      })).map(r => r.date)
    );

    const newRows = rows.filter(r => !existingDates.has(r.date));
    if (newRows.length === 0) return;

    for (const chunk of chunkArray(newRows, 100)) {
      await prisma.screenerPrice.createMany({ data: chunk });
    }
    totalInserted += newRows.length;
  };

  // Phase 1: fetch all stocks with concurrency + stagger + per-request throttle
  // 3 workers × 300ms throttle ≈ 3 req/s sustained — stays under Cloudflare WAF limits
  const phase1 = await withConcurrency(instrumentsToFetch, fetchStock, 3, 300, 300);

  let allErrors = [...phase1.errors];
  let totalSuccesses = phase1.successes;

  // Phase 2: cool-off retry for rate-limited stocks
  if (phase1.rateLimited.length > 0) {
    const coolOffMs = 2 * 60_000; // 2 minutes
    priceLogger.warn(`${phase1.rateLimited.length} stocks rate-limited — cooling off ${coolOffMs / 1000}s then retrying serially`);
    await new Promise(r => setTimeout(r, coolOffMs));
    priceLogger.info('Cool-off complete, retrying rate-limited stocks...');
    const phase2 = await withConcurrency(phase1.rateLimited, fetchStock, 1, 0, 500);
    totalSuccesses += phase2.successes;
    allErrors = allErrors.concat(phase2.errors);
    if (phase2.rateLimited.length > 0) {
      priceLogger.warn(`${phase2.rateLimited.length} stocks still rate-limited after cool-off — will retry on next run`);
      allErrors = allErrors.concat(phase2.rateLimited.map(({ inst }) => `${inst.symbol}: rate-limited`));
    }
  }

  priceLogger.info(`Candle ingestion complete: ${totalSuccesses} stocks, ${totalInserted} rows inserted, ${allErrors.length} errors`);
  return { fetched: totalSuccesses, inserted: totalInserted, errors: allErrors };
}

/**
 * Flush all candles for a stock and re-fetch (for corporate action adjustments).
 */
export async function flushAndRefetchStock(symbol: string, instrumentKey: string): Promise<number> {
  await prisma.screenerPrice.deleteMany({ where: { symbol } });

  const today = todayIST();
  const fromDate = daysAgo(400, today);

  const candles = await withRetry(() =>
    getHistoricalCandles(instrumentKey, 'day', fromDate, today)
  );

  if (!candles?.candles || candles.candles.length === 0) return 0;

  const rows = candles.candles.map(c => ({
    symbol,
    instrumentKey,
    date: c.timestamp.slice(0, 10), // Extract YYYY-MM-DD directly from IST timestamp (avoids UTC shift)
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: Math.round(c.volume),
  }));

  for (const chunk of chunkArray(rows, 100)) {
    await prisma.screenerPrice.createMany({ data: chunk });
  }

  priceLogger.info(`Flushed and re-fetched ${rows.length} candles for ${symbol}`);
  return rows.length;
}

/** Get last stored date per symbol from ScreenerPrice */
async function getLastStoredDates(symbols: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const chunks = chunkArray(symbols, SQLITE_IN_CLAUSE_LIMIT);

  for (const chunk of chunks) {
    // Prisma doesn't support GROUP BY natively — use raw query or per-symbol query
    // For efficiency, fetch the max date per symbol using findMany with orderBy
    const rows = await prisma.screenerPrice.findMany({
      where: { symbol: { in: chunk } },
      select: { symbol: true, date: true },
      orderBy: { date: 'desc' },
      distinct: ['symbol'],
    });
    for (const row of rows) {
      result.set(row.symbol, row.date);
    }
  }

  return result;
}

/** Get the next day as YYYY-MM-DD */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return toDateStr(d);
}
