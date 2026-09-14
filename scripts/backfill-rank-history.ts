/**
 * Backfill RankingHistory for the last 50 trading days — both rankTypes.
 *
 * Part 1 — filtered (MomentumScore): Copy directly from MomentumScore historical data.
 * Part 2 — filtered (ScreenerPrice):  Re-score historical dates not covered by Part 1,
 *                                     using the current filtered symbol universe.
 * Part 3 — all:                       Re-score each date using ScreenerPrice slices.
 *
 * Prices are loaded once into memory; binary search slices per date.
 *
 * Usage:
 *   npx tsx scripts/backfill-rank-history.ts
 *   npx tsx scripts/backfill-rank-history.ts --dry-run   # log counts only, no writes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { prisma, chunkArray } from './lib/db';
import { scoreStock, PARAMS, isETFWhitelisted } from '../src/lib/screener/scoring';

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be made\n');

// ── Types ─────────────────────────────────────────────────────────────────────

type PriceRow = { date: string; close: number; high: number; volume: number };

// ── Binary search helpers ─────────────────────────────────────────────────────

/** Returns the last index where arr[i] <= target, or -1 if none. */
function upperBoundDate(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}

// ── Load prices into memory (shared by Parts 2 & 3) ──────────────────────────

async function loadPrices(mcapMap: Map<string, number>) {
  console.log('  Loading all prices into memory...');
  const rawPrices = await prisma.screenerPrice.findMany({
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, date: true, close: true, high: true, volume: true },
  });

  const pricesBySymbol = new Map<string, PriceRow[]>();
  const datesBySymbol  = new Map<string, string[]>();

  for (const p of rawPrices) {
    let arr   = pricesBySymbol.get(p.symbol);
    let dates = datesBySymbol.get(p.symbol);
    if (!arr) {
      arr = []; dates = [];
      pricesBySymbol.set(p.symbol, arr);
      datesBySymbol.set(p.symbol, dates!);
    }
    arr.push({ date: p.date, close: p.close, high: p.high, volume: p.volume });
    dates!.push(p.date);
  }
  console.log(`  Loaded ${rawPrices.length} price rows for ${pricesBySymbol.size} symbols\n`);
  return { pricesBySymbol, datesBySymbol };
}

// ── Score a set of symbols on a target date ───────────────────────────────────

