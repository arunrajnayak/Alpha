/**
 * rescore.ts
 * ==========
 * Runs only the scoring + ranking step of the pipeline
 * (no candle fetch, no bhavcopy, no ATH update).
 * Use to refresh MomentumScore after a formula change.
 *
 * Usage:
 *   node_modules/.bin/tsx src/scripts/rescore.ts
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

async function main() {
  const { prisma, chunkArray }                = await import('../lib/db');
  const { scoreStock, PARAMS, isETFWhitelisted } = await import('../lib/screener/scoring');
  const { effectiveTradingDay }               = await import('../lib/screener/dates');

  const today = effectiveTradingDay();
  const t0    = Date.now();

  console.log(`\n=== Rescore (S${PARAMS.sharpeWeight * 10} skip=${PARAMS.skipMonths > 0 ? 'Y' : 'N'}) — ${today} ===\n`);

  // ── Load data ────────────────────────────────────────────────────────────────
  console.log('[1/5] Loading prices...');
  const allPrices = await prisma.screenerPrice.findMany({
    where: { date: { lte: today } },
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, close: true, high: true, volume: true },
  });
  const pricesBySymbol = new Map<string, { close: number; high: number; volume: number }[]>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ close: p.close, high: p.high, volume: p.volume });
  }
  console.log(`  ${allPrices.length.toLocaleString()} rows, ${pricesBySymbol.size} symbols`);

  console.log('[2/5] Loading mcap, ATH, metadata, previous ranks...');
  const [mcapRows, athRows, prevFilteredRows, prevAllRows] = await Promise.all([
    prisma.stockMarketCap.findMany({ select: { symbol: true, marketCap: true } }),
    prisma.stockATH.findMany({ select: { symbol: true, ath: true } }),
    prisma.momentumScore.findMany({ where: { isActive: true, rankType: 'filtered' },
      select: { symbol: true, rank: true, instrumentKey: true, companyName: true,
                sparklineData: true, circuitBandPct: true, marketCapCategory: true } }),
    prisma.momentumScore.findMany({ where: { isActive: true, rankType: 'all' },
      select: { symbol: true, rank: true, instrumentKey: true, companyName: true,
                sparklineData: true, circuitBandPct: true, marketCapCategory: true } }),
  ]);
  const mcapMap      = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  const athMap       = new Map(athRows.map(r => [r.symbol, r.ath]));
  const prevFiltered = new Map(prevFilteredRows.map(r => [r.symbol, r.rank]));
  const prevAll      = new Map(prevAllRows.map(r => [r.symbol, r.rank]));
  // Preserve static fields from existing records
  type Meta = { instrumentKey: string; companyName: string; sparklineData: string | null; circuitBandPct: number | null; marketCapCategory: string | null };
  const metaFiltered = new Map<string, Meta>(prevFilteredRows.map(r => [r.symbol, r]));
  const metaAll      = new Map<string, Meta>(prevAllRows.map(r => [r.symbol, r]));
  console.log(`  ${mcapMap.size} mcap, ${athMap.size} ATH entries`);

  // ── Load history for denormalized stats ──────────────────────────────────────
  console.log('[3/5] Loading ranking history for stats...');
  const [filteredHistRows, allHistRows] = await Promise.all([
    prisma.rankingHistory.findMany({ where: { rankType: 'filtered' }, select: { symbol: true, rank: true } }),
    prisma.rankingHistory.findMany({ where: { rankType: 'all' }, select: { symbol: true, rank: true } }),
  ]);
  const filteredHistMap = new Map<string, number[]>();
  for (const r of filteredHistRows) {
    if (!filteredHistMap.has(r.symbol)) filteredHistMap.set(r.symbol, []);
    filteredHistMap.get(r.symbol)!.push(r.rank);
  }
  const allHistMap = new Map<string, number[]>();
  for (const r of allHistRows) {
    if (!allHistMap.has(r.symbol)) allHistMap.set(r.symbol, []);
    allHistMap.get(r.symbol)!.push(r.rank);
  }

  // ── Score ────────────────────────────────────────────────────────────────────
  console.log('[4/5] Scoring...');

  type ScoredEntry = { symbol: string; score: ReturnType<typeof scoreStock> & object };

  const filteredScored: ScoredEntry[] = [];
  const allScored:      ScoredEntry[] = [];

  for (const [symbol, candles] of pricesBySymbol) {
    const mcap  = mcapMap.get(symbol);
    const isEtf = isETFWhitelisted(symbol);

    if ((!mcap || mcap < PARAMS.mcapMinCr) && !isEtf) continue;
    if (candles.length < 248) continue;

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const volumes = candles.map(c => c.volume);
    const ath     = athMap.get(symbol);

    const allResult = scoreStock(closes, highs, volumes, symbol, ath, { skipFilters: true });
    if (allResult) allScored.push({ symbol, score: allResult });

    if (mcap && mcap >= PARAMS.mcapMinCr) {
      const filtResult = scoreStock(closes, highs, volumes, symbol, ath);
      if (filtResult) filteredScored.push({ symbol, score: filtResult });
    }
  }

  filteredScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  allScored.sort((a, b)      => b.score.compositeScore - a.score.compositeScore);
  console.log(`  filtered=${filteredScored.length}, all=${allScored.length}`);

  // ── Store ────────────────────────────────────────────────────────────────────
  console.log('[5/5] Updating MomentumScore and RankingHistory...');

  const buildRows = (
    scored: ScoredEntry[],
    rt: 'filtered' | 'all',
    prevRanks: Map<string, number>,
    histMap: Map<string, number[]>,
    metaMap: Map<string, Meta>,
  ) => scored.map((s, idx) => {
    const rank = idx + 1;
    const history = [...(histMap.get(s.symbol) ?? []), rank];
    const meta = metaMap.get(s.symbol);
    return {
      computedDate: today,
      symbol: s.symbol,
      instrumentKey: meta?.instrumentKey ?? '',
      companyName: meta?.companyName ?? s.symbol,
      rank,
      compositeScore: s.score.compositeScore,
      avgSharpe: s.score.avgSharpe,
      sharpe12m: s.score.sharpe12m,
      sharpe6m: s.score.sharpe6m,
      sharpe3m: s.score.sharpe3m,
      athProximity: s.score.athProximity,
      ath: s.score.ath,
      currentPrice: s.score.currentPrice,
      dma200: s.score.dma200,
      aboveDma200Pct: s.score.aboveDma200Pct,
      aboveDma10: s.score.aboveDma10,
      aboveDma20: s.score.aboveDma20,
      aboveDma50: s.score.aboveDma50,
      aboveDma100: s.score.aboveDma100,
      medianTurnoverCr: s.score.medianTurnoverCr,
      marketCapCr: mcapMap.get(s.symbol) ?? 0,
      marketCapCategory: meta?.marketCapCategory ?? null,
      sparklineData: meta?.sparklineData ?? null,
      circuitBandPct: meta?.circuitBandPct ?? null,
      prevRank: prevRanks.get(s.symbol) ?? null,
      avgRank50d: history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : null,
      bestRank:   history.length > 0 ? Math.min(...history) : null,
      appearances: history.length,
      t50Pct:  history.length > 0 ? (history.filter(r => r <= 50).length  / history.length) * 100 : 0,
      t100Pct: history.length > 0 ? (history.filter(r => r <= 100).length / history.length) * 100 : 0,
      isActive: true,
      rankType: rt,
    };
  });

  for (const rt of ['filtered', 'all'] as const) {
    const scored   = rt === 'filtered' ? filteredScored : allScored;
    const prevRanks = rt === 'filtered' ? prevFiltered : prevAll;
    const histMap  = rt === 'filtered' ? filteredHistMap : allHistMap;

    // Use prevRank from YESTERDAY's RankingHistory (backfilled with new weights)
    // This makes the rank change reflect new-formula-yesterday vs new-formula-today
    const yday = await prisma.rankingHistory.findMany({
      where: { rankType: rt, date: { lt: today } },
      orderBy: { date: 'desc' },
      distinct: ['symbol'],
      select: { symbol: true, rank: true },
    });
    const ydayRanks = new Map(yday.map(r => [r.symbol, r.rank]));

    const metaMap = rt === 'filtered' ? metaFiltered : metaAll;
    const rows = buildRows(scored, rt, ydayRanks.size > 0 ? ydayRanks : prevRanks, histMap, metaMap);

    await prisma.momentumScore.updateMany({ where: { isActive: true, rankType: rt }, data: { isActive: false } });
    await prisma.momentumScore.deleteMany({ where: { computedDate: today, rankType: rt } });
    for (const chunk of chunkArray(rows, 50)) {
      await prisma.momentumScore.createMany({ data: chunk });
    }

    // Insert today's RankingHistory
    await prisma.rankingHistory.deleteMany({ where: { date: today, rankType: rt } });
    const histRows = scored.map((s, idx) => ({
      symbol: s.symbol, date: today, rank: idx + 1,
      compositeScore: s.score.compositeScore, rankType: rt,
    }));
    for (const chunk of chunkArray(histRows, 100)) {
      await prisma.rankingHistory.createMany({ data: chunk });
    }

    console.log(`  [${rt}] ${rows.length} rows stored`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${elapsed}s`);
  console.log('  Note: companyName and sparklineData preserved from previous records — run full pipeline to refresh.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Rescore failed:', err);
  process.exit(1);
});
