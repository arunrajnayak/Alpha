'use server';

import { getPortfolioHoldings, getPortfolioRealizedStats, calculatePortfolioXIRR } from '@/lib/finance';
import { getPortfolioExits } from '@/lib/exits';
import { calculateNetCapitalGainsTax } from '@/lib/charges';
import { getTotalDividends } from '@/lib/dividends';
import { prisma } from '@/lib/db';
import { getWeeklySnapshots } from '@/app/actions/snapshots';
import { PortfolioHolding, SectorAllocation } from '@/lib/types';
import { unstable_cache } from 'next/cache';
import { istDateParts, istDayOfWeek } from '@/lib/tz';
import { differenceInDays, subYears } from 'date-fns';
import { financeLogger } from '@/lib/logger';

// ============== Portfolio Queries ==============

export async function fetchPortfolioHoldings() {
  const currentHoldings = await getPortfolioHoldings({ includeDemergers: true }) as Omit<PortfolioHolding, 'priceHistory'>[];
  const holdingsWithCharts: PortfolioHolding[] = currentHoldings.map(h => ({
    ...h,
    priceHistory: [] // Lazy loaded by LazySparkline component
  }));
  return holdingsWithCharts;
}

export async function fetchHistoricalHoldings() {
  const { getHistoricalPortfolioHoldings } = await import('@/lib/finance');
  return getHistoricalPortfolioHoldings();
}

// ============== Dashboard Queries ==============