function scoreSymbols(
  symbols: Iterable<string>,
  targetDate: string,
  pricesBySymbol: Map<string, PriceRow[]>,
  datesBySymbol: Map<string, string[]>,
) {
  const scored: Array<{ symbol: string; compositeScore: number }> = [];
  let skippedHistory = 0, skippedScore = 0;

  for (const symbol of symbols) {
    const prices = pricesBySymbol.get(symbol);
    if (!prices) { skippedHistory++; continue; }

    const dates  = datesBySymbol.get(symbol)!;
    const lastIdx = upperBoundDate(dates, targetDate);
    if (lastIdx < 247) { skippedHistory++; continue; }

    const slice   = prices.slice(0, lastIdx + 1);
    const closes  = slice.map(p => p.close);
    const highs   = slice.map(p => p.high);
    const volumes = slice.map(p => p.volume);

    let ath = 0;
    for (const h of highs) if (h > ath) ath = h;

    const result = scoreStock(closes, highs, volumes, symbol, ath, { skipFilters: true });
    if (!result) { skippedScore++; continue; }

    scored.push({ symbol, compositeScore: result.compositeScore });
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  return { scored, skippedHistory, skippedScore };
}

// ── Part 1: Backfill filtered from MomentumScore ──────────────────────────────

async function backfillFiltered() {
  console.log('━━━ Part 1: filtered RankingHistory from MomentumScore ━━━');

  const existingRows = await prisma.rankingHistory.findMany({
    where: { rankType: 'filtered' },
    select: { date: true },
    distinct: ['date'],
  });
  const existingDates = new Set(existingRows.map(r => r.date));
  console.log(`  Existing filtered dates in RankingHistory: ${existingDates.size}`);

  const allScores = await prisma.momentumScore.findMany({
    where: { rankType: 'filtered' },
    select: { symbol: true, computedDate: true, rank: true, compositeScore: true },
    orderBy: { computedDate: 'asc' },
  });

  const byDate = new Map<string, typeof allScores>();
  for (const s of allScores) {
    let arr = byDate.get(s.computedDate);
    if (!arr) { arr = []; byDate.set(s.computedDate, arr); }
    arr.push(s);
  }

  const sortedDates = [...byDate.keys()].sort().slice(-50);
  console.log(`  MomentumScore filtered dates available: ${byDate.size} (backfilling last ${sortedDates.length})\n`);

  let inserted = 0, skipped = 0;

  for (const date of sortedDates) {
    if (existingDates.has(date)) {
      console.log(`  ↷  filtered ${date} — already exists`);
      skipped++;
      continue;
    }
    const rows = byDate.get(date)!.map(s => ({
      symbol: s.symbol,
      date: s.computedDate,
      rank: s.rank,
      compositeScore: s.compositeScore,
      rankType: 'filtered' as const,
    }));
    if (!DRY_RUN) {
      for (const chunk of chunkArray(rows, 50)) {
        await prisma.rankingHistory.createMany({ data: chunk });
      }
    }
    inserted += rows.length;
    console.log(`  ✓  filtered ${date} — ${rows.length} rows${DRY_RUN ? ' (dry)' : ''}`);
  }

  console.log(`\n  Done: ${inserted} rows inserted, ${skipped} dates skipped\n`);
  return { inserted, coveredDates: new Set([...existingDates, ...sortedDates]) };
}

// ── Part 2: Backfill filtered from ScreenerPrice (historical re-scoring) ──────

async function backfillFilteredFromPrices(
  pricesBySymbol: Map<string, PriceRow[]>,
  datesBySymbol: Map<string, string[]>,
) {
  console.log('━━━ Part 2: filtered RankingHistory from ScreenerPrice (CPU re-scoring) ━━━');

  // Current filtered universe
  const filteredSymbolRows = await prisma.momentumScore.findMany({
    where: { isActive: true, rankType: 'filtered' },
    select: { symbol: true },
  });
  const filteredSymbols = new Set(filteredSymbolRows.map(r => r.symbol));
  console.log(`  Filtered universe: ${filteredSymbols.size} symbols`);

  // Find existing filtered dates
  const existingRows = await prisma.rankingHistory.findMany({
    where: { rankType: 'filtered' },
    select: { date: true },
    distinct: ['date'],
  });
  const existingDates = new Set(existingRows.map(r => r.date));
  console.log(`  Existing filtered dates in RankingHistory: ${existingDates.size}`);

  // Get last 50 dates from ScreenerPrice
  const priceDateRows = await prisma.screenerPrice.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: 50,
  });
  const datesToProcess  = priceDateRows.map(r => r.date).reverse();
  const datesToBackfill = datesToProcess.filter(d => !existingDates.has(d));
  console.log(`  Dates to backfill: ${datesToBackfill.length}\n`);

  if (datesToBackfill.length === 0) {
    console.log('  Nothing to do — all filtered dates already exist\n');
    return 0;
  }

  let totalInserted = 0;

  for (const targetDate of datesToBackfill) {
    const { scored, skippedHistory, skippedScore } = scoreSymbols(
      filteredSymbols, targetDate, pricesBySymbol, datesBySymbol,
    );

    const rows = scored.map((s, idx) => ({
      symbol: s.symbol,
      date: targetDate,
      rank: idx + 1,
      compositeScore: s.compositeScore,
      rankType: 'filtered' as const,
    }));

    if (!DRY_RUN && rows.length > 0) {
      await prisma.rankingHistory.deleteMany({ where: { date: targetDate, rankType: 'filtered' } });
      for (const chunk of chunkArray(rows, 50)) {
        await prisma.rankingHistory.createMany({ data: chunk });
      }
    }

    totalInserted += rows.length;
    console.log(
      `  ✓  filtered ${targetDate} — ${rows.length} stocks ranked` +
      ` (skipped: ${skippedHistory} history, ${skippedScore} score)` +
      (DRY_RUN ? ' (dry)' : '')
    );
  }

  console.log(`\n  Done: ${totalInserted} rows inserted across ${datesToBackfill.length} dates\n`);
  return totalInserted;
}

// ── Part 3: Backfill all from ScreenerPrice ────────────────────────────────────

