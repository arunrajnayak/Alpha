/**
 * Backfill screener prices script.
 * Fetches 12+ months of daily candles for all NSE_EQ stocks and populates ScreenerPrice.
 *
 * Usage: npx tsx scripts/seed-screener-prices.ts
 * Estimated time: ~8 minutes for ~2000 stocks (5 concurrent)
 */

import { gunzipSync } from 'zlib';
import { prisma, chunkArray } from './lib/db';

const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const UPSTOX_HISTORICAL_URL = 'https://api.upstox.com/v3/historical-candle';

interface Instrument {
  instrument_key: string;
  tradingsymbol: string;
  trading_symbol?: string;
  name: string;
  instrument_type: string;
}

async function loadInstruments(): Promise<Array<{ symbol: string; key: string }>> {
  console.log('Downloading NSE instrument master...');
  const res = await fetch(NSE_INSTRUMENTS_URL);
  const buf = Buffer.from(await res.arrayBuffer());
  const json = gunzipSync(buf).toString('utf8');
  const data: Instrument[] = JSON.parse(json);

  const etfWhitelist = new Set(['GOLDBEES', 'SILVERBEES']);
  const result: Array<{ symbol: string; key: string }> = [];

  for (const inst of data) {
    const symbol = (inst.tradingsymbol || inst.trading_symbol || '').toUpperCase();
    const type = (inst.instrument_type || '').toUpperCase();

    if (type === 'EQ' || type === 'EQUITY' || etfWhitelist.has(symbol)) {
      result.push({ symbol, key: inst.instrument_key });
    }
  }

  return result;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function fetchDailyCandles(instrumentKey: string, from: string, to: string) {
  const encodedKey = encodeURIComponent(instrumentKey);
  const url = `${UPSTOX_HISTORICAL_URL}/${encodedKey}/days/1/${to}/${from}`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const json = await res.json();
  const candles = json?.data?.candles;
  if (!Array.isArray(candles)) return [];

  return candles.map((c: [string, number, number, number, number, number, number]) => ({
    timestamp: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: Math.round(c[5]),
  })).filter((c) => {
    // Skip weekend dates — Upstox timestamps are IST (e.g. "2026-03-02T00:00:00+05:30")
    // Extract YYYY-MM-DD directly from the IST timestamp to avoid UTC date shift
    const dateStr = c.timestamp.slice(0, 10);
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return dow !== 0 && dow !== 6; // 0=Sunday, 6=Saturday
  });
}

async function withConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number,
): Promise<{ successes: number; errors: string[] }> {
  const errors: string[] = [];
  let successes = 0;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        await fn(items[i]);
        successes++;
      } catch (err) {
        errors.push(`${items[i]}: ${(err as Error).message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return { successes, errors };
}

async function main() {
  const instruments = await loadInstruments();
  console.log(`Found ${instruments.length} NSE_EQ instruments`);

  const today = toDateStr(new Date());
  const fromDate = toDateStr(new Date(Date.now() - 550 * 24 * 60 * 60 * 1000)); // ~18 months — need 274+ trading days for scoring
  console.log(`Fetching daily candles from ${fromDate} to ${today}`);

  let processed = 0;
  let totalInserted = 0;

  const result = await withConcurrency(
    instruments,
    async (inst) => {
      const candles = await fetchDailyCandles(inst.key, fromDate, today);
      if (candles.length === 0) return;

      const rows = candles.map((c: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }) => ({
        symbol: inst.symbol,
        instrumentKey: inst.key,
        date: c.timestamp.slice(0, 10), // Extract YYYY-MM-DD directly from IST timestamp to avoid UTC shift
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Check existing dates to avoid unique constraint violations
      const existingDates = new Set(
        (await prisma.screenerPrice.findMany({
          where: { symbol: inst.symbol },
          select: { date: true },
        })).map(r => r.date)
      );

      const newRows = rows.filter((r: { date: string }) => !existingDates.has(r.date));
      if (newRows.length === 0) return;

      for (const chunk of chunkArray(newRows, 100)) {
        await prisma.screenerPrice.createMany({ data: chunk });
      }
      totalInserted += newRows.length;

      processed++;
      if (processed % 100 === 0) {
        console.log(`  Progress: ${processed}/${instruments.length} (${totalInserted} rows inserted)`);
      }
    },
    5,
  );

  console.log(`\nDone! Fetched: ${result.successes} stocks, Inserted: ${totalInserted} rows, Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.log('First 10 errors:');
    result.errors.slice(0, 10).forEach(e => console.log(`  ${e}`));
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
