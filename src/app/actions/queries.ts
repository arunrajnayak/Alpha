'use server';

import { getPortfolioHoldings, getHistoricalPortfolioHoldings, getLatestPortfolioStats, getDashboardStats, calculatePortfolioXIRR } from '@/lib/finance';
import { getPortfolioExits } from '@/lib/exits';
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
    exits
  ] = await Promise.all([
    getPortfolioHoldings(),
    getHistoricalPortfolioHoldings(),
    getLatestPortfolioStats(),
    getDashboardStats(),
    prisma.dailyPortfolioSnapshot.findMany({ orderBy: { date: 'asc' } }),
    getWeeklySnapshots(),
    prisma.monthlyPortfolioSnapshot.findMany({ orderBy: { date: 'asc' } }),
    getPortfolioExits()
  ]);

  const totalCurrentValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalInvested = holdings.reduce((sum, h) => sum + h.invested, 0);
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
    drawdown: s.drawdown
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
    totalPnL,
    totalRealizedPnL,
    totalUnrealizedPnL,
    xirrValue,
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