async function backfillAll(
  pricesBySymbol: Map<string, PriceRow[]>,
  datesBySymbol: Map<string, string[]>,
  mcapMap: Map<string, number>,
) {
  console.log('━━━ Part 3: all RankingHistory from ScreenerPrice (CPU re-scoring) ━━━');

  const existingRows = await prisma.rankingHistory.findMany({
    where: { rankType: 'all' },
    select: { date: true },
    distinct: ['date'],
  });
  const existingDates = new Set(existingRows.map(r => r.date));
  console.log(`  Existing all dates in RankingHistory: ${existingDates.size}`);

  const priceDateRows = await prisma.screenerPrice.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: 50,
  });
  const datesToProcess  = priceDateRows.map(r => r.date).reverse();
  const datesToBackfill = datesToProcess.filter(d => !existingDates.has(d));
  console.log(`  ScreenerPrice dates available: ${priceDateRows.length}`);
  console.log(`  Dates to backfill: ${datesToBackfill.length}\n`);

  if (datesToBackfill.length === 0) {
    console.log('  Nothing to do — all dates already exist\n');
    return 0;
  }

  let totalInserted = 0;

  for (const targetDate of datesToBackfill) {
    // Build eligible symbol set: mcap filter + ETF whitelist
    const eligibleSymbols: string[] = [];
    let skippedMcap = 0;
    for (const [symbol] of pricesBySymbol) {
      const mcap = mcapMap.get(symbol);
      if ((!mcap || mcap < PARAMS.mcapMinCr) && !isETFWhitelisted(symbol)) {
        skippedMcap++;
      } else {
        eligibleSymbols.push(symbol);
      }
    }

    const { scored, skippedHistory, skippedScore } = scoreSymbols(
      eligibleSymbols, targetDate, pricesBySymbol, datesBySymbol,
    );

    const rows = scored.map((s, idx) => ({
      symbol: s.symbol,
      date: targetDate,
      rank: idx + 1,
      compositeScore: s.compositeScore,
      rankType: 'all' as const,
    }));

    if (!DRY_RUN && rows.length > 0) {
      await prisma.rankingHistory.deleteMany({ where: { date: targetDate, rankType: 'all' } });
      for (const chunk of chunkArray(rows, 50)) {
        await prisma.rankingHistory.createMany({ data: chunk });
      }
    }

    totalInserted += rows.length;
    console.log(
      `  ✓  all ${targetDate} — ${rows.length} stocks ranked` +
      ` (skipped: ${skippedMcap} mcap, ${skippedHistory} history, ${skippedScore} score)` +
      (DRY_RUN ? ' (dry)' : '')
    );
  }

  console.log(`\n  Done: ${totalInserted} rows inserted across ${datesToBackfill.length} dates\n`);
  return totalInserted;
}

// ── Prune to 50 days ──────────────────────────────────────────────────────────

async function pruneHistory() {
  if (DRY_RUN) return;
  console.log('━━━ Pruning to 50 days ━━━');
  for (const rt of ['filtered', 'all'] as const) {
    const distinct = await prisma.rankingHistory.findMany({
      where: { rankType: rt },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'desc' },
    });
    if (distinct.length > 50) {
      const cutoff = distinct[49].date;
      const { count } = await prisma.rankingHistory.deleteMany({
        where: { date: { lt: cutoff }, rankType: rt },
      });
      console.log(`  ✓  ${rt}: deleted ${count} rows older than ${cutoff}`);
    } else {
      console.log(`  ✓  ${rt}: ${distinct.length} dates — no pruning needed`);
    }
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log(`\n🚀 Backfilling RankingHistory (50 days, both rankTypes)\n`);

  // Part 1: filtered from MomentumScore snapshots (recent dates)
  await backfillFiltered();

  // Load mcap + prices once — shared by Parts 2 & 3
  const mcapRows = await prisma.stockMarketCap.findMany({
    select: { symbol: true, marketCap: true },
  });
  const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  console.log(`  Loaded market caps for ${mcapMap.size} symbols`);

  const { pricesBySymbol, datesBySymbol } = await loadPrices(mcapMap);

  // Part 2: filtered from ScreenerPrice (historical dates)
  const filteredInserted = await backfillFilteredFromPrices(pricesBySymbol, datesBySymbol);

  // Part 3: all from ScreenerPrice
  const allInserted = await backfillAll(pricesBySymbol, datesBySymbol, mcapMap);

  await pruneHistory();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Complete in ${elapsed}s — filtered: ${filteredInserted} rows, all: ${allInserted} rows`);
}

main().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
