'use server';

import { revalidateTag, unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db';
import { computePortfolioState } from '@/lib/finance/recalculation';
import { computeReturns, sharpeRatio, PARAMS } from '@/lib/screener/scoring';
import { runScreenerPipeline } from '@/lib/screener/pipeline';
import { detectAndFlushAnomalies } from '@/lib/screener/corporate-actions';
import { getAllInstrumentData, getBESymbols } from '@/lib/instrument-service';
import { createJob, completeJob, failJob } from '@/lib/jobs';
import { fetchASMList } from '@/lib/nse-api';

// ── Types ──

export interface ScreenerRow {
  rank: number;
  symbol: string;
  companyName: string;
  compositeScore: number;
  avgSharpe: number;
  athProximity: number;
  currentPrice: number;
  aboveDma200Pct: number;
  dmaSwatches: { above10: boolean; above20: boolean; above50: boolean; above100: boolean; above200: boolean };
  medianTurnoverCr: number;
  marketCapCr: number;
  marketCapCategory: string | null;
  sparklineData: number[];
  circuitBandPct: number | null;
  prevRank: number | null;
  rankChange: number | null;
  inPortfolio: boolean;
  isPreFiltered?: boolean;  // only set for 'all' tab — stock also passes pre-filter
  isUnranked?: boolean;
  unrankedReason?: string;
  isBE?: boolean;
  exitSignal?: {
    byRank: boolean;    // rank > 50
    byFilter: boolean;  // below 200 DMA OR athProximity < 0.75
    by50Dma: boolean;   // below 50 DMA
    byDrawdownWarn: boolean; // dropped > 20% from post-portfolio addition high (warn)
    byDrawdown: boolean;     // dropped > 25% from post-portfolio addition high (exit)
    protected: boolean; // last BUY within 14 days (min hold rule)
    isUnranked: boolean; // not in screener universe (e.g. BE category)
    isBE: boolean;       // specifically moved to BE (T+0 settlement) category
    is5PctCircuit?: boolean; // 5% daily circuit limit
    unrankedReason?: string;
    // Signal classification
    signalType: 'green' | 'yellow' | 'red';
  };
  asmInfo?: {
    type: 'ST' | 'LT';
    stage: string;
    desc: string;
  };
  drawdownSinceEntry?: number | null;
}

export interface ScreenerStats {
  total: number;
  allTotal: number;
  portfolioCount: number;
  rankedPortfolioCount: number;
  rankBuckets: { hold: number; warning: number; exit: number };
  mcapBreakdown: { large: number; mid: number; small: number; micro: number };
  dataDate: string | null;
}

// ── Server Actions ──

// Cached MomentumScore query — revalidated on every sync/pipeline run
const getCachedActiveScores = unstable_cache(
  async (rankType: 'filtered' | 'all') => {
    return prisma.momentumScore.findMany({
      where: { isActive: true, rankType },
      orderBy: { rank: 'asc' },
    });
  },
  ['screener-scores'],
  { revalidate: 3600, tags: ['screener-scores'] },
);

const getCachedFilteredSymbols = unstable_cache(
  async () => {
    const rows = await prisma.momentumScore.findMany({
      where: { isActive: true, rankType: 'filtered' },
      select: { symbol: true },
    });
    return rows.map(r => r.symbol);
  },
  ['screener-filtered-symbols'],
  { revalidate: 3600, tags: ['screener-scores'] },
);

export async function getScreenerData(
  tab: 'all' | 'prefiltered' | 'portfolio' = 'prefiltered',
): Promise<{ rows: ScreenerRow[]; stats: ScreenerStats }> {
  // Determine which rankType to query for the main scores list
  let rankTypeForScores: 'filtered' | 'all';
  if (tab === 'all') {
    rankTypeForScores = 'all';
  } else {
    // 'prefiltered', 'portfolio' all use filtered rankings
    rankTypeForScores = 'filtered';
  }

  const scores = await getCachedActiveScores(rankTypeForScores);
  const beSymbols = await getBESymbols();

  // Fetch ASM surveillance list
  let asmMap = new Map<string, { symbol: string; type: 'ST' | 'LT'; stage: string; desc: string }>();
  try {
    const asmList = await fetchASMList();
    asmMap = new Map(asmList.map(item => [item.symbol, item]));
  } catch (error) {
    // Fail-safe, keep empty map
  }

  const peakSinceEntryMap = new Map<string, number>();
  let portfolioSymbols: Set<string>;
  let portfolioNames: Map<string, string>;
  let holdingQty = new Map<string, number>();
  const holdingAgeDays = new Map<string, number>();
  try {
    const engine = await computePortfolioState(new Date());
    const holdings = Array.from(engine.holdings.values()).filter(h => h.qty > 0.01);
    portfolioSymbols = new Set(holdings.map(h => h.symbol));
    portfolioNames = new Map(holdings.map(h => [h.symbol, h.symbol]));
    holdingQty = new Map(holdings.map(h => [h.symbol, h.qty]));

    // Weighted-average holding age and earliest entry date of active holdings
    const now = Date.now();
    const earliestDateMap = new Map<string, Date>();
    for (const [sym, batches] of engine.inventory.entries()) {
      let totalQty = 0, weightedDays = 0;
      const validBatches = batches.filter(b => b.qty > 0);
      for (const b of validBatches) {
        const days = (now - b.date.getTime()) / 86_400_000;
        weightedDays += days * b.qty;
        totalQty += b.qty;
      }
      if (totalQty > 0) holdingAgeDays.set(sym, Math.round(weightedDays / totalQty));

      if (validBatches.length > 0) {
        const earliest = new Date(Math.min(...validBatches.map(b => b.date.getTime())));
        earliestDateMap.set(sym, earliest);
      }
    }

    if (portfolioSymbols.size > 0 && earliestDateMap.size > 0) {
      try {
        const symList = Array.from(portfolioSymbols);
        const minDateOfAll = new Date(Math.min(...Array.from(earliestDateMap.values()).map(d => d.getTime())));
        const minDateStr = minDateOfAll.toISOString().split('T')[0];

        const priceHistories = await prisma.screenerPrice.findMany({
          where: {
            symbol: { in: symList },
            date: { gte: minDateStr }
          },
          select: { symbol: true, date: true, close: true, high: true }
        });

        const pricesBySymbol = new Map<string, { date: string; close: number; high: number }[]>();
        for (const p of priceHistories) {
          if (!pricesBySymbol.has(p.symbol)) pricesBySymbol.set(p.symbol, []);
          pricesBySymbol.get(p.symbol)!.push(p);
        }

        for (const [sym, earliestDate] of earliestDateMap.entries()) {
          const hist = pricesBySymbol.get(sym) || [];
          const startOfEarliest = new Date(earliestDate);
          startOfEarliest.setHours(0, 0, 0, 0);

          const afterEntry = hist.filter(h => {
            const d = new Date(h.date + 'T00:00:00');
            return d >= startOfEarliest;
          });
          
          if (afterEntry.length > 0) {
            const maxHigh = Math.max(...afterEntry.map(h => h.high));
            peakSinceEntryMap.set(sym, maxHigh);
          }
        }
      } catch (err) {
        // Fail-safe
      }
    }
  } catch {
    portfolioSymbols = new Set();
    portfolioNames = new Map();
  }

  if (scores.length === 0 && portfolioSymbols.size === 0) {
    return {
      rows: [],
      stats: {
        total: 0, allTotal: 0, portfolioCount: 0, rankedPortfolioCount: 0,
        rankBuckets: { hold: 0, warning: 0, exit: 0 },
        mcapBreakdown: { large: 0, mid: 0, small: 0, micro: 0 },
        dataDate: null,
      },
    };
  }

  // For All tab: fetch which symbols also pass pre-filtering — used for row highlights
  let filteredSymbols = new Set<string>();
  if (tab === 'all') {
    filteredSymbols = new Set(await getCachedFilteredSymbols());
  }

  // Compute rank change from RankingHistory (not stored prevRank) so it's always
  // correct regardless of how many times the cron ran today.
  const todayDate = scores[0]?.computedDate ?? null;
  const prevDayRanks = await loadPrevDayRanksForDisplay(todayDate, rankTypeForScores);

  const rankedSymbols = new Set<string>();
  const allRows: ScreenerRow[] = scores.map(s => {
    rankedSymbols.add(s.symbol);
    const inPortfolio = portfolioSymbols.has(s.symbol);
    const prevRank = prevDayRanks.get(s.symbol) ?? null;
    const rankChange = prevRank !== null ? prevRank - s.rank : null;

    const asm = asmMap.get(s.symbol);

    const peak = peakSinceEntryMap.get(s.symbol);
    const currentPrice = s.currentPrice;
    let drawdownSinceEntry: number | null = null;
    if (peak && currentPrice > 0) {
      const entryPeak = Math.max(peak, currentPrice);
      drawdownSinceEntry = -((1 - (currentPrice / entryPeak)) * 100);
    }

    return {
      rank: s.rank,
      symbol: s.symbol,
      companyName: s.companyName,
      compositeScore: s.compositeScore,
      avgSharpe: s.avgSharpe,
      athProximity: s.athProximity,
      currentPrice: s.currentPrice,
      aboveDma200Pct: s.aboveDma200Pct,
      dmaSwatches: {
        above10: s.aboveDma10,
        above20: s.aboveDma20,
        above50: s.aboveDma50,
        above100: s.aboveDma100,
        above200: s.aboveDma200Pct >= 0,
      },
      medianTurnoverCr: s.medianTurnoverCr,
      marketCapCr: s.marketCapCr,
      marketCapCategory: s.marketCapCategory,
      sparklineData: s.sparklineData ? JSON.parse(s.sparklineData) : [],
      circuitBandPct: s.circuitBandPct ?? null,
      prevRank,
      rankChange,
      inPortfolio,
      isPreFiltered: filteredSymbols.size > 0 ? filteredSymbols.has(s.symbol) : undefined,
      isBE: beSymbols.has(s.symbol) || s.symbol.endsWith('-BE'),
      asmInfo: asm ? { type: asm.type, stage: asm.stage, desc: asm.desc } : undefined,
      drawdownSinceEntry,
    };
  });

  // Unranked portfolio stocks — only for portfolio tab
  if (tab === 'portfolio') {
    const unrankedSyms = Array.from(portfolioSymbols).filter(s => !rankedSymbols.has(s));
    if (unrankedSyms.length > 0) {
      const [prices, athRows, mcapRows, amfiRows, lastScores, instrumentMap, activeAllScores] = await Promise.all([
        prisma.screenerPrice.findMany({
          where: { symbol: { in: unrankedSyms } },
          orderBy: [{ symbol: 'asc' }, { date: 'asc' }],
          select: { symbol: true, close: true, high: true, volume: true },
        }),
        prisma.stockATH.findMany({ where: { symbol: { in: unrankedSyms } }, select: { symbol: true, ath: true } }),
        prisma.stockMarketCap.findMany({ where: { symbol: { in: unrankedSyms } }, select: { symbol: true, marketCap: true } }),
        prisma.aMFIClassification.findMany({
          where: { symbol: { in: unrankedSyms } },
          orderBy: { period: 'desc' },
          select: { symbol: true, category: true, companyName: true },
        }),
        // Fallback mcap from last known scored entry (use filtered rankings for portfolio context)
        prisma.momentumScore.findMany({
          where: { symbol: { in: unrankedSyms }, rankType: 'filtered' },
          orderBy: [{ computedDate: 'desc' }],
          select: { symbol: true, marketCapCr: true, marketCapCategory: true },
        }),
        getAllInstrumentData(unrankedSyms),
        prisma.momentumScore.findMany({
          where: { symbol: { in: unrankedSyms }, isActive: true, rankType: 'all' },
          select: { symbol: true },
        }),
      ]);

      const pricesBySymbol = new Map<string, { close: number; high: number; volume: number }[]>();
      for (const p of prices) {
        let arr = pricesBySymbol.get(p.symbol);
        if (!arr) { arr = []; pricesBySymbol.set(p.symbol, arr); }
        arr.push({ close: p.close, high: p.high, volume: p.volume });
      }
      const athMap = new Map(athRows.map(r => [r.symbol, r.ath]));
      const mcapMap = new Map(mcapRows.map(r => [r.symbol, r.marketCap]));
      const lastScoreMap = new Map<string, { marketCapCr: number; marketCapCategory: string | null }>();
      for (const r of lastScores) {
        if (!lastScoreMap.has(r.symbol)) lastScoreMap.set(r.symbol, r);
      }
      const amfiMap = new Map<string, { category: string; companyName: string }>();
      for (const r of amfiRows) {
        if (!amfiMap.has(r.symbol)) amfiMap.set(r.symbol, { category: r.category, companyName: r.companyName });
      }
      const activeAllSymbols = new Set(activeAllScores.map(r => r.symbol));

      for (const sym of unrankedSyms) {
        const candles = pricesBySymbol.get(sym) || [];
        const closes = candles.map(c => c.close);
        const price = closes.length > 0 ? closes[closes.length - 1] : 0;
        const storedAth = athMap.get(sym);
        const ath = storedAth || price;
        const athProximity = ath > 0 ? price / ath : 0;
        const dma = (n: number) => closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null;
        const [d10, d20, d50, d100, d200] = [dma(10), dma(20), dma(50), dma(100), dma(200)];
        const amfi = amfiMap.get(sym);
        const lastScore = lastScoreMap.get(sym);

        // Compute Sharpe-based score without hard entry filters (stock is already held)
        let compositeScore = 0, avgSharpe = 0;
        if (closes.length >= 270) {
          const dateIdx = closes.length - 1;
          const effectiveIdx = dateIdx - 21;
          const c12 = closes.slice(Math.max(0, dateIdx - 251), dateIdx + 1);
          const c6  = closes.slice(Math.max(0, dateIdx - 125), dateIdx + 1);
          const c3  = closes.slice(Math.max(0, effectiveIdx - 62), effectiveIdx + 1);
          const s12 = sharpeRatio(computeReturns(c12));
          const s6  = sharpeRatio(computeReturns(c6));
          const s3  = sharpeRatio(computeReturns(c3));
          if (Number.isFinite(s12) && Number.isFinite(s6) && Number.isFinite(s3)) {
            avgSharpe = (s12 + s6 + s3) / 3;
            compositeScore = PARAMS.sharpeWeight * avgSharpe;
          }
        }

        const marketCapCr = mcapMap.get(sym) ?? lastScore?.marketCapCr ?? 0;
        const marketCapCategory = amfi?.category ?? lastScore?.marketCapCategory ?? null;

        // Compute median daily turnover in Crores
        const volLookback = PARAMS.volumeLookbackDays;
        const volWindow: number[] = [];
        for (let i = Math.max(0, candles.length - volLookback); i < candles.length; i++) {
          volWindow.push(candles[i].close * candles[i].volume);
        }
        const sortedVol = [...volWindow].sort((a, b) => a - b);
        const mid = Math.floor(sortedVol.length / 2);
        const medianTurnover = sortedVol.length === 0 ? 0 :
          (sortedVol.length % 2 !== 0 ? sortedVol[mid] : (sortedVol[mid - 1] + sortedVol[mid]) / 2);
        const medianTurnoverCr = medianTurnover / 1e7;

        // Determine specific exclusion reason
        const instData = instrumentMap.get(sym);
        const isBE = instData?.instrumentType === 'BE' || sym.endsWith('-BE');

        let unrankedReason = 'Outside screener universe';
        if (isBE) {
          unrankedReason = 'BE category (Trade-to-Trade)';
        } else if (marketCapCr > 0 && marketCapCr < PARAMS.mcapMinCr) {
          unrankedReason = `Market cap < ₹1,000 Cr (₹${marketCapCr.toFixed(0)} Cr)`;
        } else if (closes.length < 269) {
          unrankedReason = `Price history < 269 days (${closes.length}/269)`;
        } else if (closes.length >= 269 && compositeScore === 0) {
          unrankedReason = 'Missing price data';
        } else {
          // If in active all ranking but not filtered, determine which filter failed
          if (activeAllSymbols.has(sym)) {
            const failedFilters: string[] = [];
            if (d200 === null || price < d200) {
              failedFilters.push('Below 200 DMA');
            }
            if (price < PARAMS.minPrice) {
              failedFilters.push(`Price < ₹${PARAMS.minPrice}`);
            }
            if (athProximity < 0.70) {
              failedFilters.push('> 30% below ATH');
            }
            if (medianTurnoverCr < PARAMS.volumeThresholdCr) {
              failedFilters.push(`Turnover < ₹${PARAMS.volumeThresholdCr} Cr`);
            }
            if (failedFilters.length > 0) {
              unrankedReason = failedFilters.join(', ');
            } else {
              unrankedReason = 'Outside top rankings';
            }
          } else {
            unrankedReason = 'Outside screener universe';
          }
        }

        const asm = asmMap.get(sym);

        const peak = peakSinceEntryMap.get(sym);
        let drawdownSinceEntry: number | null = null;
        if (peak && price > 0) {
          const entryPeak = Math.max(peak, price);
          drawdownSinceEntry = -((1 - (price / entryPeak)) * 100);
        }

        allRows.push({
          rank: 9999,
          symbol: sym,
          companyName: amfi?.companyName || portfolioNames.get(sym) || sym,
          compositeScore,
          avgSharpe,
          athProximity,
          currentPrice: price,
          aboveDma200Pct: d200 !== null ? ((price - d200) / d200) * 100 : 0,
          dmaSwatches: {
            above10:  d10  !== null && price >= d10,
            above20:  d20  !== null && price >= d20,
            above50:  d50  !== null && price >= d50,
            above100: d100 !== null && price >= d100,
            above200: d200 !== null && price >= d200,
          },
          medianTurnoverCr,
          marketCapCr,
          marketCapCategory,
          sparklineData: closes.slice(-50),
          circuitBandPct: null,
          prevRank: null,
          rankChange: null,
          inPortfolio: true,
          isUnranked: true,
          unrankedReason,
          isBE,
          asmInfo: asm ? { type: asm.type, stage: asm.stage, desc: asm.desc } : undefined,
          drawdownSinceEntry,
        });
      }
    }
  }


  // Exit signal detection for portfolio stocks
  const portfolioSymArr = Array.from(portfolioSymbols);
  if (portfolioSymArr.length > 0) {
    for (const row of allRows) {
      if (!row.inPortfolio) continue;
      const isUnranked = row.isUnranked === true;
      const isBE = row.isBE ?? (isUnranked && (row.unrankedReason?.includes('BE category') ?? false));
      const is5PctCircuit = row.circuitBandPct !== null && row.circuitBandPct !== undefined && row.circuitBandPct < 15;
      const byRank   = isUnranked || row.rank > 50;
      const byFilter = !row.dmaSwatches.above200 || row.athProximity < 0.75;
      const by50Dma = !row.dmaSwatches.above50;
      const byDrawdownWarn = row.drawdownSinceEntry !== undefined && row.drawdownSinceEntry !== null && row.drawdownSinceEntry < -20;
      const byDrawdown     = row.drawdownSinceEntry !== undefined && row.drawdownSinceEntry !== null && row.drawdownSinceEntry < -25;
      if (!byRank && !byFilter && !by50Dma && !byDrawdownWarn && !isBE && !is5PctCircuit) continue;
      const ageDays     = holdingAgeDays.get(row.symbol) ?? 9999;
      const isProtected = ageDays < 14;

      // Determine signal type:
      // Red: byFilter, or other unranked reasons (not BE), or rank > 60, or DD > 25%
      // Yellow: BE category OR 5% circuit OR rank 51-60 OR below 50 DMA OR DD 20-25% (warn zone)
      let signalType: 'green' | 'yellow' | 'red';
      const isRed = byFilter || (isUnranked && !isBE) || (!isUnranked && row.rank > 60) || byDrawdown;
      if (isRed) {
        signalType = 'red';
      } else {
        signalType = 'yellow';
      }

      row.exitSignal = { byRank, byFilter, by50Dma, byDrawdownWarn, byDrawdown, protected: isProtected, isUnranked, isBE, is5PctCircuit, unrankedReason: row.unrankedReason, signalType };
    }
  }

  // Filter rows by tab BEFORE computing stats so signal counts reflect the right set
  let rows: ScreenerRow[];
  switch (tab) {
    case 'portfolio':
      rows = allRows.filter(r => r.inPortfolio);
      break;
    default:
      rows = allRows;
  }

  // Compute stats AFTER exit signals are set so hold/warn/exit counts are correct
  const stats = await computeStats(rows, portfolioSymbols.size, portfolioSymbols);

  // Mcap breakdown by actual portfolio position value (qty × currentPrice)
  let mcLarge = 0, mcMid = 0, mcSmall = 0, mcMicro = 0;
  for (const r of rows) {
    if (!r.inPortfolio || r.currentPrice <= 0) continue;
    const posVal = (holdingQty.get(r.symbol) || 0) * r.currentPrice;
    const cat = r.marketCapCategory?.toLowerCase() || '';
    if (cat.includes('large')) mcLarge += posVal;
    else if (cat.includes('mid')) mcMid += posVal;
    else if (cat.includes('small')) mcSmall += posVal;
    else if (r.marketCapCategory) mcMicro += posVal;
  }
  stats.mcapBreakdown = { large: mcLarge, mid: mcMid, small: mcSmall, micro: mcMicro };

  return { rows, stats };
}

// ── Helpers ──

async function computeStats(
  rows: ScreenerRow[],
  portfolioCount: number = 0,
  portfolioSymbols?: Set<string>,
): Promise<ScreenerStats> {
  // Signal bucket counts for portfolio tab (hold/warning/exit)
  let holdCount = 0, warningCount = 0, exitCount = 0;
  for (const r of rows) {
    if (!r.inPortfolio) continue;
    if (r.exitSignal) {
      if (r.exitSignal.signalType === 'yellow') warningCount++;
      else exitCount++;
    } else {
      holdCount++;
    }
  }

  // Always query canonical counts regardless of which tab's rows we received
  const symList = portfolioSymbols && portfolioSymbols.size > 0 ? [...portfolioSymbols] : [];
  const [allTotal, filteredTotal, rankedPortfolioCount] = await Promise.all([
    prisma.momentumScore.count({ where: { isActive: true, rankType: 'all' } }),
    prisma.momentumScore.count({ where: { isActive: true, rankType: 'filtered' } }),
    symList.length > 0
      ? prisma.momentumScore.count({ where: { isActive: true, rankType: 'filtered', symbol: { in: symList } } })
      : Promise.resolve(0),
  ]);

  return {
    total: filteredTotal,          // always pre-filtered count, tab-independent
    allTotal,                      // always all-universe count
    portfolioCount,                // always total portfolio size (holdings)
    rankedPortfolioCount,          // portfolio stocks in pre-filtered set
    rankBuckets: { hold: holdCount, warning: warningCount, exit: exitCount },
    mcapBreakdown: { large: 0, mid: 0, small: 0, micro: 0 },
    dataDate: null,
  };
}

/** Trigger the screener pipeline server-side (used by the Sync button). */
export async function syncScreener(): Promise<{ success: boolean; ranked: number; error?: string; jobId: string }> {
  const job = await createJob('screener-sync', 'Starting...');
  try {
    const txns = await prisma.transaction.findMany({ select: { symbol: true, type: true, quantity: true } });
    const qtyMap = new Map<string, number>();
    for (const t of txns) {
      const q = qtyMap.get(t.symbol) ?? 0;
      qtyMap.set(t.symbol, t.type === 'BUY' ? q + t.quantity : q - t.quantity);
    }
    const portfolioSymbols = new Set([...qtyMap.entries()].filter(([, q]) => q > 0.01).map(([s]) => s));

    const result = await runScreenerPipeline(job.id, portfolioSymbols);
    // detectAndFlushAnomalies is now called inside runScreenerPipeline (before scoring)
    await completeJob(job.id, { ranked: result.ranked });
    revalidateTag('screener-scores', 'max');  // bust cached score rows
    return { success: true, ranked: result.ranked, jobId: job.id };
  } catch (err) {
    await failJob(job.id, (err as Error).message);
    return { success: false, ranked: 0, error: (err as Error).message, jobId: job.id };
  }
}


export async function getRankHistoriesBatch(
  symbols: string[],
  rankType: 'filtered' | 'all',
): Promise<Record<string, { date: string; rank: number; compositeScore: number }[]>> {
  if (symbols.length === 0) return {};
  const rows = await prisma.rankingHistory.findMany({
    where: { symbol: { in: symbols }, rankType },
    orderBy: { date: 'asc' },
    select: { symbol: true, date: true, rank: true, compositeScore: true },
  });
  const result: Record<string, { date: string; rank: number; compositeScore: number }[]> = {};
  for (const r of rows) {
    if (!result[r.symbol]) result[r.symbol] = [];
    result[r.symbol].push({ date: r.date, rank: r.rank, compositeScore: r.compositeScore });
  }
  return result;
}

/**
 * Load the previous trading day's ranks from RankingHistory.
 * Used at read time so rank change is always correct regardless of cron re-runs.
 */
async function loadPrevDayRanksForDisplay(
  todayDate: string | null,
  rankType: string,
): Promise<Map<string, number>> {
  if (!todayDate) return new Map();

  const prevDate = await prisma.rankingHistory.findFirst({
    where: { rankType, date: { lt: todayDate } },
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

export async function getRankHistory(
  symbol: string,
  rankType: 'filtered' | 'all' = 'all'
): Promise<{ date: string; rank: number; compositeScore: number }[]> {
  const history = await prisma.rankingHistory.findMany({
    where: { symbol, rankType },
    orderBy: { date: 'asc' },
    select: { date: true, rank: true, compositeScore: true },
  });
  return history;
}

export interface LastCronRun {
  timestamp: string;
  success: boolean;
  date?: string | null;
  scored?: number;
  ranked?: number;
  errors?: string[];
  durationMs?: number;
  details?: string; // crash message
}

/**
 * Get data freshness info for the settings page.
 */
export async function getDataFreshness(): Promise<{
  latestPriceDate: string | null;
  priceCount: number;
  latestRankDate: { filtered: string | null; all: string | null };
  rankCount: { filtered: number; all: number };
  totalPriceDates: number;
  totalRankDates: number;
  lastCronRun: LastCronRun | null;
}> {
  const [latestPrice, latestFilteredRank, latestAllRank, filteredCount, allCount, cronConfig] = await Promise.all([
    prisma.screenerPrice.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.rankingHistory.findFirst({ where: { rankType: 'filtered' }, orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.rankingHistory.findFirst({ where: { rankType: 'all' }, orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.momentumScore.count({ where: { isActive: true, rankType: 'filtered' } }),
    prisma.momentumScore.count({ where: { isActive: true, rankType: 'all' } }),
    prisma.appConfig.findUnique({ where: { key: 'cron.screener.lastRun' } }),
  ]);

  // Count distinct dates using raw SQL for efficiency
  const [priceDatesResult, rankDatesResult] = await Promise.all([
    prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(DISTINCT date) as count FROM "ScreenerPrice"`,
    prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(DISTINCT date) as count FROM "RankingHistory"`,
  ]);
  const totalPriceDates = priceDatesResult[0]?.count ?? 0;
  const totalRankDates = rankDatesResult[0]?.count ?? 0;

  // Get price count for latest date
  let priceCount = 0;
  if (latestPrice) {
    priceCount = await prisma.screenerPrice.count({ where: { date: latestPrice.date } });
  }

  // Parse last cron run
  let lastCronRun: LastCronRun | null = null;
  if (cronConfig?.value) {
    try {
      lastCronRun = JSON.parse(cronConfig.value) as LastCronRun;
    } catch { /* ignore malformed JSON */ }
  }

  return {
    latestPriceDate: latestPrice?.date ?? null,
    priceCount,
    latestRankDate: {
      filtered: latestFilteredRank?.date ?? null,
      all: latestAllRank?.date ?? null,
    },
    rankCount: { filtered: filteredCount, all: allCount },
    totalPriceDates,
    totalRankDates,
    lastCronRun,
  };
}
