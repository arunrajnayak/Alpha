/**
 * backfill-rank-history.ts
 * ========================
 * Prefills RankingHistory for the past 50 trading days for:
 *   - rankType: 'filtered'  (pre-filtered tab)
 *   - rankType: 'all'       (all-universe tab)
 *
 * Portfolio tab reads from 'filtered' rankings — covered automatically.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-rank-history.ts
 *
 * Safe to re-run — deletes existing history before inserting.
 * Uses current market cap data as proxy for historical mcap (good enough for ranking).
 * ATH is computed from historical highs slice (accurate per-date).
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envLocalPath = path.resolve(__dirname, '../../.env.local');
const envPath      = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Mock Next.js server internals so we can import db/scoring outside Next.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Module  = require('module');
const _orig   = Module._load;
 
Module._load = function(req: string, parent: any, isMain: boolean) {
  if (req === 'server-only') return {};
  if (req === 'next/cache')  return { unstable_cache: (fn: any) => fn, revalidateTag: () => {}, revalidatePath: () => {} };
  if (req === 'next/server') return {};
  return _orig(req, parent, isMain);
};

const DAYS_TO_BACKFILL = 50;

async function main() {
  // Dynamic imports — MUST come after Module._load mock above
  const { prisma, chunkArray }                         = await import('../lib/db');
  const { scoreStock, PARAMS, isETFWhitelisted }        = await import('../lib/screener/scoring');

  const t0 = Date.now();
  console.log(`\n=== Rank History Backfill ===`);
  console.log(`Params: sharpeWeight=${PARAMS.sharpeWeight}, skipMonths=${PARAMS.skipMonths}`);

  // ── 1. Load all price data once ────────────────────────────────────────────
  console.log('\n[1/4] Loading price data...');
  const allPrices = await prisma.screenerPrice.findMany({
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, date: true, close: true, high: true, volume: true },
  });
  console.log(`  Loaded ${allPrices.length.toLocaleString()} price rows`);

  // Group by symbol — arrays already sorted oldest-first (from orderBy date asc)
  const pricesBySymbol = new Map<string, Array<{ date: string; close: number; high: number; volume: number }>>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ date: p.date, close: p.close, high: p.high, volume: p.volume });
  }
  console.log(`  ${pricesBySymbol.size} symbols in price DB`);

  // ── 2. Determine 50 most recent trading dates ──────────────────────────────
  console.log('\n[2/4] Identifying trading dates...');
  const allDates = [...new Set(allPrices.map(p => p.date))].sort(); // ascending
  const tradingDates = allDates.slice(-DAYS_TO_BACKFILL);           // last 50
  console.log(`  Date range: ${tradingDates[0]} → ${tradingDates[tradingDates.length - 1]} (${tradingDates.length} days)`);

  // ── 3. Load current market caps ────────────────────────────────────────────
  console.log('\n[3/4] Loading market caps...');
  const mcapRows = await prisma.stockMarketCap.findMany({
    select: { symbol: true, marketCap: true },
  });
  const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  console.log(`  ${mcapMap.size} symbols with mcap data`);

  // ── 4. For each historical date, score → rank → insert ────────────────────
  console.log('\n[4/4] Scoring and inserting history...\n');

  let totalInserted = 0;

  for (let di = 0; di < tradingDates.length; di++) {
    const date = tradingDates[di];
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`  [${di + 1}/${tradingDates.length}] ${date}  (${elapsed}s elapsed)  `);

    const filteredScored: Array<{ symbol: string; compositeScore: number }> = [];
    const allScored:      Array<{ symbol: string; compositeScore: number }> = [];

    for (const [symbol, candles] of pricesBySymbol) {
      const mcap = mcapMap.get(symbol);
      const isEtf = isETFWhitelisted(symbol);

      // Universe gate: mcap >= 1000 Cr or whitelisted ETF
      if ((!mcap || mcap < PARAMS.mcapMinCr) && !isEtf) continue;

      // Slice to data available on this date (inclusive)
      const slice = candles.filter(c => c.date <= date);

      // Need at least dateIdx(247) + 1 = 248 candles (~12 months)
      if (slice.length < 248) continue;

      const closes  = slice.map(c => c.close);
      const highs   = slice.map(c => c.high);
      const volumes = slice.map(c => c.volume);

      // All-universe (no entry filters, ATH computed from historical slice)
      const allResult = scoreStock(closes, highs, volumes, symbol, undefined, { skipFilters: true });
      if (allResult) {
        allScored.push({ symbol, compositeScore: allResult.compositeScore });
      }

      // Pre-filtered (applies 200 DMA, ATH proximity, volume, price filters)
      if (mcap && mcap >= PARAMS.mcapMinCr) {
        const filtResult = scoreStock(closes, highs, volumes, symbol, undefined);
        if (filtResult) {
          filteredScored.push({ symbol, compositeScore: filtResult.compositeScore });
        }
      }
    }

    // Sort by composite score descending → assign ranks
    filteredScored.sort((a, b) => b.compositeScore - a.compositeScore);
    allScored.sort((a, b)      => b.compositeScore - a.compositeScore);

    // Delete any existing records for this date (idempotent)
    await prisma.rankingHistory.deleteMany({ where: { date } });

    // Build insert rows
    const rows = [
      ...filteredScored.map((s, idx) => ({
        symbol: s.symbol,
        date,
        rank: idx + 1,
        compositeScore: s.compositeScore,
        rankType: 'filtered',
      })),
      ...allScored.map((s, idx) => ({
        symbol: s.symbol,
        date,
        rank: idx + 1,
        compositeScore: s.compositeScore,
        rankType: 'all',
      })),
    ];

    for (const chunk of chunkArray(rows, 100)) {
      await prisma.rankingHistory.createMany({ data: chunk });
    }

    totalInserted += rows.length;
    console.log(`filtered=${filteredScored.length}, all=${allScored.length}`);
  }

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${totalSec}s — inserted ${totalInserted.toLocaleString()} history rows`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
