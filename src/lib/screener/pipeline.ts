/**
 * Momentum screener pipeline orchestrator.
 * Runs daily after market close to compute and store rankings.
 * Mirrors backtest/backend/engine.py scoring logic exactly.
 *
 * Performance budget (Vercel 300s limit):
 *   - Upstox API calls: ~4 OHLC + 0-5 holiday checks + 0-5 corp action refetches
 *   - Turso DB: larger chunks (200-500) to minimize round-trips
 *   - Single scoring pass produces both filtered + all-universe rankings
 *   - Independent DB loads run in parallel via Promise.all
 */

import { prisma, chunkArray } from '@/lib/db';
import { ensureInstrumentMaster, getAllSymbols, getAllInstrumentData, getBESymbols } from '@/lib/instrument-service';
import { getFullQuote } from '@/lib/upstox-client';
import { getCategoriesBatch } from '@/lib/amfi/service';
import { fetchAndStoreBhavcopy, isBhavcopyStale } from './bhavcopy';
import { fetchAndStoreCandles, patchTodayPrices } from './prices';
import { detectAndFlushAnomalies } from './corporate-actions';
import { updateATHFromPrices, loadATHMap } from './ath';
import { detectAndAdjustDemergers } from './demerger';
import { scoreStock, PARAMS, isETFWhitelisted } from './scoring';
import { resolveLastTradingDay, isMarketHours, daysAgo } from './dates';
import { logger } from '@/lib/logger';
import { updateJob } from '@/lib/jobs';

const pipelineLogger = logger.scope('ScreenerPipeline');

// Turso batches via HTTP — safe to use larger chunks than SQLite's 999-var limit
const TURSO_WRITE_CHUNK = 200;
const TURSO_DELETE_CHUNK = 500;

export interface PipelineResult {
  success: boolean;
  date: string;
  bhavcopyUpdated: number;
  candlesFetched: number;
  candlesInserted: number;
  athUpdated: number;
  universeSize: number;
  scored: number;
  ranked: number;
  corporateActionsFlushed: string[];
  errors: string[];
  durationMs: number;
}

interface InstrumentInfo {
  symbol: string;
  instrumentKey: string;
  name: string;
}

type ScoredStock = {
  symbol: string;
  instrumentKey: string;
  companyName: string;
  score: NonNullable<ReturnType<typeof scoreStock>>;
  marketCapCr: number;
  marketCapCategory: string | null;
  circuitBandPct: number | null;
  sparklineData: number[];
  passesFilters: boolean; // true = in filtered set, false = all-universe only
};