async function getDashboardDataInternal() {
  const [
    holdings,
    realizedStats,
    snapshots,
    weeklySnapshots,
    monthlySnapshots,
    exits,
    totalDividends,
  ] = await Promise.all([
    getPortfolioHoldings(),
    getPortfolioRealizedStats(),
    prisma.dailyPortfolioSnapshot.findMany({
      orderBy: { date: 'asc' },
      select: {
        date: true,
        portfolioNAV: true,
        niftyNAV: true,
        nifty500Momentum50NAV: true,
        niftyMidcap100NAV: true,
        niftySmallcap250NAV: true,
        niftyMicrocap250NAV: true,
        investedCapital: true,
        totalEquity: true,
        dailyPnL: true,
        dailyReturn: true,
        drawdown: true,
        xirr: true,
        cagr: true,
      }
    }),
    prisma.weeklyPortfolioSnapshot.findMany({
      orderBy: { date: 'desc' },
      select: {
        date: true,
        largeCapPercent: true,
        midCapPercent: true,
        smallCapPercent: true,
        microCapPercent: true,
        nanoCapPercent: true,
        sectorAllocation: true,
        weeklyReturn: true,
      }
    }),
    prisma.monthlyPortfolioSnapshot.findMany({
      orderBy: { date: 'desc' },
      select: {
        date: true,
        monthlyReturn: true,
      }
    }),
    getPortfolioExits(),
    getTotalDividends().catch(() => 0), // graceful fallback before migration
  ]);

  const totalCurrentValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const costBasis = holdings.reduce((sum, h) => sum + h.invested, 0);
  const latestSnapshot = snapshots[snapshots.length - 1];
  // Net invested capital from latest daily snapshot (matches /snapshots table and chart)
  const totalInvested = latestSnapshot?.investedCapital ?? costBasis;
  const totalRealizedPnL = realizedStats.realizedPnL;
  const totalUnrealizedPnL = totalCurrentValue - costBasis;
  const totalPnL = totalRealizedPnL + totalUnrealizedPnL;
  
  const xirrValue = await calculatePortfolioXIRR(totalCurrentValue);

  const chartData = snapshots;

  // In-memory derivation of dashboardStats (avoids 6 separate DB queries)
  const latestDaily = snapshots[snapshots.length - 1];
  const latestWeekly = weeklySnapshots[0];
  const latestMonthly = monthlySnapshots[0];

  const today = new Date();
  const dayOfWeek = istDayOfWeek(today);

  let weeklySnapshotToUse = latestWeekly;
  if (weeklySnapshotToUse && dayOfWeek >= 1 && dayOfWeek <= 4) {
    const snapshotDate = new Date(weeklySnapshotToUse.date);
    const daysSince = differenceInDays(today, snapshotDate);
    if (daysSince < 7 && Math.abs(weeklySnapshotToUse.weeklyReturn ?? 0) < 0.0001) {
      const prevWeek = weeklySnapshots.find(w => new Date(w.date) < snapshotDate);
      if (prevWeek) {
        weeklySnapshotToUse = prevWeek;
      }
    }
  }

  // Calculate YTD return: from first daily snapshot of current year (IST)
  const currentYear = istDateParts().year;
  const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
  const firstOfYear = snapshots.find(s => new Date(s.date) >= startOfYear);
  let yearReturn = 0;
  if (firstOfYear && latestDaily && firstOfYear.portfolioNAV > 0) {
    yearReturn = ((latestDaily.portfolioNAV / firstOfYear.portfolioNAV) - 1) * 100;
  }

  // Calculate 1Y return: from snapshot ~1 year ago
  const oneYearAgo = subYears(new Date(), 1);
  const oneYearSnapshot = snapshots.find(s => new Date(s.date) >= oneYearAgo);
  let oneYearReturn = 0;
  if (oneYearSnapshot && latestDaily && oneYearSnapshot.portfolioNAV > 0) {
    oneYearReturn = ((latestDaily.portfolioNAV / oneYearSnapshot.portfolioNAV) - 1) * 100;
  }

  const dashboardStats = {
    currentNAV: latestDaily?.portfolioNAV || 0,
    currentDD: (latestDaily?.drawdown || 0) * 100,
    weekReturn: (weeklySnapshotToUse?.weeklyReturn || 0) * 100,
    monthReturn: (latestMonthly?.monthlyReturn || 0) * 100,
    yearReturn,
    oneYearReturn
  };

  // Calculate sector allocations
  const sectorMap = new Map<string, { sector: string, value: number, count: number }>();
  holdings.forEach(h => {
    const sector = h.sector || 'Unknown';
    const existing = sectorMap.get(sector) || { sector, value: 0, count: 0 };
    existing.value += h.currentValue;
    existing.count += 1;
    sectorMap.set(sector, existing);
  });

  const sectorAllocations: SectorAllocation[] = Array.from(sectorMap.values()).map(s => ({
    ...s,
    allocation: totalCurrentValue > 0 ? (s.value / totalCurrentValue) * 100 : 0,
    dayChangePercent: 0
  })).sort((a, b) => b.value - a.value);

  const cagrValue = latestSnapshot && latestSnapshot.cagr != null ? latestSnapshot.cagr * 100 : null;

  let niftyCagr: number | null = null;
  let nifty500M50Cagr: number | null = null;
  let niftyMidcapCagr: number | null = null;
  let niftySmallcapCagr: number | null = null;

  if (snapshots.length > 0 && latestSnapshot) {
    const firstSnapshot = snapshots[0];
    const d1 = new Date(firstSnapshot.date);
    const d2 = new Date(latestSnapshot.date);
    const daysElapsed = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24)));

    if (latestSnapshot.niftyNAV) {
      niftyCagr = (Math.pow(latestSnapshot.niftyNAV / 100, 365 / daysElapsed) - 1) * 100;
    }
    if (latestSnapshot.nifty500Momentum50NAV) {
      nifty500M50Cagr = (Math.pow(latestSnapshot.nifty500Momentum50NAV / 100, 365 / daysElapsed) - 1) * 100;
    }
    if (latestSnapshot.niftyMidcap100NAV) {
      niftyMidcapCagr = (Math.pow(latestSnapshot.niftyMidcap100NAV / 100, 365 / daysElapsed) - 1) * 100;
    }
    if (latestSnapshot.niftySmallcap250NAV) {
      niftySmallcapCagr = (Math.pow(latestSnapshot.niftySmallcap250NAV / 100, 365 / daysElapsed) - 1) * 100;
    }
  }

  // Aggregate charges & net tax from exits (zero extra DB calls)
  // Tax uses portfolio-level netting: losses offset gains before applying rate
  const totalCharges = exits.reduce((sum, e) => sum + (e.chargesBreakdown?.totalCharges ?? 0), 0);
  const { totalTax } = calculateNetCapitalGainsTax(exits.map(e => ({ gainLoss: e.gainLoss, timeHeld: e.timeHeld })));

  // Derive live trade performance metrics directly from exits to ensure 100% consistency across dashboard
  const exitWins = exits.filter(e => e.gainLoss > 0);
  const exitLosses = exits.filter(e => e.gainLoss <= 0);
  const totalExits = exits.length;
  const livePortfolioStats = {
    largeCapPercent: latestWeekly?.largeCapPercent || 0,
    midCapPercent: latestWeekly?.midCapPercent || 0,
    smallCapPercent: latestWeekly?.smallCapPercent || 0,
    microCapPercent: latestWeekly?.microCapPercent || 0,
    nanoCapPercent: latestWeekly?.nanoCapPercent || 0,
    winPercent: totalExits > 0 ? (exitWins.length / totalExits) * 100 : 0,
    lossPercent: totalExits > 0 ? (exitLosses.length / totalExits) * 100 : 0,
    avgWinnerGain: exitWins.length > 0 ? exitWins.reduce((s, e) => s + e.changePercent, 0) / exitWins.length : 0,
    avgLoserLoss: exitLosses.length > 0 ? exitLosses.reduce((s, e) => s + e.changePercent, 0) / exitLosses.length : 0,
    avgHoldingPeriod: totalExits > 0 ? exits.reduce((s, e) => s + e.timeHeld, 0) / totalExits : 0,
  };

  // Lean weekly snapshots: only what MarketCapAreaChart & SectorHistoryChart need
  const leanWeeklySnapshots = weeklySnapshots.map(w => {
    let cleanAllocs: { sector: string; allocation: number }[] = [];
    if (w.sectorAllocation) {
      try {
        const parsed = JSON.parse(w.sectorAllocation);
        cleanAllocs = parsed.map((a: any) => ({ sector: a.sector, allocation: a.allocation }));
      } catch {}
    }
    return {
      date: w.date,
      largeCapPercent: w.largeCapPercent,
      midCapPercent: w.midCapPercent,
      smallCapPercent: w.smallCapPercent,
      microCapPercent: w.microCapPercent,
      nanoCapPercent: w.nanoCapPercent,
      sectorAllocation: JSON.stringify(cleanAllocs)
    };
  });

  // Lean monthly snapshots: deduplicate and keep date + monthlyReturn
  const monthlyMap = new Map<string, { date: Date; monthlyReturn: number | null }>();
  for (const m of monthlySnapshots) {
    const d = new Date(m.date);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { date: m.date, monthlyReturn: m.monthlyReturn });
    }
  }
  const leanMonthlySnapshots = Array.from(monthlyMap.values());

  // Prune exits payload (strip heavy breakdown objects to reduce payload size)
  const clientExits = exits.map(e => ({
    id: e.id,
    symbol: e.symbol,
    sellDate: e.sellDate,
    buyDate: e.buyDate,
    buyPrice: e.buyPrice,
    sellPrice: e.sellPrice,
    changePercent: e.changePercent,
    gainLoss: e.gainLoss,
    timeHeld: e.timeHeld,
    marketCapCategory: e.marketCapCategory,
    netGainLoss: e.netGainLoss,
    quantity: e.quantity,
  }));

  // Prune holdings payload for ExitsScatterChart
  const clientHoldings = holdings.map(h => ({
    symbol: h.symbol,
    quantity: h.quantity,
    invested: h.invested,
    currentValue: h.currentValue,
    price: h.price,
    pnl: h.pnl,
    pnlPercent: h.pnlPercent,
    marketCap: h.marketCap,
    marketCapCategory: h.marketCapCategory,
    sector: h.sector,
    holdingPeriodDays: h.holdingPeriodDays,
  }));

  return {
    holdings: clientHoldings,
    portfolioStats: livePortfolioStats,
    dashboardStats,
    chartData,
    weeklySnapshots: leanWeeklySnapshots,
    monthlySnapshots: leanMonthlySnapshots,
    exits: clientExits,
    sectorAllocations,
    totalCurrentValue,
    totalInvested,
    costBasis,
    totalPnL,
    totalRealizedPnL,
    totalUnrealizedPnL,
    totalCharges,
    totalTax,
    totalDividends,
    xirrValue,
    cagrValue,
    niftyCagr,
    nifty500M50Cagr,
    niftyMidcapCagr,
    niftySmallcapCagr,
    isWeekPositive: dashboardStats.weekReturn >= 0
  };
}

