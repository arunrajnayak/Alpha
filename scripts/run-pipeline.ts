/**
 * Standalone momentum screener pipeline with progress output.
 *
 * Key optimisation vs API route: loads ALL ScreenerPrice rows in ONE query,
 * groups by symbol in-memory — eliminates 2000+ sequential DB round-trips.
 *
 * Usage:
 *   npx dotenvx run -f .env.local -- npx tsx scripts/run-pipeline.ts
 */

import { gunzipSync } from 'zlib';
import { prisma, chunkArray } from './lib/db';
import { scoreStock, PARAMS } from '../src/lib/screener/scoring';

// ─── Instrument master ──────────────────────────────────────────────────────

const NSE_INSTRUMENTS_URL =
  'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

interface RawInstrument {
  instrument_key: string;
  tradingsymbol: string;
  trading_symbol?: string;
  name: string;
  instrument_type: string;
}

async function loadInstruments(): Promise<Array<{ symbol: string; key: string; name: string }>> {
  console.log('Downloading NSE instrument master...');
  const res = await fetch(NSE_INSTRUMENTS_URL);
  const buf = Buffer.from(await res.arrayBuffer());
  const data: RawInstrument[] = JSON.parse(gunzipSync(buf).toString('utf8'));
  const result = data
    .filter(i => i.instrument_type === 'EQ' && i.instrument_key?.startsWith('NSE_EQ'))
    .map(i => ({
      symbol: (i.tradingsymbol ?? i.trading_symbol ?? '').toUpperCase(),
      key: i.instrument_key,
      name: i.name,
    }))
    .filter(i => i.symbol);
  console.log(`  Found ${result.length} NSE_EQ instruments`);
  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function fmt(n: number) { return n.toLocaleString(); }

// ─── Main pipeline ──────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  const today = todayIST();
  console.log(`\n=== Momentum Screener Pipeline — ${today} ===\n`);

  // Step 1: Load market cap from DB (already populated by bhavcopy)
  console.log('Step 1/6  Loading market cap from DB...');
  const mcapRows = await prisma.stockMarketCap.findMany({
    select: { symbol: true, marketCap: true },
  });
  const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
  console.log(`  ${fmt(mcapMap.size)} stocks with market cap data`);

  // Step 2: Load ATH from DB
  console.log('Step 2/6  Loading ATH from DB...');
  const athRows = await prisma.stockATH.findMany({
    select: { symbol: true, ath: true },
  });
  const athMap = new Map(athRows.map(r => [r.symbol, r.ath]));
  console.log(`  ${fmt(athMap.size)} stocks with ATH data`);

  // Step 3: Batch-load ALL prices in ONE query — the key optimisation
  console.log('Step 3/6  Batch loading all prices from DB (this may take a moment)...');
  const t3 = Date.now();
  const allPrices = await prisma.screenerPrice.findMany({
    orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
    select: { symbol: true, close: true, high: true, volume: true },
  });
  console.log(`  ${fmt(allPrices.length)} price rows loaded in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

  // Group by symbol in memory
  type Candle = { close: number; high: number; volume: number };
  const pricesBySymbol = new Map<string, Candle[]>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ close: p.close, high: p.high, volume: p.volume });
  }
  console.log(`  Grouped into ${fmt(pricesBySymbol.size)} symbols`);

  // Step 4: Load AMFI classifications + instruments
  console.log('Step 4/6  Loading instruments + AMFI...');
  const amfiRows = await prisma.aMFIClassification.findMany({
    select: { symbol: true, category: true },
  });
  const amfiMap = new Map(amfiRows.map(r => [r.symbol, r.category]));
  console.log(`  ${fmt(amfiMap.size)} AMFI classifications loaded`);
  const instruments = await loadInstruments();

  // Step 5: Score each stock
  console.log('Step 5/6  Scoring stocks...');
  const t5 = Date.now();

  let processed = 0;
  let skippedMcap = 0;
  let skippedNoData = 0;
  let skippedInsufficient = 0;
  let skippedFilter = 0;
  let scored = 0;

  const results: Array<{
    symbol: string;
    instrumentKey: string;
    companyName: string;
    score: NonNullable<ReturnType<typeof scoreStock>>;
    marketCapCr: number;
    sparklineData: number[];
  }> = [];

  for (const inst of instruments) {
    processed++;

    // mcap filter
    const mcap = mcapMap.get(inst.symbol);
    if (!mcap || mcap < PARAMS.mcapMinCr) { skippedMcap++; continue; }

    // price data
    const candles = pricesBySymbol.get(inst.symbol);
    if (!candles || candles.length === 0) { skippedNoData++; continue; }
    if (candles.length < 248) { skippedInsufficient++; continue; } // 247 dateIdx + 1 = 248 (~12 months)

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const volumes = candles.map(c => c.volume);

    const storedATH = athMap.get(inst.symbol);
    const result = scoreStock(closes, highs, volumes, inst.symbol, storedATH);
    if (!result) { skippedFilter++; continue; }

    scored++;
    results.push({
      symbol: inst.symbol,
      instrumentKey: inst.key,
      companyName: inst.name,
      score: result,
      marketCapCr: mcap,
      sparklineData: closes.slice(-50),
    });

    // Progress every 100 processed instruments
    if (processed % 100 === 0) {
      const elapsed = ((Date.now() - t5) / 1000).toFixed(1);
      console.log(
        `  [${processed}/${instruments.length}] scored=${scored} | ` +
        `skip: mcap=${skippedMcap} nodata=${skippedNoData} short=${skippedInsufficient} filter=${skippedFilter} | ${elapsed}s`
      );
    }
  }

  // Final progress line
  const scoringTime = ((Date.now() - t5) / 1000).toFixed(1);
  console.log(
    `  Done — processed=${processed} scored=${scored} | ` +
    `skip: mcap=${skippedMcap} nodata=${skippedNoData} short=${skippedInsufficient} filter=${skippedFilter} | ${scoringTime}s`
  );

  // Step 6: Rank and store
  console.log('Step 6/6  Ranking and storing results...');

  // Sort by composite score descending
  results.sort((a, b) => b.score.compositeScore - a.score.compositeScore);

  // Load previous ranks for rank change
  const prevRanks = new Map<string, number>();
  const prevActive = await prisma.momentumScore.findMany({
    where: { isActive: true },
    select: { symbol: true, rank: true },
  });
  for (const s of prevActive) prevRanks.set(s.symbol, s.rank);

  // Mark existing scores inactive
  await prisma.momentumScore.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  // Delete any existing records for today (handles same-day re-runs safely)
  await prisma.momentumScore.deleteMany({ where: { computedDate: today } });

  // Build score rows
  const scoreRows = results.map((s, idx) => {
    const rank = idx + 1;
    // Price sparkline: last 50 closes
    const candles = pricesBySymbol.get(s.symbol) || [];
    const sparkline = candles.map(c => c.close).slice(-50);

    return {
      computedDate: today,
      symbol: s.symbol,
      instrumentKey: s.instrumentKey,
      companyName: s.companyName,
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
      marketCapCr: s.marketCapCr,
      marketCapCategory: amfiMap.get(s.symbol) ?? null,
      sparklineData: JSON.stringify(sparkline),
      circuitBandPct: null as number | null,
      prevRank: prevRanks.get(s.symbol) ?? null,
      avgRank50d: null as number | null,
      bestRank: null as number | null,
      appearances: 0,
      t50Pct: 0,
      t100Pct: 0,
      isActive: true,
    };
  });

  // Batch insert MomentumScore (chunks of 50 for Turso)
  let inserted = 0;
  for (const chunk of chunkArray(scoreRows, 50)) {
    await prisma.momentumScore.createMany({ data: chunk });
    inserted += chunk.length;
    process.stdout.write(`\r  MomentumScore: ${inserted}/${scoreRows.length} inserted`);
  }
  console.log();

  // RankingHistory removed — no longer needed

  // Prune history > 50 days
  const distinctDates = await prisma.rankingHistory.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
  });
  if (distinctDates.length > 50) {
    const cutoff = distinctDates[49].date;
    const deleted = await prisma.rankingHistory.deleteMany({
      where: { date: { lt: cutoff } },
    });
    console.log(`  Pruned ${deleted.count} old history rows (before ${cutoff})`);
  }

  const totalTime = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Pipeline complete in ${totalTime}s`);
  console.log(`   Ranked ${scored} stocks — top 5:`);
  results.slice(0, 5).forEach((s, i) => {
    console.log(
      `   ${i + 1}. ${s.symbol.padEnd(12)} score=${s.score.compositeScore.toFixed(4)} ` +
      `sharpe=${s.score.avgSharpe.toFixed(3)} ath=${(s.score.athProximity * 100).toFixed(1)}%`
    );
  });
  console.log();
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
