import { prisma } from '@/lib/db';
import { getLiveDashboardData } from '@/app/actions/live';
import { fetchMarketOverview, fetchAllIndexSummaries } from '@/app/actions/market-overview';
import { getScreenerData } from '@/app/actions/screener';
import { logger } from '@/lib/logger';
import type {
  ReportData,
  PortfolioSection,
  PortfolioHolding,
  MarketSection,
  ExitCandidate,
  WarnCandidate,
  EntryCandidate,
} from './types';

const reportLogger = logger.scope('ReportData');

// Derive a human-readable reason string for a signal
function signalReason(opts: {
  byFilter: boolean;
  by50Dma: boolean;
  byDrawdownWarn: boolean;
  byDrawdown: boolean;
  byRank: boolean;
  isBE: boolean;
  isUnranked: boolean;
  rank: number | null;
}): string {
  const parts: string[] = [];
  if (opts.byFilter)                parts.push('below 200 DMA');
  if (opts.by50Dma && !opts.byFilter) parts.push('below 50 DMA');
  if (opts.byDrawdown)              parts.push('dropped > 25% since entry');
  else if (opts.byDrawdownWarn)     parts.push('dropped > 20% since entry');
  if (opts.isBE)                    parts.push('moved to BE category');
  if (opts.isUnranked && !opts.isBE) parts.push('dropped out of screener universe');
  if (opts.byRank && opts.rank != null && !opts.isUnranked) parts.push(`rank ${opts.rank} (above cut-off)`);
  return parts.join(', ') || 'signal triggered';
}

async function gatherMultiPeriodPerformance(): Promise<PortfolioSection['multiPeriod']> {
  try {
    const snapshots = await prisma.dailyPortfolioSnapshot.findMany({
      orderBy: { date: 'desc' },
      take: 365,
    });

    if (snapshots.length === 0) return null;

    const latest = snapshots[0];
    const todayStr = latest.date.toISOString().split('T')[0];
    const dLatest = new Date(`${todayStr}T00:00:00.000Z`);

    const findSnapshotOnOrBefore = (targetDateStr: string) => {
      return snapshots.find((s) => s.date.toISOString().split('T')[0] <= targetDateStr);
    };

    const d1W = new Date(dLatest);
    d1W.setUTCDate(d1W.getUTCDate() - 7);
    const snap1W = findSnapshotOnOrBefore(d1W.toISOString().split('T')[0]);

    const d1M = new Date(dLatest);
    d1M.setUTCDate(d1M.getUTCDate() - 30);
    const snap1M = findSnapshotOnOrBefore(d1M.toISOString().split('T')[0]);

    const year = todayStr.slice(0, 4);
    const snapYTD = findSnapshotOnOrBefore(`${year}-01-01`);

    const calcReturn = (curr: number | null, prev: number | null) => {
      if (curr == null || prev == null || prev === 0) return null;
      return ((curr / prev) - 1) * 100;
    };

    return {
      oneWeek: {
        portfolio: snap1W ? calcReturn(latest.portfolioNAV, snap1W.portfolioNAV) : null,
        nifty50:   snap1W ? calcReturn(latest.niftyNAV, snap1W.niftyNAV) : null,
        n500Mom50: snap1W ? calcReturn(latest.nifty500Momentum50NAV, snap1W.nifty500Momentum50NAV) : null,
      },
      oneMonth: {
        portfolio: snap1M ? calcReturn(latest.portfolioNAV, snap1M.portfolioNAV) : null,
        nifty50:   snap1M ? calcReturn(latest.niftyNAV, snap1M.niftyNAV) : null,
        n500Mom50: snap1M ? calcReturn(latest.nifty500Momentum50NAV, snap1M.nifty500Momentum50NAV) : null,
      },
      ytd: {
        portfolio: snapYTD ? calcReturn(latest.portfolioNAV, snapYTD.portfolioNAV) : null,
        nifty50:   snapYTD ? calcReturn(latest.niftyNAV, snapYTD.niftyNAV) : null,
        n500Mom50: snapYTD ? calcReturn(latest.nifty500Momentum50NAV, snapYTD.nifty500Momentum50NAV) : null,
      },
    };
  } catch (err) {
    reportLogger.warn('Multi-period performance calculation failed:', (err as Error).message);
    return null;
  }
}

