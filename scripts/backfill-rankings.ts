/**
 * Backfill RankingHistory for the last 50 trading days.
 *
 * For each historical trading day, scores all stocks using the price data
 * available up to that date, ranks them, and inserts RankingHistory records.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/backfill-rankings.ts
 */

import { prisma, chunkArray } from './lib/db';
import { scoreStock, PARAMS } from '../src/lib/screener/scoring';

async function main() {
  console.log('=== Backfill RankingHistory ===\n');

  // Step 1: Get distinct trading dates from ScreenerPrice (last 50)
  console.log('Loading distinct trading dates...');
  const allDates = await prisma.screenerPrice.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: 50,
  });
  const dates = allDates.map(d => d.date).reverse(); // oldest first
  console.log(`  Found ${dates.length} trading dates (${dates[0]} to ${dates[dates.length - 1]})`);

  // Step 2: Check which dates already have RankingHistory
  const existingDates = new Set(
    (await prisma.rankingHistory.findMany({
      select: { date: true },
      distinct: ['date'],
    })).map(d => d.date)
  );
  const datesToBackfill = dates.filter(d => !existingDates.has(d));
  console.log(`  ${existingDates.size} dates already have history, ${datesToBackfill.length} to backfill\n`);

  if (datesToBackfill.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // Step 3: Load all prices and market cap data
  console.log('Loading prices...');
  const allPrices = await prisma.screenerPrice.findMany({
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, date: true, close: true, high: true, volume: true },
  });
  console.log(`  ${allPrices.length} price rows loaded`);

  // Group by symbol with dates for slicing
  type PriceRow = { date: string; close: number; high: number; volume: number };
  const pricesBySymbol = new Map<string, PriceRow[]>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ date: p.date, close: p.close, high: p.high, volume: p.volume });
  }

  // Load market cap for filtering
  const mcapMap = new Map<string, number>();
  const allMcap = await prisma.stockMarketCap.findMany({ select: { symbol: true, marketCap: true } });
  for (const row of allMcap) mcapMap.set(row.symbol, row.marketCap);

  // Load ATH
  const athMap = new Map<string, number>();
  const allAth = await prisma.stockATH.findMany({ select: { symbol: true, ath: true } });
  for (const row of allAth) athMap.set(row.symbol, row.ath);

  console.log(`  ${pricesBySymbol.size} symbols, ${mcapMap.size} with mcap, ${athMap.size} with ATH\n`);

  // Step 4: For each date, score and rank
  let totalInserted = 0;
  for (let di = 0; di < datesToBackfill.length; di++) {
    const targetDate = datesToBackfill[di];
    let scored: Array<{ symbol: string; compositeScore: number }> = [];

    for (const [symbol, prices] of pricesBySymbol) {
      // Slice prices up to targetDate
      const endIdx = prices.findIndex(p => p.date > targetDate);
      const candles = endIdx === -1 ? prices : prices.slice(0, endIdx);

      if (candles.length < 248) continue;

      const mcap = mcapMap.get(symbol);
      if (!mcap || mcap < PARAMS.mcapMinCr) continue;

      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const volumes = candles.map(c => c.volume);

      const storedATH = athMap.get(symbol);
      const result = scoreStock(closes, highs, volumes, symbol, storedATH);
      if (!result) continue;

      scored.push({ symbol, compositeScore: result.compositeScore });
    }

    // Rank by composite score
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Insert RankingHistory
    const rows = scored.map((s, idx) => ({
      symbol: s.symbol,
      date: targetDate,
      rank: idx + 1,
      compositeScore: s.compositeScore,
    }));

    for (const chunk of chunkArray(rows, 50)) {
      await prisma.rankingHistory.createMany({ data: chunk });
    }

    totalInserted += rows.length;
    console.log(`  [${di + 1}/${datesToBackfill.length}] ${targetDate}: ${scored.length} stocks ranked (${totalInserted} total)`);
  }

  console.log(`\n✅ Backfill complete — ${totalInserted} RankingHistory records inserted across ${datesToBackfill.length} dates`);
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
