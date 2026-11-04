/**
 * backfill-rank-history.ts
 * ========================
 * Prefills RankingHistory for the past 50 trading days for:
 *   - rankType: 'filtered'  (All Ranked list, with new rules: mcap >= 1500 Cr,
 *                           BE & 5% circuit limit excluded unless in portfolio)
 *   - rankType: 'all'       (all-universe ranking)
 *
 * Also recalculates denormalized stats (avgRank50d, bestRank, appearances, t50Pct,
 * t100Pct, prevRank) on active MomentumScore records.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node_modules/.bin/tsx src/scripts/backfill-rank-history.ts
 *
 * Safe to re-run — deletes existing history for the target dates before inserting.
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

function findLastIndex(dates: string[], targetDate: string): number {
  let low = 0, high = dates.length - 1, ans = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (dates[mid] <= targetDate) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

interface SymbolData {
  symbol: string;
  dates: string[];
  closes: number[];
  highs: number[];
  volumes: number[];
}

async function main() {
  const { prisma, chunkArray } = await import('../lib/db');
  const { scoreStock, PARAMS, isETFWhitelisted } = await import('../lib/screener/scoring');
  const { getBESymbols } = await import('../lib/instrument-service');

  const t0 = Date.now();
  console.log(`\n=== Rank History Backfill (50 Trading Days) ===`);
  console.log(`Rules: Mcap >= ₹${PARAMS.mcapMinCr.toLocaleString()} Cr | BE & 5% Circuit excluded unless in portfolio`);
  console.log(`Scoring: sharpeWeight=${PARAMS.sharpeWeight}, skipMonths=${PARAMS.skipMonths}`);

  // ── 1. Load active portfolio holdings ─────────────────────────────────────
  console.log('\n[1/6] Loading portfolio holdings...');
  const txns = await prisma.transaction.findMany({ select: { symbol: true, type: true, quantity: true } });
  const qtyMap = new Map<string, number>();
  for (const t of txns) {
    const q = qtyMap.get(t.symbol) ?? 0;
    qtyMap.set(t.symbol, t.type === 'BUY' ? q + t.quantity : q - t.quantity);
  }
  const portfolioSymbols = new Set([...qtyMap.entries()].filter(([, q]) => q > 0.01).map(([s]) => s));
  console.log(`  ${portfolioSymbols.size} active portfolio holdings found`);

  // ── 2. Load BE symbols, circuit bands & stored ATH ─────────────────────────
  console.log('\n[2/6] Loading BE symbols, circuit bands & ATH...');
  const [beSymbols, circuitScores, athRows] = await Promise.all([
    getBESymbols(),
    prisma.momentumScore.findMany({
      where: { circuitBandPct: { not: null } },
      select: { symbol: true, circuitBandPct: true },
      distinct: ['symbol'],
      orderBy: { computedDate: 'desc' },
    }),
    prisma.stockATH.findMany({ select: { symbol: true, ath: true } }),
  ]);
  const circuitMap = new Map<string, number>();
  for (const s of circuitScores) {
    if (s.circuitBandPct !== null) circuitMap.set(s.symbol, s.circuitBandPct);
  }
  const athMap = new Map(athRows.map(r => [r.symbol, r.ath]));
  console.log(`  ${beSymbols.size} BE symbols | ${circuitMap.size} circuit bands | ${athMap.size} ATH entries`);

  // ── 3. Load all price data once into column arrays ─────────────────────────
  console.log('\n[3/6] Loading price data...');
  const allPrices = await prisma.screenerPrice.findMany({
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, date: true, close: true, high: true, volume: true },
  });
  console.log(`  Loaded ${allPrices.length.toLocaleString()} price rows`);

  const symbolMap = new Map<string, SymbolData>();
  for (const p of allPrices) {
    let d = symbolMap.get(p.symbol);
    if (!d) {
      d = { symbol: p.symbol, dates: [], closes: [], highs: [], volumes: [] };
      symbolMap.set(p.symbol, d);
    }
    d.dates.push(p.date);
    d.closes.push(p.close);
    d.highs.push(p.high);
    d.volumes.push(p.volume);
  }
  console.log(`  ${symbolMap.size} symbols organized`);

  // ── 4. Determine 50 most recent trading dates ─────────────────────────────
  console.log('\n[4/6] Identifying trading dates...');
  const allDates = [...new Set(allPrices.map(p => p.date))].sort();
  const tradingDates = allDates.slice(-DAYS_TO_BACKFILL);
  console.log(`  Date range: ${tradingDates[0]} → ${tradingDates[tradingDates.length - 1]} (${tradingDates.length} trading days)`);

  // ── 5. Load current market caps ───────────────────────────────────────────
  console.log('\n[5/6] Loading market caps...');
  const mcapRows = await prisma.stockMarketCap.findMany({
    select: { symbol: true, marketCap: true },
  });
  const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  console.log(`  ${mcapMap.size} symbols with mcap data`);

  // ── 6. For each historical date, score → rank → insert ───────────────────
  console.log('\n[6/6] Scoring and backfilling ranking history...\n');

  let totalInserted = 0;

  for (let di = 0; di < tradingDates.length; di++) {
    const date = tradingDates[di];
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`  [${di + 1}/${tradingDates.length}] ${date} (${elapsed}s) `);

    const filteredScored: Array<{ symbol: string; compositeScore: number }> = [];
    const allScored:      Array<{ symbol: string; compositeScore: number }> = [];

    for (const [symbol, data] of symbolMap) {
      const mcap = mcapMap.get(symbol);
      const isEtf = isETFWhitelisted(symbol);
      const inPortfolio = portfolioSymbols.has(symbol);

      // Fast mcap gate: must have mcap >= 1500 Cr, ETF, or in portfolio
      const passesMcap = (mcap !== undefined && mcap >= PARAMS.mcapMinCr) || isEtf || inPortfolio;
      if (!passesMcap) continue;

      // Fast binary search for date boundary
      const lastIdx = findLastIndex(data.dates, date);
      if (lastIdx < 247) continue; // Need at least 248 candles

      // Fast native slice
      const sliceCloses = data.closes.slice(0, lastIdx + 1);
      const sliceHighs = data.highs.slice(0, lastIdx + 1);
      const sliceVolumes = data.volumes.slice(0, lastIdx + 1);
      const storedAth = athMap.get(symbol);

      // All-universe scoring (skipFilters: true)
      const passesMcapAll = (mcap !== undefined && mcap >= PARAMS.mcapMinCr) || isEtf;
      if (passesMcapAll) {
        const allResult = scoreStock(sliceCloses, sliceHighs, sliceVolumes, symbol, storedAth, { skipFilters: true });
        if (allResult) {
          allScored.push({ symbol, compositeScore: allResult.compositeScore });
        }
      }

      // Filtered (All Ranked) scoring:
      // Exclude BE and narrow circuit (< 15%) UNLESS held in portfolio
      const isBE = beSymbols.has(symbol) || symbol.endsWith('-BE');
      const bandPct = circuitMap.get(symbol);
      const isNarrowCircuit = bandPct !== undefined && bandPct < 15;

      const passesBE = !isBE || inPortfolio;
      const passesCircuit = !isNarrowCircuit || inPortfolio;
      if (!passesBE || !passesCircuit) continue;

      // Score with entry filters (200 DMA, min price, ATH proximity, volume)
      const filtResult = scoreStock(sliceCloses, sliceHighs, sliceVolumes, symbol, storedAth);
      if (filtResult) {
        filteredScored.push({ symbol, compositeScore: filtResult.compositeScore });
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

    for (const chunk of chunkArray(rows, 200)) {
      await prisma.rankingHistory.createMany({ data: chunk });
    }

    totalInserted += rows.length;
    console.log(`→ filtered=${filteredScored.length}, all=${allScored.length}`);
  }

  // Prune any dates older than the 50 most recent trading dates
  const cutoffDate = tradingDates[0];
  const pruned = await prisma.rankingHistory.deleteMany({
    where: { date: { lt: cutoffDate } },
  });
  if (pruned.count > 0) {
    console.log(`\n  Pruned ${pruned.count} records older than ${cutoffDate}`);
  }

  // ── 7. Update denormalized stats on active MomentumScore ──────────────────
  console.log('\n[7/7] Updating denormalized 50-day stats on active MomentumScore...');
  const prevDate = tradingDates[tradingDates.length - 2];
  const [allFilteredHistory, prevDayRanks, activeScores] = await Promise.all([
    prisma.rankingHistory.findMany({
      where: { rankType: 'filtered' },
      select: { symbol: true, rank: true },
    }),
    prevDate ? prisma.rankingHistory.findMany({
      where: { rankType: 'filtered', date: prevDate },
      select: { symbol: true, rank: true },
    }) : Promise.resolve([]),
    prisma.momentumScore.findMany({
      where: { isActive: true, rankType: 'filtered' },
      select: { id: true, symbol: true, rank: true },
    }),
  ]);

  const histMap = new Map<string, number[]>();
  for (const r of allFilteredHistory) {
    let arr = histMap.get(r.symbol);
    if (!arr) { arr = []; histMap.set(r.symbol, arr); }
    arr.push(r.rank);
  }
  const prevRankMap = new Map(prevDayRanks.map(r => [r.symbol, r.rank]));

  console.log(`  Updating ${activeScores.length} active scores...`);
  const updateChunks = chunkArray(activeScores, 25);
  for (const chunk of updateChunks) {
    await Promise.all(
      chunk.map(s => {
        const history = histMap.get(s.symbol) || [s.rank];
        const avgRank50d = history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : null;
        const bestRank = history.length > 0 ? Math.min(...history) : null;
        const appearances = history.length;
        const t50Pct = history.length > 0 ? (history.filter(r => r <= 50).length / history.length) * 100 : 0;
        const t100Pct = history.length > 0 ? (history.filter(r => r <= 100).length / history.length) * 100 : 0;
        const prevRank = prevRankMap.get(s.symbol) ?? null;

        return prisma.momentumScore.update({
          where: { id: s.id },
          data: { avgRank50d, bestRank, appearances, t50Pct, t100Pct, prevRank },
        });
      })
    );
  }
  console.log('  Updated active scores with consistent 50-day statistics.');

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${totalSec}s — inserted ${totalInserted.toLocaleString()} history rows across ${tradingDates.length} days`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