export async function runScreenerPipeline(jobId?: string, portfolioSymbols?: Set<string>): Promise<PipelineResult> {
  const start = Date.now();
  const TIMEOUT_MS = 270_000;
  const duringMarket = isMarketHours();
  const today = await resolveLastTradingDay();
  const errors: string[] = [];

  const isTimedOut = () => Date.now() - start > TIMEOUT_MS;
  const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1)}s`;

  const progress = async (pct: number, msg: string) => {
    if (jobId) await updateJob(jobId, pct, msg).catch(() => {});
  };

  pipelineLogger.info(`Pipeline start for ${today}${duringMarket ? ' (market open — T-1)' : ''}`);

  // ── Step 1: Bhavcopy (weekly refresh) ──────────────────────────────────────
  let bhavcopyUpdated = 0;
  try {
    if (await isBhavcopyStale()) {
      const bhavcopy = await fetchAndStoreBhavcopy(today);
      bhavcopyUpdated = bhavcopy.updated;
    } else {
      pipelineLogger.info('Bhavcopy fresh — skipping');
    }
  } catch (err) {
    errors.push(`Bhavcopy: ${(err as Error).message}`);
  }
  await progress(5, 'Bhavcopy done');
  pipelineLogger.info(`[${elapsed()}] Bhavcopy done`);

  // ── Step 2: Load instruments ───────────────────────────────────────────────
  await ensureInstrumentMaster();
  const allSymbols = await getAllSymbols();
  const instrumentMap = await getAllInstrumentData(allSymbols);
  const instruments: InstrumentInfo[] = [];
  for (const [symbol, data] of instrumentMap) {
    instruments.push({ symbol, instrumentKey: data.key, name: data.name });
  }
  const tradeable = instruments.filter(i => !i.instrumentKey.startsWith('NSE_INDEX|'));

  // BE (trade-to-trade) stocks are included in the universe (ranked with warning highlight in pre-filtered tab)
  const beSymbols = await getBESymbols();
  const tradeableFiltered = tradeable;
  pipelineLogger.info(`[${elapsed()}] ${tradeableFiltered.length} tradeable instruments (including ${beSymbols.size} BE series)`);
  await progress(10, `${tradeableFiltered.length} instruments`);

  // ── Step 3: Patch today's prices (batch OHLC) ─────────────────────────────
  let candlesFetched = 0;
  let candlesInserted = 0;
  let ohlcMissing: Array<{ symbol: string; instrumentKey: string }> = [];
  try {
    const priceResult = await patchTodayPrices(tradeable, today, duringMarket);
    candlesFetched = priceResult.patched;
    candlesInserted = priceResult.patched;
    ohlcMissing = priceResult.missing;
    if (priceResult.errors.length > 0) errors.push(...priceResult.errors.slice(0, 10));
  } catch (err) {
    errors.push(`Prices: ${(err as Error).message}`);
    pipelineLogger.error('Price patch failed:', err);
  }
  pipelineLogger.info(`[${elapsed()}] Prices patched: ${candlesFetched}; missing live_ohlc: ${ohlcMissing.length}`);

  // ── Step 3a: Historical candle fallback for stocks missing from OHLC batch ─
  // Root cause of "stocks missing from pre-filtered list after cron":
  // At exactly 4:00 PM IST (~20 min after closing auction), Upstox's live_ohlc
  // endpoint hasn't yet published the final EOD candle for some stocks. The
  // previous code fell back to prev_ohlc (T-1's close), silently storing
  // yesterday's price as today's — stocks near their 200 DMA would then
  // fail the filter. The historical candle API uses a separate settled-data
  // endpoint and is typically ready within a few minutes of market close.
  // Only run after close: during market hours today's historical candle isn't
  // available yet, so the missing-OHLC case there is expected and harmless.
  if (!duringMarket && ohlcMissing.length > 0) {
    // Scope to scoreableInsts subset — no point fetching for stocks we won't score.
    // We haven't computed scoreableInsts yet, so filter by instrument type as a proxy:
    // exclude INDEX instruments (they're already filtered in tradeable).
    pipelineLogger.info(
      `[${elapsed()}] ${ohlcMissing.length} stocks had no live_ohlc — retrying via historical candle API (settled EOD data)`,
    );
    if (ohlcMissing.length <= 200) {
      // Only log names for a manageable count to keep logs readable
      pipelineLogger.info(`Missing symbols: ${ohlcMissing.map(i => i.symbol).join(', ')}`);
    }
    try {
      const fallbackResult = await fetchAndStoreCandles(ohlcMissing, today);
      pipelineLogger.info(
        `[${elapsed()}] Historical fallback: inserted ${fallbackResult.inserted} candles for ${fallbackResult.fetched} stocks`,
      );
      candlesInserted += fallbackResult.inserted;
      if (fallbackResult.errors.length > 0) errors.push(...fallbackResult.errors.slice(0, 5));
    } catch (err) {
      errors.push(`Historical fallback: ${(err as Error).message}`);
      pipelineLogger.error('Historical candle fallback failed:', err);
    }
  }
  pipelineLogger.info(`[${elapsed()}] Price step done`);

  // Freshness guard: verify prices were actually stored for today.
  // If patchTodayPrices silently failed (key mismatch, market closed, API error),
  // abort early rather than scoring on stale data.
  const todayPriceCount = await prisma.screenerPrice.count({ where: { date: today } });
  pipelineLogger.info(`[${elapsed()}] Price freshness check: ${todayPriceCount} rows for ${today}`);
  if (todayPriceCount < 100) {
    const msg = `Price freshness check failed: only ${todayPriceCount} prices for ${today} (expected 2000+). ` +
      `OHLC batch may have failed or market may be closed. Aborting to prevent stale rankings.`;
    pipelineLogger.error(msg);
    errors.push(msg);
    return {
      success: false, date: today, bhavcopyUpdated, candlesFetched, candlesInserted,
      athUpdated: 0, universeSize: tradeable.length, scored: 0, ranked: 0,
      corporateActionsFlushed: [], errors, durationMs: Date.now() - start,
    };
  }
  await progress(25, 'Prices patched');

  // ── Step 3b: Corporate action detection ────────────────────────────────────
  let corporateActionsFlushed: string[] = [];
  try {
    const caResult = await detectAndFlushAnomalies();
    corporateActionsFlushed = caResult.flushed;
    if (caResult.flushed.length > 0) {
      pipelineLogger.info(`Corp actions flushed: ${caResult.flushed.join(', ')}`);
    }
  } catch (err) {
    errors.push(`Corp action: ${(err as Error).message}`);
  }
  pipelineLogger.info(`[${elapsed()}] Corp actions done`);
  await progress(28, 'Corp actions done');

  // ── Step 3c: Demerger price adjustment ─────────────────────────────────────
  // Runs after flush (3b) so refetched data gets adjusted,
  // and before ATH update (5) so ATH sees correct prices.
  // Uses NSE API to identify demergers specifically (not splits/bonuses).
  let demergerAdjusted: string[] = [];
  try {
    const universeSymbols = new Set(tradeable.map(i => i.symbol));
    const demergerResult = await detectAndAdjustDemergers(universeSymbols);
    demergerAdjusted = demergerResult.adjusted;
    if (demergerResult.adjusted.length > 0) {
      pipelineLogger.info(`Demerger adjusted: ${demergerResult.adjusted.join(', ')}`);
    }
    if (demergerResult.errors.length > 0) {
      errors.push(...demergerResult.errors);
    }
  } catch (err) {
    errors.push(`Demerger: ${(err as Error).message}`);
  }
  pipelineLogger.info(`[${elapsed()}] Demerger check done`);
  await progress(30, 'Demerger check done');

  // ── Step 4: Load mcap EARLY for filtering ──────────────────────────────────
  // Load mcap before the big price query so we can filter to scoreable stocks only
  const mcapMap = new Map<string, number>();
  const allMcap = await prisma.stockMarketCap.findMany({ select: { symbol: true, marketCap: true } });
  for (const row of allMcap) mcapMap.set(row.symbol, row.marketCap);

  // Fallback: if a stock is missing from StockMarketCap (e.g. bhavcopy had a gap or
  // the weekly refresh hasn't run yet), use the last known marketCapCr from MomentumScore.
  // This prevents previously-ranked stocks from being silently dropped just because
  // their bhavcopy row is temporarily absent.
  const lastKnownMcap = await prisma.momentumScore.findMany({
    where: { marketCapCr: { gt: 0 } },
    select: { symbol: true, marketCapCr: true },
    orderBy: { computedDate: 'desc' },
    distinct: ['symbol'],
  });
  let mcapFallbackCount = 0;
  for (const row of lastKnownMcap) {
    if (!mcapMap.has(row.symbol)) {
      mcapMap.set(row.symbol, row.marketCapCr);
      mcapFallbackCount++;
    }
  }
  if (mcapFallbackCount > 0) {
    pipelineLogger.info(`[${elapsed()}] mcap fallback: ${mcapFallbackCount} symbols rescued from last known MomentumScore`);
  }

  // All tab: score all tradeable instruments without market cap filter.
  // Market cap filter (>= 1,000 Cr) is applied selectively to the Pre-filtered set during scoring.
  const scoreableInsts = tradeableFiltered;
  pipelineLogger.info(`[${elapsed()}] ${scoreableInsts.length} scoreable instruments for all-universe scoring`);

  // ── Step 4b: Circuit check (skip if already >90s to save time) ─────────────
  const keyToSymbol = new Map<string, string>();
  for (const inst of scoreableInsts) keyToSymbol.set(inst.instrumentKey, inst.symbol);

  const circuitMap = new Map<string, number>();
  if (Date.now() - start < 90_000) {
    try {
      const allKeys = scoreableInsts.map(i => i.instrumentKey);
      const chunks = chunkArray(allKeys, 500);
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 250));
        const quotes = await getFullQuote(chunks[i]);
        for (const [, quote] of quotes) {
          if (quote.lower_circuit_limit > 0) {
            const bandWidth = (quote.upper_circuit_limit - quote.lower_circuit_limit) / quote.lower_circuit_limit;
            const symbol = keyToSymbol.get(quote.instrument_token);
            // Post-market Upstox API returns ~6.2% (±3%) bounds for normal liquid stocks.
            // Real 2% circuit = ~4.1%, Real 5% circuit = ~10.5%, 10% circuit = ~22.2%, 20% = ~50%.
            // Filter out post-market artifacts (5.5% - 7.5% when !duringMarket) so post-market API bounds
            // do not misclassify liquid stocks as narrow circuit band.
            const isPostMarketArtifact = !duringMarket && bandWidth >= 0.055 && bandWidth <= 0.075;
            if (symbol && !isPostMarketArtifact) {
              circuitMap.set(symbol, bandWidth);
            }
          }
        }
      }
      pipelineLogger.info(`[${elapsed()}] Circuit check: ${circuitMap.size} stocks`);
    } catch (err) {
      errors.push(`Circuit check: ${(err as Error).message}`);
      pipelineLogger.warn('Circuit check failed, continuing without:', err);
    }
  } else {
    pipelineLogger.warn(`[${elapsed()}] Skipping circuit check (>90s elapsed)`);
    errors.push('Circuit check skipped (time pressure)');
  }
  await progress(40, 'Circuit check done');

  // ── Step 5: ATH update ─────────────────────────────────────────────────────
  let athUpdated = 0;
  try {
    const athResult = await updateATHFromPrices(today);
    athUpdated = athResult.updated;
  } catch (err) {
    errors.push(`ATH: ${(err as Error).message}`);
  }
  pipelineLogger.info(`[${elapsed()}] ATH updated: ${athUpdated}`);

  // ── Timeout check ──────────────────────────────────────────────────────────
  if (isTimedOut()) {
    pipelineLogger.warn('Timeout after data-fetch — returning partial');
    errors.push('Pipeline timed out before scoring');
    return {
      success: false, date: today, bhavcopyUpdated, candlesFetched, candlesInserted,
      athUpdated, universeSize: tradeable.length, scored: 0, ranked: 0,
      corporateActionsFlushed, errors, durationMs: Date.now() - start,
    };
  }

  // ── Step 6: Parallel DB loads ──────────────────────────────────────────────
  const scoreableSymbols = scoreableInsts.map(i => i.symbol);
  const [amfiCategories, athMap] = await Promise.all([
    getCategoriesBatch(scoreableSymbols),
    loadATHMap(),
  ]);

  const [prevRanks, prevAllRanks] = await Promise.all([
    loadPreviousDayRanks(today, 'filtered'),
    loadPreviousDayRanks(today, 'all'),
  ]);

  const [rankingHistory, allRankingHistory] = await Promise.all([
    loadRankingHistoryForStats('filtered'),
    loadRankingHistoryForStats('all'),
  ]);

  pipelineLogger.info(`[${elapsed()}] DB loads complete`);
  await progress(50, 'Loading prices...');

  // ── Step 7: Load prices (only for scoreable stocks) ────────────────────────
  const priceFromDate = daysAgo(500, today);
  type Candle = { close: number; high: number; volume: number };

  // Only load prices for scoreable stocks — cuts query size ~50%
  let allPrices: Array<{ symbol: string; close: number; high: number; volume: number }> = [];

  if (scoreableInsts.length < tradeableFiltered.length * 0.8) {
    // Chunk symbol list for the IN clause (to avoid SQLite's 999 prepared statement parameter limit)
    const symbolChunks = chunkArray(scoreableSymbols, 500);
    const results = await Promise.all(
      symbolChunks.map(chunk =>
        prisma.screenerPrice.findMany({
          where: {
            date: { gte: priceFromDate, lte: today },
            symbol: { in: chunk },
          },
          orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
          select: { symbol: true, close: true, high: true, volume: true },
        })
      )
    );
    allPrices = results.flat();
  } else {
    allPrices = await prisma.screenerPrice.findMany({
      where: { date: { gte: priceFromDate, lte: today } },
      orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
      select: { symbol: true, close: true, high: true, volume: true },
    });
  }
  const pricesBySymbol = new Map<string, Candle[]>();
  for (const p of allPrices) {
    let arr = pricesBySymbol.get(p.symbol);
    if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
    arr.push({ close: p.close, high: p.high, volume: p.volume });
  }
  pipelineLogger.info(`[${elapsed()}] Loaded ${allPrices.length} price rows for ${pricesBySymbol.size} symbols`);
  await progress(60, 'Scoring...');

  // ── Step 8: SINGLE scoring pass (both filtered + all-universe) ─────────────
  const allScored: ScoredStock[] = [];
  let scoringFailures = 0;

  for (const inst of scoreableInsts) {
    try {
      const bandWidth = circuitMap.get(inst.symbol);
      // Circuit filter only applies to pre-filtered list (not all-universe)

      const candles = pricesBySymbol.get(inst.symbol);
      if (!candles || candles.length < 269) continue;

      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const volumes = candles.map(c => c.volume);

      const storedATH = athMap.get(inst.symbol);
      const mcap = mcapMap.get(inst.symbol) ?? 0;

      // Score with skipFilters to get all-universe result
      const allResult = scoreStock(closes, highs, volumes, inst.symbol, storedATH, { skipFilters: true });
      if (!allResult) continue;

      // Circuit band < 9% (2% circuit stocks and narrow bands) excluded from pre-filtered; 5% circuits (bandWidth ~10.5%) are allowed with warning highlight
      // Market cap must be >= 1,000 Cr (or whitelisted ETF / portfolio holding)
      const filteredResult = scoreStock(closes, highs, volumes, inst.symbol, storedATH);
      const passesMcap = (mcap >= PARAMS.mcapMinCr) || isETFWhitelisted(inst.symbol) || !!portfolioSymbols?.has(inst.symbol);
      const passesCircuit = bandWidth === undefined || bandWidth >= 0.09 || !!portfolioSymbols?.has(inst.symbol);
      const passesFilters = filteredResult !== null && passesCircuit && passesMcap;

      const sparkline = closes.slice(-50);

      allScored.push({
        symbol: inst.symbol,
        instrumentKey: inst.instrumentKey,
        companyName: inst.name,
        score: allResult,
        marketCapCr: mcap,
        marketCapCategory: amfiCategories.get(inst.symbol) || null,
        circuitBandPct: bandWidth !== undefined ? Math.round(bandWidth * 100 * 10) / 10 : null,
        sparklineData: sparkline,
        passesFilters,
      });
    } catch {
      scoringFailures++;
    }
  }

  // Split into filtered + all, each sorted by composite score
  const filteredScored = allScored.filter(s => s.passesFilters);
  filteredScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  allScored.sort((a, b) => b.score.compositeScore - a.score.compositeScore);

  if (scoringFailures > 0) {
    errors.push(`${scoringFailures} stocks failed scoring`);
  }
  pipelineLogger.info(`[${elapsed()}] Scored: ${filteredScored.length} filtered, ${allScored.length} all`);
  await progress(70, `Scored ${filteredScored.length} filtered`);

  // ── Step 9: Store filtered rankings ────────────────────────────────────────
  await prisma.momentumScore.updateMany({
    where: { isActive: true, rankType: 'filtered' },
    data: { isActive: false },
  });
  await prisma.momentumScore.deleteMany({ where: { computedDate: today, rankType: 'filtered' } });

  const filteredRows = buildScoreRows(filteredScored, today, 'filtered', prevRanks, rankingHistory);
  for (const chunk of chunkArray(filteredRows, TURSO_WRITE_CHUNK)) {
    await prisma.momentumScore.createMany({ data: chunk });
  }

  await prisma.rankingHistory.deleteMany({ where: { date: today, rankType: 'filtered' } });
  const filteredHistoryRows = filteredScored.map((s, idx) => ({
    symbol: s.symbol, date: today, rank: idx + 1,
    compositeScore: s.score.compositeScore, rankType: 'filtered',
  }));
  for (const chunk of chunkArray(filteredHistoryRows, TURSO_WRITE_CHUNK)) {
    await prisma.rankingHistory.createMany({ data: chunk });
  }

  pipelineLogger.info(`[${elapsed()}] Filtered rankings stored`);
  await progress(80, 'Filtered stored');

  // ── Step 10: Store all-universe rankings (skip on timeout) ─────────────────
  if (isTimedOut()) {
    pipelineLogger.warn('Timeout — skipping all-universe store');
    errors.push('Skipped all-universe scoring due to timeout');
    return {
      success: true, date: today, bhavcopyUpdated, candlesFetched, candlesInserted,
      athUpdated, universeSize: tradeable.length, scored: filteredScored.length,
      ranked: filteredScored.length, corporateActionsFlushed, errors,
      durationMs: Date.now() - start,
    };
  }

  await prisma.momentumScore.updateMany({
    where: { isActive: true, rankType: 'all' },
    data: { isActive: false },
  });
  await prisma.momentumScore.deleteMany({ where: { computedDate: today, rankType: 'all' } });

  const allRows = buildScoreRows(allScored, today, 'all', prevAllRanks, allRankingHistory);
  for (const chunk of chunkArray(allRows, TURSO_WRITE_CHUNK)) {
    await prisma.momentumScore.createMany({ data: chunk });
  }

  await prisma.rankingHistory.deleteMany({ where: { date: today, rankType: 'all' } });
  const allHistoryRows = allScored.map((s, idx) => ({
    symbol: s.symbol, date: today, rank: idx + 1,
    compositeScore: s.score.compositeScore, rankType: 'all',
  }));
  for (const chunk of chunkArray(allHistoryRows, TURSO_WRITE_CHUNK)) {
    await prisma.rankingHistory.createMany({ data: chunk });
  }

  pipelineLogger.info(`[${elapsed()}] All-universe rankings stored`);
  await progress(90, 'All stored');

  // ── Step 11: Prune old RankingHistory ──────────────────────────────────────
  try {
    for (const rt of ['filtered', 'all'] as const) {
      const distinctDates = await prisma.rankingHistory.findMany({
        where: { rankType: rt },
        select: { date: true },
        distinct: ['date'],
        orderBy: { date: 'desc' },
      });
      if (distinctDates.length > 50) {
        const cutoffDate = distinctDates[49].date;
        await prisma.rankingHistory.deleteMany({
          where: { date: { lt: cutoffDate }, rankType: rt },
        });
      }
    }
  } catch (err) {
    errors.push(`Pruning: ${(err as Error).message}`);
  }

  const duration = Date.now() - start;
  pipelineLogger.info(`[${elapsed()}] Pipeline complete: ${filteredScored.length} filtered, ${allScored.length} all`);
  await progress(100, `Done: ${filteredScored.length} filtered, ${allScored.length} all`);

  return {
    success: true, date: today, bhavcopyUpdated, candlesFetched, candlesInserted,
    athUpdated, universeSize: tradeable.length, scored: filteredScored.length,
    ranked: filteredScored.length, corporateActionsFlushed, errors,
    durationMs: duration,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildScoreRows(
  scored: ScoredStock[],
  today: string,
  rankType: string,
  prevRanks: Map<string, number>,
  history: Map<string, Array<{ date: string; rank: number }>>,
) {
  return scored.map((s, idx) => {
    const rank = idx + 1;
    const hist = history.get(s.symbol) || [];
    const allRanks = [...hist.map(h => h.rank), rank];

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
      marketCapCategory: s.marketCapCategory,
      sparklineData: JSON.stringify(s.sparklineData),
      circuitBandPct: s.circuitBandPct,
      prevRank: prevRanks.get(s.symbol) ?? null,
      avgRank50d: allRanks.length > 0
        ? allRanks.reduce((a, b) => a + b, 0) / allRanks.length : null,
      bestRank: allRanks.length > 0 ? Math.min(...allRanks) : null,
      appearances: allRanks.length,
      t50Pct: allRanks.length > 0
        ? (allRanks.filter(r => r <= 50).length / allRanks.length) * 100 : 0,
      t100Pct: allRanks.length > 0
        ? (allRanks.filter(r => r <= 100).length / allRanks.length) * 100 : 0,
      isActive: true,
      rankType,
    };
  });
}

async function loadPreviousDayRanks(today: string, rankType: string): Promise<Map<string, number>> {
  const prevDate = await prisma.rankingHistory.findFirst({
    where: { rankType, date: { lt: today } },
    select: { date: true },
    orderBy: { date: 'desc' },
  });
  if (!prevDate) return new Map();

  const rows = await prisma.rankingHistory.findMany({
    where: { rankType, date: prevDate.date },
    select: { symbol: true, rank: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.symbol, r.rank);
  return map;
}

async function loadRankingHistoryForStats(rankType?: string): Promise<Map<string, Array<{ date: string; rank: number }>>> {
  const where = rankType ? { rankType } : {};
  const allHistory = await prisma.rankingHistory.findMany({
    where,
    orderBy: { date: 'asc' },
    select: { symbol: true, date: true, rank: true },
  });
  const map = new Map<string, Array<{ date: string; rank: number }>>();
  for (const row of allHistory) {
    let arr = map.get(row.symbol);
    if (!arr) { arr = []; map.set(row.symbol, arr); }
    arr.push({ date: row.date, rank: row.rank });
  }
  return map;
}
