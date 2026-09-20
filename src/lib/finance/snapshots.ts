import { prisma } from '@/lib/db';
import { startOfDay, format, differenceInDays, subYears, subDays } from 'date-fns';
import { unstable_cache, revalidateTag } from 'next/cache';
import { financeLogger } from '@/lib/logger';
import { istDateParts, istDayOfWeek } from '@/lib/tz';
import { getPortfolioHoldings, computeMarketCapSegmentation } from './holdings';
import { computePortfolioState } from './recalculation';
import { roundPercent, roundEquity, roundPrice } from '../precision-utils';
import { SectorAllocation } from '../types';

export async function getDashboardHistory(days?: number) {
    // Only apply date filter if days is provided
    let whereClause = {};

    if (days) {
        const today = new Date();
        const startDate = new Date();
        startDate.setDate(today.getDate() - days);
        whereClause = {
            date: {
                gte: startDate
            }
        };
    }

    const snapshots = await prisma.dailyPortfolioSnapshot.findMany({
        where: whereClause,
        orderBy: {
            date: 'asc'
        },
        select: {
            date: true,
            totalEquity: true,
            portfolioNAV: true,
            drawdown: true
        }
    });

    return snapshots.map(s => ({
        date: s.date.toISOString(), // formatting for Recharts
        totalEquity: s.totalEquity,
        portfolioNAV: s.portfolioNAV,
        drawdown: s.drawdown ?? 0
    }));
}

function computeSectorAllocations(holdings: { quantity: number; currentValue: number; sector?: string | null }[]): SectorAllocation[] {
    const sectorAllocMap = new Map<string, { value: number; count: number }>();
    let totalSectorValue = 0;

    for (const h of holdings) {
        if (h.quantity <= 0.001 || h.currentValue <= 0) continue;
        const sector = h.sector || 'Unknown';
        const existing = sectorAllocMap.get(sector) || { value: 0, count: 0 };
        existing.value += h.currentValue;
        existing.count += 1;
        sectorAllocMap.set(sector, existing);
        totalSectorValue += h.currentValue;
    }

    return Array.from(sectorAllocMap.entries()).map(([sector, data]) => ({
        sector,
        value: roundEquity(data.value),
        count: data.count,
        allocation: roundPercent(totalSectorValue > 0 ? (data.value / totalSectorValue) * 100 : 0),
        dayChangePercent: 0
    })).sort((a, b) => b.value - a.value);
}

export async function captureWeeklySnapshot() {
    financeLogger.info("Capturing Weekly Snapshot...");

    // 1. Get latest Daily Snapshot for TotalEquity/NAV/Invested/Date
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    if (!latestDaily) {
        financeLogger.error("No daily snapshot found. Cannot capture weekly stats.");
        return;
    }

    // Anchor weekly snapshot to Friday (or latest weekday) if latest daily is on a weekend
    let snapshotDate = latestDaily.date;
    const dayOfWeek = snapshotDate.getUTCDay();
    if (dayOfWeek === 6) {
        // Saturday -> move to Friday
        snapshotDate = subDays(snapshotDate, 1);
    } else if (dayOfWeek === 0) {
        // Sunday -> move to Friday
        snapshotDate = subDays(snapshotDate, 2);
    }

    // Fetch the daily snapshot for the week-ending date (in case latestDaily was on weekend)
    const dailyForWeek = (snapshotDate.getTime() === latestDaily.date.getTime())
        ? latestDaily
        : (await prisma.dailyPortfolioSnapshot.findFirst({
            where: { date: { lte: snapshotDate } },
            orderBy: { date: 'desc' }
        })) || latestDaily;

    const totalEquity = dailyForWeek.totalEquity;
    const nav = dailyForWeek.portfolioNAV;
    const investedCapital = dailyForWeek.investedCapital;

    // 2. Get Current Holdings
    const holdings = await getPortfolioHoldings();

    // 3. Market Cap Segmentation (using AMFI classifications)
    const mcapResult = await computeMarketCapSegmentation(holdings);
    const { large, mid, small, micro } = mcapResult;

    const stockTotal = large + mid + small + micro;
    const largePct = stockTotal > 0 ? (large / stockTotal) * 100 : 0;
    const midPct = stockTotal > 0 ? (mid / stockTotal) * 100 : 0;
    const smallPct = stockTotal > 0 ? (small / stockTotal) * 100 : 0;
    const microPct = stockTotal > 0 ? (micro / stockTotal) * 100 : 0;

    // 4. Sector Allocation
    const sectorAllocations = computeSectorAllocations(holdings);

    // 5. Performance Stats (Win/Loss, Hold Days) via PortfolioEngine
    const engine = await computePortfolioState(snapshotDate);
    const tradeStats = engine.getTradeStats();

    const winPercent = roundPercent(tradeStats.winPercent);
    const lossPercent = roundPercent(tradeStats.lossPercent);
    const avgWinnerGain = roundPercent(tradeStats.avgWinnerGain);
    const avgLoserLoss = roundPercent(tradeStats.avgLoserLoss);
    const avgHoldingPeriod = Math.round(tradeStats.avgHoldingPeriod * 10) / 10;

    // Stats
    const xirrVal = roundPercent(latestDaily.xirr ?? 0);
    const pnl = roundEquity(totalEquity - investedCapital);

    // Calc Weekly Return
    let weeklyReturn = 0;
    const prevSnapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
        where: { date: { lt: snapshotDate } },
        orderBy: { date: 'desc' }
    });
    if (prevSnapshot && prevSnapshot.nav > 0) {
        weeklyReturn = (nav / prevSnapshot.nav) - 1;
    }

    // Save
    await prisma.weeklyPortfolioSnapshot.upsert({
        where: { date: snapshotDate },
        update: {
             totalEquity: roundEquity(totalEquity),
             nav: roundPrice(nav),
             weeklyReturn: roundPercent(weeklyReturn),
             largeCapPercent: roundPercent(largePct),
             midCapPercent: roundPercent(midPct),
             smallCapPercent: roundPercent(smallPct),
             microCapPercent: roundPercent(microPct),

             marketCap: 0,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss,
             sectorAllocation: JSON.stringify(sectorAllocations)
        },
        create: {
             date: snapshotDate,
             totalEquity: roundEquity(totalEquity),
             nav: roundPrice(nav),
             weeklyReturn: roundPercent(weeklyReturn),
             largeCapPercent: roundPercent(largePct),
             midCapPercent: roundPercent(midPct),
             smallCapPercent: roundPercent(smallPct),
             microCapPercent: roundPercent(microPct),

             marketCap: 0,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss,
             sectorAllocation: JSON.stringify(sectorAllocations)
        }
    });

    try {
        (revalidateTag as any)('portfolio-data');
        (revalidateTag as any)('dashboard-stats');
    } catch {
        // Ignore cache invalidation errors outside request context
    }

    financeLogger.info("Weekly Snapshot Captured.");
}