const getCachedDashboardData = unstable_cache(
  getDashboardDataInternal,
  ['dashboard-data-v2'],
  { revalidate: 60, tags: ['portfolio-data', 'dashboard-stats'] }
);

export async function fetchDashboardData() {
  try {
    return await getCachedDashboardData();
  } catch (error) {
    financeLogger.warn('Failed to get cached dashboard data, falling back to direct fetch:', error);
    return getDashboardDataInternal();
  }
}

// ============== Trades Queries ==============

export async function fetchTransactions() {
  return prisma.transaction.findMany({
    orderBy: { date: 'desc' }
  });
}

export async function fetchSymbolMappings() {
  const mappings = await prisma.symbolMapping.findMany();
  return mappings.reduce((acc: Record<string, string>, curr) => {
    acc[curr.oldSymbol] = curr.newSymbol;
    return acc;
  }, {} as Record<string, string>);
}

// ============== Exits Queries ==============

export async function fetchPortfolioExits() {
  return getPortfolioExits();
}

// ============== Snapshot Queries ==============

export async function fetchDailySnapshots() {
  return prisma.dailyPortfolioSnapshot.findMany({
    orderBy: { date: 'desc' }
  });
}

export async function fetchWeeklySnapshots() {
  return getWeeklySnapshots();
}
