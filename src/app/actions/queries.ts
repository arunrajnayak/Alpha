'use server';

import { getPortfolioHoldings, getHistoricalPortfolioHoldings, getLatestPortfolioStats, getDashboardStats, calculatePortfolioXIRR } from '@/lib/finance';
import { getPortfolioExits } from '@/lib/exits';
import { calculateNetCapitalGainsTax } from '@/lib/charges';
import { getTotalDividends } from '@/lib/dividends';
import { prisma } from '@/lib/db';
import { getWeeklySnapshots } from '@/app/actions/snapshots';
import { PortfolioHolding, SectorAllocation } from '@/lib/types';

// ============== Portfolio Queries ==============

export async function fetchPortfolioHoldings() {
  const currentHoldings = await getPortfolioHoldings() as Omit<PortfolioHolding, 'priceHistory'>[];
  const holdingsWithCharts: PortfolioHolding[] = currentHoldings.map(h => ({
    ...h,
    priceHistory: [] // Lazy loaded by LazySparkline component
  }));
  return holdingsWithCharts;
}

export async function fetchHistoricalHoldings() {
  return getHistoricalPortfolioHoldings();
}

// ============== Dashboard Queries ==============

export async function fetchDashboardData() {
  const [
    holdings,
    historicalHoldings,
    portfolioStats,
    dashboardStats,
    snapshots,
    weeklySnapshots,
    monthlySnapshots,
    exits,
    totalDividends,
  ] = await Promise.all([
    getPortfolioHoldings(),
    getHistoricalPortfolioHoldings(),
    getLatestPortfolioStats(),
    getDashboardStats(),
    prisma.dailyPortfolioSnapshot.findMany({ orderBy: { date: 'asc' } }),
    getWeeklySnapshots(),
    prisma.monthlyPortfolioSnapshot.findMany({ orderBy: { date: 'asc' } }),
    getPortfolioExits(),
    getTotalDividends().catch(() => 0), // graceful fallback before migration
  ]);

  const totalCurrentValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const costBasis = holdings.reduce((sum, h) => sum + h.invested, 0);
  const latestSnapshot = snapshots[snapshots.length - 1];
  // Net invested capital from latest daily snapshot (matches /snapshots table and chart)
  const totalInvested = latestSnapshot?.investedCapital ?? costBasis;
  const totalPnL = historicalHoldings.reduce((sum, h) => sum + h.totalPnl, 0);
  const totalRealizedPnL = historicalHoldings.reduce((sum, h) => sum + h.realizedPnl, 0);
  const totalUnrealizedPnL = historicalHoldings.reduce((sum, h) => sum + h.unrealizedPnl, 0);
  
  const xirrValue = await calculatePortfolioXIRR(totalCurrentValue);

  const chartData = snapshots.map((s) => ({
    date: s.date,
    portfolioNAV: s.portfolioNAV,
    niftyNAV: s.niftyNAV,
    nifty500Momentum50NAV: s.nifty500Momentum50NAV,
    niftyMidcap100NAV: s.niftyMidcap100NAV,
    niftySmallcap250NAV: s.niftySmallcap250NAV,
    niftyMicrocap250NAV: s.niftyMicrocap250NAV,
    investedCapital: s.investedCapital,
    totalEquity: s.totalEquity,
    dailyPnL: s.dailyPnL,
    dailyReturn: s.dailyReturn,
    drawdown: s.drawdown,
    xirr: s.xirr,
    cagr: s.cagr,
  }));

  const dashboardHistory = chartData.map(d => ({
    date: typeof d.date === 'string' ? d.date : d.date.toISOString(),
    drawdown: d.drawdown ?? 0,
    totalEquity: d.totalEquity,
    portfolioNAV: d.portfolioNAV
  }));

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

  return {
    holdings,
    historicalHoldings,
    portfolioStats,
    dashboardStats,
    chartData,
    dashboardHistory,
    weeklySnapshots,
    monthlySnapshots,
    exits,
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