export async function captureMonthlySnapshot() {
    financeLogger.info("Capturing Monthly Snapshot...");

    // 1. Get latest Daily Snapshot for TotalEquity/NAV/Date
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    if (!latestDaily) {
        financeLogger.error("No daily snapshot found. Cannot capture monthly stats.");
        return;
    }

    const snapshotDate = latestDaily.date;
    const totalEquity = latestDaily.totalEquity;
    const nav = latestDaily.portfolioNAV;
    const investedCapital = latestDaily.investedCapital;

    // Delete any existing monthly snapshot from the same month to prevent duplicates
    // (recalculation may have created one on a different date within this month)
    const monthStart = new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    await prisma.monthlyPortfolioSnapshot.deleteMany({
        where: { date: { gte: monthStart, lte: monthEnd } }
    });

    // 2. Get Current Holdings
    const holdings = await getPortfolioHoldings();

    // 3. Market Cap Segmentation (using AMFI classifications)
    const mcapResult = await computeMarketCapSegmentation(holdings);
    const { large, mid, small, micro } = mcapResult;

    const stockTotal = large + mid + small + micro;
    const largePct = stockTotal > 0 ? (large / stockTotal) * 100 : 0;
    const midPct = stockTotal > 0 ? (mid / stockTotal) * 100 : 0;
    const smallPct = stockTotal > 0 ? (small / stockTotal) * 100 : 0;
    const microPct = stockTotal > 0 ? (micro / stockTotal) * 100 : 0;

    // 4. Sector Allocation
    const sectorAllocations = computeSectorAllocations(holdings);

    // 5. Performance Stats (Win/Loss, Hold Days, Exits) via PortfolioEngine
    const engine = await computePortfolioState(snapshotDate);
    const tradeStats = engine.getTradeStats();

    const winPercent = roundPercent(tradeStats.winPercent);
    const lossPercent = roundPercent(tradeStats.lossPercent);
    const avgWinnerGain = roundPercent(tradeStats.avgWinnerGain);
    const avgLoserLoss = roundPercent(tradeStats.avgLoserLoss);
    const avgHoldingPeriod = Math.round(tradeStats.avgHoldingPeriod * 10) / 10;

    // Monthly exits
    const monthExits = engine.closedTrades.filter(
        t => t.date >= monthStart && t.date <= monthEnd
    ).length;

    // Calculate active months
    const firstTx = await prisma.transaction.findFirst({
        orderBy: { date: 'asc' },
        select: { date: true }
    });
    const startYear = firstTx ? firstTx.date.getUTCFullYear() : snapshotDate.getUTCFullYear();
    const startMonth = firstTx ? firstTx.date.getUTCMonth() : snapshotDate.getUTCMonth();
    const monthsActive = Math.max(1, (snapshotDate.getUTCFullYear() - startYear) * 12 + (snapshotDate.getUTCMonth() - startMonth) + 1);
    const calculatedAvgExits = tradeStats.closedTradesCount / monthsActive;
    const avgExitsPerMonth = Math.round(calculatedAvgExits * 10) / 10;

    const xirrVal = roundPercent(latestDaily.xirr ?? 0);
    const pnl = roundEquity(totalEquity - investedCapital);

    // Calc Monthly Return
    let monthlyReturn = 0;
    const prevSnapshot = await prisma.monthlyPortfolioSnapshot.findFirst({
        where: { date: { lt: monthStart } },
        orderBy: { date: 'desc' }
    });
    if (prevSnapshot && prevSnapshot.nav > 0) {
        monthlyReturn = (nav / prevSnapshot.nav) - 1;
    }

    await prisma.monthlyPortfolioSnapshot.upsert({
        where: { date: snapshotDate },
        update: {
             totalEquity: roundEquity(totalEquity),
             nav: roundPrice(nav),
             monthlyReturn: roundPercent(monthlyReturn),
             largeCapPercent: roundPercent(largePct),
             midCapPercent: roundPercent(midPct),
             smallCapPercent: roundPercent(smallPct),
             microCapPercent: roundPercent(microPct),
             marketCap: 0,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss,
             exitCount: monthExits,
             avgExitsPerMonth,
             sectorAllocation: JSON.stringify(sectorAllocations)
        },
        create: {
             date: snapshotDate,
             totalEquity: roundEquity(totalEquity),
             nav: roundPrice(nav),
             monthlyReturn: roundPercent(monthlyReturn),
             largeCapPercent: roundPercent(largePct),
             midCapPercent: roundPercent(midPct),
             smallCapPercent: roundPercent(smallPct),
             microCapPercent: roundPercent(microPct),
             marketCap: 0,
             xirr: xirrVal,
             pnl,
             winPercent,
             lossPercent,
             avgHoldingPeriod,
             avgWinnerGain,
             avgLoserLoss,
             exitCount: monthExits,
             avgExitsPerMonth,
             sectorAllocation: JSON.stringify(sectorAllocations)
        }
    });

    try {
        (revalidateTag as any)('portfolio-data');
        (revalidateTag as any)('dashboard-stats');
    } catch {
        // Ignore cache invalidation errors outside request context
    }

    financeLogger.info("Monthly Snapshot Captured.");
}