async function gatherPortfolioSection(
  liveData: Awaited<ReturnType<typeof getLiveDashboardData>>,
  holdWarnExitCounts: { hold: number; warning: number; exit: number },
): Promise<PortfolioSection> {
  const sorted = [...liveData.allHoldings].sort(
    (a, b) => b.dayChangePercent - a.dayChangePercent,
  );

  const topGainer = sorted[0]
    ? { symbol: sorted[0].symbol, changePercent: sorted[0].dayChangePercent }
    : null;
  const topLoser = sorted[sorted.length - 1]
    ? { symbol: sorted[sorted.length - 1].symbol, changePercent: sorted[sorted.length - 1].dayChangePercent }
    : null;

  const multiPeriod = await gatherMultiPeriodPerformance();

  // Compute unique portfolio stats
  let uniqueStats: PortfolioSection['uniqueStats'] = null;
  if (liveData.allHoldings.length > 0) {
    const all = liveData.allHoldings;
    const totalCount = all.length;
    const profitableCount = all.filter((h) => h.totalPnlPercent > 0).length;
    const winRatePct = (profitableCount / totalCount) * 100;
    const advancingTodayCount = all.filter((h) => h.dayChangePercent > 0).length;
    const decliningTodayCount = all.filter((h) => h.dayChangePercent < 0).length;

    const pnlSorted = [...all].sort((a, b) => b.totalPnlPercent - a.totalPnlPercent);
    const topOverallWinner = pnlSorted[0]
      ? { symbol: pnlSorted[0].symbol, totalPnlPercent: pnlSorted[0].totalPnlPercent }
      : null;
    const topOverallLoser = pnlSorted[pnlSorted.length - 1]
      ? { symbol: pnlSorted[pnlSorted.length - 1].symbol, totalPnlPercent: pnlSorted[pnlSorted.length - 1].totalPnlPercent }
      : null;

    uniqueStats = {
      profitableCount,
      totalHoldingsCount: totalCount,
      winRatePct,
      advancingTodayCount,
      decliningTodayCount,
      nearAthCount: 0,
      asmSurveillanceCount: 0,
      topOverallWinner,
      topOverallLoser,
    };
  }

  return {
    dayGainPercent: liveData.dayGainPercent,
    totalPnlPercent: liveData.totalPnlPercent,
    holdingsCount: liveData.allHoldings.length,
    holdWarnExitCounts,
    topGainer,
    topLoser,
    benchmarks: liveData.indices.map((i) => ({
      name: i.name,
      changePercent: i.percentChange,
    })),
    multiPeriod,
    uniqueStats,
  };
}

async function gatherMarketSection(): Promise<MarketSection> {
  const [indexSummaries, totalMarketData, nifty50Data] = await Promise.all([
    fetchAllIndexSummaries(),
    fetchMarketOverview('NIFTY Total Market'),
    fetchMarketOverview('NIFTY 50'),
  ]);

  const sectorals = indexSummaries.summaries
    .filter((s) => s.category === 'sectoral')
    .sort((a, b) => b.changePercent - a.changePercent);

  const topSectors    = sectorals.slice(0, 3).map((s) => ({ name: s.name, shortName: s.shortName, changePercent: s.changePercent }));
  const bottomSectors = sectorals.slice(-3).reverse().map((s) => ({ name: s.name, shortName: s.shortName, changePercent: s.changePercent }));

  const topGainers = (totalMarketData?.topGainers ?? []).slice(0, 5).map((c) => ({
    symbol: c.symbol, changePercent: c.changePercent, lastPrice: c.lastPrice,
  }));
  const topLosers = (totalMarketData?.topLosers ?? []).slice(0, 5).map((c) => ({
    symbol: c.symbol, changePercent: c.changePercent, lastPrice: c.lastPrice,
  }));

  return {
    topSectors,
    bottomSectors,
    topGainers,
    topLosers,
    totalMarket: totalMarketData ? { advancing: totalMarketData.advancing, declining: totalMarketData.declining, unchanged: totalMarketData.unchanged } : null,
    nifty50:     nifty50Data     ? { advancing: nifty50Data.advancing,     declining: nifty50Data.declining,     unchanged: nifty50Data.unchanged }     : null,
  };
}

