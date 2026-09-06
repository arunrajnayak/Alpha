'use client';

import { useDashboardData } from '@/hooks/useQueries';
import { useMemo } from 'react';
import { useLiveData } from '@/context/LiveDataContext';
import { 
  faRocket,
  faArrowTrendDown,
  faChartPie,
  faBullseye
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { MainChartCards, PnLSummaryCard, MetricsComboCard } from '@/components/portfolio/SummaryCards';
import { WinLossCard, AvgHoldingCard, AvgGainLossCard } from '@/components/portfolio/PortfolioStatsCards';
import MarketCapCard from '@/components/portfolio/MarketCapCard';
import ReturnsCard from '@/components/portfolio/ReturnsCard';
import { APP_CONFIG } from '@/lib/client-config';
import { ChartErrorBoundary } from '@/components/ui/ErrorBoundary';
import dynamic from 'next/dynamic';

import SectorAllocationWrapper from '@/components/portfolio/SectorAllocationWrapper';
import MarketCapAreaChart from '@/components/portfolio/MarketCapAreaChartWrapper';
import SectorHistoryChart from '@/components/portfolio/SectorHistoryChartWrapper';

// Heavy chart components — lazy loaded to avoid blocking initial page render
const DrawdownChart = dynamic(() => import('@/components/portfolio/DrawdownChart'), {
  loading: () => <div className="h-full min-h-[400px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const EquityCurve = dynamic(() => import('@/components/portfolio/EquityCurve'), {
  loading: () => <div className="h-[400px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const DailyPnLChart = dynamic(() => import('@/components/portfolio/DailyPnLChart'), {
  loading: () => <div className="h-[300px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const RollingReturnsChart = dynamic(() => import('@/components/portfolio/RollingReturnsChart'), {
  loading: () => <div className="h-[400px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const PerformanceHeatmap = dynamic(() => import('@/components/portfolio/CalendarHeatmap'), {
  loading: () => <div className="h-[280px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const MonthlyReturnsHeatmap = dynamic(() => import('@/components/portfolio/MonthlyReturnsHeatmap'), {
  loading: () => <div className="h-[280px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const ExitsScatterChart = dynamic(() => import('@/components/exits/ExitsScatterChart'), {
  loading: () => <div className="h-[500px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const InvestedVsCurrentChart = dynamic(() => import('@/components/portfolio/InvestedVsCurrentChart'), {
  loading: () => <div className="h-[400px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});
const XirrCagrChart = dynamic(() => import('@/components/portfolio/XirrCagrChart'), {
  loading: () => <div className="h-[380px] bg-slate-800/30 rounded-xl animate-pulse" />,
  ssr: false,
});

export default function DashboardPage() {
  const { data, isLoading, isFetching } = useDashboardData();
  const { privacyMode } = useLiveData();

  const drawdownData = useMemo(
    () => (data?.dashboardHistory || []).map(d => ({ date: d.date, drawdown: d.drawdown })),
    [data?.dashboardHistory]
  );

  if (isLoading && !data) {
    return null; // Next.js loading.tsx handles the skeleton
  }

  if (!data) {
    return <div className="text-center py-8 text-gray-400">Failed to load dashboard data</div>;
  }

  const {
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
    isWeekPositive,
    holdings,
  } = data;

  return (
    <div className="flex flex-col gap-4 md:gap-8 pb-8 md:pb-0">
      {/* Background refresh indicator */}
      {isFetching && !isLoading && (
        <div className="fixed top-4 right-4 z-50 bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          Refreshing...
        </div>
      )}
      
      {/* Header Greeting */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap">
          <span className="gradient-text">Hello, {APP_CONFIG.USER_NAME}</span>
        </h1>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isWeekPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>
            <FontAwesomeIcon icon={isWeekPositive ? faRocket : faArrowTrendDown} className="text-sm" />
        </div>
      </div>

      {/* Row 1: Big Cards (Value, NAV, DD) */}
      <div className="flex-none h-auto md:h-[240px]">
        <MainChartCards
           totalCurrentValue={totalCurrentValue}
           totalInvested={totalInvested}
           currentNAV={dashboardStats.currentNAV}
           currentDD={dashboardStats.currentDD}
           dashboardHistory={dashboardHistory}
           privacyMode={privacyMode}
        />
      </div>

      {/* Rows 2+3 combined: 5-col × 2-row grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 md:grid-rows-2 gap-4 md:gap-6 flex-none h-auto md:h-[390px]">

        {/* Card 1 — P/L Summary: col-span-2, row-span-2 */}
        <div className="md:col-span-2 md:row-span-2 h-full min-h-[240px] md:min-h-0">
          <PnLSummaryCard
            realizedPnL={totalRealizedPnL}
            unrealizedPnL={totalUnrealizedPnL}
            totalCharges={totalCharges}
            totalTax={totalTax}
            dividends={totalDividends}
            privacyMode={privacyMode}
          />
        </div>

        {/* Card 2 — Metrics Combo (XIRR+CAGR+Alpha): col-span-2, row-span-2 */}
        <div className="md:col-span-2 md:row-span-2 h-full min-h-[280px] md:min-h-0">
          <MetricsComboCard
            xirrValue={xirrValue}
            cagrValue={cagrValue}
            totalCharges={totalCharges}
            totalTax={totalTax}
            totalInvested={totalInvested}
            totalDividends={totalDividends}
            niftyCagr={niftyCagr}
            nifty500M50Cagr={nifty500M50Cagr}
            niftyMidcapCagr={niftyMidcapCagr}
            niftySmallcapCagr={niftySmallcapCagr}
            privacyMode={privacyMode}
          />
        </div>

        {/* Card 3 — Avg Holding: col 5, row 1 */}
        <div className="md:col-span-1 md:row-span-1 h-full min-h-[150px] md:min-h-0">
          <AvgHoldingCard avgHoldingPeriod={portfolioStats.avgHoldingPeriod} />
        </div>

        {/* Card 4 — Win/Loss: col 5, row 2 */}
        <div className="md:col-span-1 md:row-span-1 h-full min-h-[150px] md:min-h-0">
          <WinLossCard winPercent={portfolioStats.winPercent} lossPercent={portfolioStats.lossPercent} />
        </div>
      </div>

      {/* Row 3: Market Cap, Returns, Avg Gain/Loss */}
      <div className="grid grid-cols-1 md:grid-cols-8 gap-4 md:gap-8 flex-none h-auto md:h-[200px]">
          {/* Market Cap - 3 Cols */}
          <div className="col-span-1 md:col-span-3 h-full">
              <MarketCapCard 
                  largeCapPercent={portfolioStats.largeCapPercent}
                  midCapPercent={portfolioStats.midCapPercent}
                  smallCapPercent={portfolioStats.smallCapPercent}
                  microCapPercent={portfolioStats.microCapPercent}
              />
          </div>

          {/* Returns - 3 Cols */}
          <div className="col-span-1 md:col-span-3 h-full">
              <ReturnsCard
                  weekReturn={dashboardStats.weekReturn}
                  monthReturn={dashboardStats.monthReturn}
                  yearReturn={dashboardStats.yearReturn}
                  oneYearReturn={dashboardStats.oneYearReturn}
                  privacyMode={privacyMode}
              />
          </div>

          {/* Avg Gain/Loss - 2 Cols */}
          <div className="col-span-1 md:col-span-2 h-full">
              <AvgGainLossCard 
                  avgWinnerGain={portfolioStats.avgWinnerGain} 
                  avgLoserLoss={portfolioStats.avgLoserLoss} 
              />
          </div>
      </div>

      {/* Row 4: Sector Allocation & Drawdown Chart */}
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 h-auto flex-none">
          {/* Sector Allocation (40% width) */}
          <div className="w-full md:w-[40%] h-[500px]">
              <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center">
                            <FontAwesomeIcon icon={faChartPie} className="text-violet-400 text-lg" />
                        </div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Sector Allocation</span>
                    </div>
                    <div className="flex-1 min-h-[400px]">
                        <SectorAllocationWrapper allocations={sectorAllocations} privacyMode={privacyMode} />
                    </div>
              </div>
          </div>

          {/* Drawdown Chart (60% width) */}
          <div className="w-full md:w-[60%] h-[500px]">
              <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                    <ChartErrorBoundary componentName="Drawdown Chart">
                      <DrawdownChart data={drawdownData} />
                    </ChartErrorBoundary>
              </div>
          </div>
      </div>

      {/* Row 5: Equity Curve */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Equity Curve">
                       <EquityCurve data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 5.1: XIRR & CAGR Chart */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="XIRR & CAGR Chart">
                       <XirrCagrChart data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 5.5: Invested vs Current Value Chart */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Invested vs Current Chart">
                       <InvestedVsCurrentChart data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 5.6: Daily Gain/Loss Bar Chart */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Daily P&L Chart">
                       <DailyPnLChart data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 5.7: Rolling Returns Chart */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Rolling Returns Chart">
                       <RollingReturnsChart data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 6: Market Cap History */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center">
                        <FontAwesomeIcon icon={faChartPie} className="text-indigo-400 text-lg" />
                    </div>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Market Cap History</span>
                </div>
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Market Cap History">
                       <MarketCapAreaChart data={weeklySnapshots} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 7: Sector History */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Sector History">
                       <SectorHistoryChart data={weeklySnapshots} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 8: Performance Heatmap */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Performance Heatmap">
                       <PerformanceHeatmap data={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 8: Monthly Returns */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Monthly Returns Heatmap">
                       <MonthlyReturnsHeatmap data={chartData} monthlySnapshots={monthlySnapshots} chartData={chartData} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>

      {/* Row 9: Holding Period vs Returns */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center">
                        <FontAwesomeIcon icon={faBullseye} className="text-emerald-400 text-lg" />
                    </div>
                    <div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Holding Period vs Returns</span>
                        <span className="text-[11px] text-gray-500 block">Realized exits and open holdings performance mapped by duration held</span>
                    </div>
                </div>
                <div className="flex-1 min-h-[500px]">
                     <ChartErrorBoundary componentName="Holding Period vs Returns Chart">
                       <ExitsScatterChart exits={exits} holdings={holdings} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>
    </div>
  );
}