// Get latest portfolio stats for dashboard
async function getLatestPortfolioStatsInternal() {
    const snapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    if (!snapshot) {
        return {
            largeCapPercent: 0,
            midCapPercent: 0,
            smallCapPercent: 0,
            microCapPercent: 0,
            winPercent: 0,
            lossPercent: 0,
            avgHoldingPeriod: 0,
            avgWinnerGain: 0,
            avgLoserLoss: 0
        };
    }

    return {
        largeCapPercent: snapshot.largeCapPercent || 0,
        midCapPercent: snapshot.midCapPercent || 0,
        smallCapPercent: snapshot.smallCapPercent || 0,
        microCapPercent: snapshot.microCapPercent || 0,
        winPercent: snapshot.winPercent || 0,
        lossPercent: 100 - (snapshot.winPercent || 0), // Losers = 100 - Winners
        avgHoldingPeriod: snapshot.avgHoldingPeriod || 0,
        avgWinnerGain: snapshot.avgWinnerGain || 0,
        avgLoserLoss: snapshot.avgLoserLoss || 0
    };
}

export const getLatestPortfolioStats = unstable_cache(
    getLatestPortfolioStatsInternal,
    ['portfolio-latest-stats'],
    { tags: ['portfolio-data'], revalidate: 300 }
);