async function gatherEntryCandidates(portfolioSymbols: Set<string>): Promise<EntryCandidate[]> {
  const top30 = await prisma.momentumScore.findMany({
    where: { isActive: true, rankType: 'filtered', rank: { lte: 30 } },
    orderBy: { rank: 'asc' },
  });

  const recentDates = await prisma.rankingHistory.findMany({
    where: { rankType: 'filtered' },
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
    take: 2,
  });

  const yesterdaySet = new Set<string>();
  if (recentDates.length >= 2) {
    const yesterdayDate = recentDates[1].date;
    const yesterdayTop30 = await prisma.rankingHistory.findMany({
      where: { date: yesterdayDate, rankType: 'filtered', rank: { lte: 30 } },
      select: { symbol: true },
    });
    for (const r of yesterdayTop30) yesterdaySet.add(r.symbol);
  }

  return top30
    .filter((s) => !portfolioSymbols.has(s.symbol))
    .map((s) => ({
      rank: s.rank,
      symbol: s.symbol,
      compositeScore: s.compositeScore,
      athProximityPct: s.athProximity * 100,
      marketCapCategory: s.marketCapCategory,
      isNewEntrant: !yesterdaySet.has(s.symbol),
    }));
}

export async function gatherReportData(date: string): Promise<ReportData> {
  const errors: string[] = [];

  let portfolio: ReportData['portfolio'] = null;
  let holdings: PortfolioHolding[]       = [];
  let market:   ReportData['market']     = null;
  let exits:    ExitCandidate[]          = [];
  let warnings: WarnCandidate[]          = [];
  let entries:  EntryCandidate[]         = [];
  let portfolioSymbols                   = new Set<string>();

  // Shared live data — reused by both portfolio section and holdings list
  // 20s timeout: Upstox live quotes can stall when market is closed
  let liveData: Awaited<ReturnType<typeof getLiveDashboardData>> | null = null;
  try {
    const liveTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Live data timed out after 20s')), 20_000),
    );
    liveData = await Promise.race([getLiveDashboardData(), liveTimeout]);
  } catch (err) {
    reportLogger.error('Live dashboard data failed:', err);
    errors.push(`LiveData: ${(err as Error).message}`);
  }

  await Promise.all([
    // Market section with timeout — fetchMarketOverview is slow (750+ Upstox constituent quotes)
    (async () => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Market section timed out after 30s')), 30_000),
        );
        market = await Promise.race([gatherMarketSection(), timeout]);
      } catch (err) {
        reportLogger.error('Market section failed:', err);
        errors.push(`Market: ${(err as Error).message}`);
      }
    })(),

    // Screener data — exits, warnings, per-holding signals (25s timeout)
    (async () => {
      try {
        const screenerTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Screener data timed out after 25s')), 25_000),
        );
        const { rows, stats } = await Promise.race([getScreenerData('portfolio'), screenerTimeout]);
        portfolioSymbols = new Set(rows.filter((r) => r.inPortfolio).map((r) => r.symbol));

        // Build a quick lookup: symbol → liveData row for day% and totalPnl%
        const liveMap = new Map(
          (liveData?.allHoldings ?? []).map((h) => [h.symbol, h]),
        );

        // Per-holding rich detail (portfolio only, ordered by day change desc)
        holdings = rows
          .filter((r) => r.inPortfolio)
          .sort((a, b) => {
            const da = liveMap.get(a.symbol)?.dayChangePercent ?? 0;
            const db = liveMap.get(b.symbol)?.dayChangePercent ?? 0;
            return db - da;
          })
          .map((r) => {
            const live  = liveMap.get(r.symbol);
            const sig   = r.exitSignal;
            let signal: PortfolioHolding['signal'] = 'hold';
            if (sig?.signalType === 'red')    signal = 'exit';
            if (sig?.signalType === 'yellow') signal = 'warning';

            return {
              symbol:            r.symbol,
              dayChangePercent:  live?.dayChangePercent ?? 0,
              totalPnlPercent:   live?.totalPnlPercent  ?? 0,
              rank:              r.isUnranked ? null : r.rank,
              signal,
              signalReason: sig
                ? signalReason({
                    byFilter:       sig.byFilter,
                    by50Dma:        sig.by50Dma,
                    byDrawdownWarn: sig.byDrawdownWarn,
                    byDrawdown:     sig.byDrawdown,
                    byRank:         sig.byRank,
                    isBE:           sig.isBE,
                    isUnranked:     sig.isUnranked,
                    rank:           r.isUnranked ? null : r.rank,
                  })
                : undefined,
              drawdownSinceEntry: r.drawdownSinceEntry ?? null,
              asmInfo: r.asmInfo
                ? { type: r.asmInfo.type, stage: r.asmInfo.stage }
                : undefined,
            } satisfies PortfolioHolding;
          });

        // Exit candidates (red signals)
        exits = rows
          .filter((r) => r.exitSignal?.signalType === 'red')
          .map((r) => ({
            symbol:         r.symbol,
            rank:           r.isUnranked ? null : r.rank,
            isUnranked:     r.isUnranked === true,
            byRank:         r.exitSignal!.byRank,
            byFilter:       r.exitSignal!.byFilter,
            by50Dma:        r.exitSignal!.by50Dma,
            byDrawdownWarn: r.exitSignal!.byDrawdownWarn,
            byDrawdown:     r.exitSignal!.byDrawdown,
            isBE:           r.exitSignal!.isBE,
            protected:      r.exitSignal!.protected,
          }));

        // Warning candidates (yellow signals)
        warnings = rows
          .filter((r) => r.exitSignal?.signalType === 'yellow')
          .map((r) => ({
            symbol:         r.symbol,
            rank:           r.isUnranked ? null : r.rank,
            by50Dma:        r.exitSignal!.by50Dma,
            byRank:         r.exitSignal!.byRank,
            byDrawdownWarn: r.exitSignal!.byDrawdownWarn,
            isBE:           r.exitSignal!.isBE,
            protected:      r.exitSignal!.protected,
          }));

        // Build portfolio section using live data + signal counts
        if (liveData) {
          portfolio = await gatherPortfolioSection(liveData, stats.rankBuckets);
          if (portfolio && portfolio.uniqueStats) {
            const portRows = rows.filter((r) => r.inPortfolio);
            portfolio.uniqueStats.nearAthCount = portRows.filter((r) => r.athProximity >= 0.90).length;
            portfolio.uniqueStats.asmSurveillanceCount = portRows.filter((r) => r.asmInfo != null).length;
          }
        }
      } catch (err) {
        reportLogger.error('Screener/exits section failed:', err);
        errors.push(`Screener: ${(err as Error).message}`);
      }
    })(),
  ]);

  try {
    entries = await gatherEntryCandidates(portfolioSymbols);
  } catch (err) {
    reportLogger.error('Entry candidates section failed:', err);
    errors.push(`Entries: ${(err as Error).message}`);
  }

  return { date, portfolio, holdings, market, exits, warnings, entries, aiSummary: null, errors };
}