// Get dashboard stats (NAV, DD, returns)
async function getDashboardStatsInternal() {
    // Get latest daily snapshot for NAV and DD
    const latestDaily = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // Get latest weekly snapshot for weekly return
    // If we're at the start of a new week (Monday-Thursday) and the latest weekly snapshot
    // is from this week with 0 return, show the previous week's data instead.
    // Anchor to the IST trading week so this branch fires on the right day even
    // when the server runs in UTC.
    const today = new Date();
    const dayOfWeek = istDayOfWeek(today); // 0 = Sunday, 1 = Monday, ..., 5 = Friday

    let weeklySnapshotToUse = await prisma.weeklyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // If it's Monday (1) through Thursday (4) and the latest snapshot is from this week with 0 return
    // Or if it's Friday but the snapshot is from today (just created)
    if (weeklySnapshotToUse && dayOfWeek >= 1 && dayOfWeek <= 4) {
        const snapshotDate = new Date(weeklySnapshotToUse.date);
        const daysSinceSnapshot = differenceInDays(today, snapshotDate);

        // If the snapshot is from this week (less than 7 days old) and return is 0,
        // fetch the previous week's snapshot
        if (daysSinceSnapshot < 7 && Math.abs(weeklySnapshotToUse.weeklyReturn ?? 0) < 0.0001) {
            const previousWeekSnapshot = await prisma.weeklyPortfolioSnapshot.findFirst({
                where: { date: { lt: snapshotDate } },
                orderBy: { date: 'desc' }
            });
            if (previousWeekSnapshot) {
                weeklySnapshotToUse = previousWeekSnapshot;
            }
        }
    }

    // Get latest monthly snapshot for monthly return
    const latestMonthly = await prisma.monthlyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    // Calculate YTD return: from first daily snapshot of current year (IST).
    const currentYear = istDateParts().year;
    const startOfYear = new Date(Date.UTC(currentYear, 0, 1));

    const firstOfYear = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: { gte: startOfYear } },
        orderBy: { date: 'asc' }
    });

    let yearReturn = 0;
    if (firstOfYear && latestDaily && firstOfYear.portfolioNAV > 0) {
        yearReturn = ((latestDaily.portfolioNAV / firstOfYear.portfolioNAV) - 1) * 100;
    }

    // Calculate 1Y return: from snapshot ~1 year ago
    const oneYearAgo = subYears(new Date(), 1);
    const oneYearSnapshot = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: { gte: oneYearAgo } },
        orderBy: { date: 'asc' }
    });

    let oneYearReturn = 0;
    if (oneYearSnapshot && latestDaily && oneYearSnapshot.portfolioNAV > 0) {
        oneYearReturn = ((latestDaily.portfolioNAV / oneYearSnapshot.portfolioNAV) - 1) * 100;
    }

    return {
        currentNAV: latestDaily?.portfolioNAV || 0,
        currentDD: (latestDaily?.drawdown || 0) * 100,
        weekReturn: (weeklySnapshotToUse?.weeklyReturn || 0) * 100,
        monthReturn: (latestMonthly?.monthlyReturn || 0) * 100,
        yearReturn,
        oneYearReturn
    };
}

export const getDashboardStats = unstable_cache(
    getDashboardStatsInternal,
    ['dashboard-stats'],
    { tags: ['portfolio-data'], revalidate: 300 }
);

/**
 * Capture a holiday snapshot by cloning the previous day's data.
 * Used when the market is closed to avoid unnecessary recalculation.
 */
export async function captureHolidaySnapshot(date: Date = new Date()) {
    const today = startOfDay(date);

    // Check if snapshot already exists for today
    const existing = await prisma.dailyPortfolioSnapshot.findFirst({
        where: { date: today }
    });

    if (existing) {
        financeLogger.info(`[Snapshot] Snapshot for ${format(today, 'yyyy-MM-dd')} already exists. Skipping holiday clone.`);
        return;
    }

    // Get latest available snapshot
    const latest = await prisma.dailyPortfolioSnapshot.findFirst({
        orderBy: { date: 'desc' }
    });

    if (!latest) {
        financeLogger.warn('[Snapshot] No previous snapshot found to clone.');
        return;
    }

    financeLogger.info(`[Snapshot] Cloning snapshot from ${format(latest.date, 'yyyy-MM-dd')} for Holiday/Closed Market (${format(today, 'yyyy-MM-dd')})`);

    // Create new snapshot with same values but today's date
    await prisma.dailyPortfolioSnapshot.create({
        data: {
            date: today,
            totalEquity: latest.totalEquity,
            investedCapital: latest.investedCapital,
            portfolioNAV: latest.portfolioNAV,
            niftyNAV: latest.niftyNAV,
            units: latest.units,

            // Zero out daily changes
            cashflow: 0,
            dailyPnL: 0,
            dailyReturn: 0,

            // Carry over risk metrics
            drawdown: latest.drawdown,
            navMA200: latest.navMA200,
            xirr: latest.xirr,
            cagr: latest.cagr,

            // Carry over index benchmarks
            nifty500Momentum50NAV: latest.nifty500Momentum50NAV,
            niftyMicrocap250NAV: latest.niftyMicrocap250NAV,
            niftyMidcap100NAV: latest.niftyMidcap100NAV,
            niftySmallcap250NAV: latest.niftySmallcap250NAV
        }
    });

    // Also revalidate paths
     
    (revalidateTag as any)('portfolio-data', 'max');
     
    (revalidateTag as any)('dashboard-stats', 'max');
}
