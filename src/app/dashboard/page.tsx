'use client';

import { useDashboardData } from '@/hooks/useQueries';
import { useHasMounted } from '@/hooks/useHasMounted';
import { 
  faRocket,
  faArrowTrendDown,
  faChartPie,
  faBullseye
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { MainChartCards, PnLCard, XirrCard } from '@/components/portfolio/SummaryCards';
import { WinLossCard, AvgHoldingCard, AvgGainLossCard } from '@/components/portfolio/PortfolioStatsCards';
import MarketCapCard from '@/components/portfolio/MarketCapCard';
import ReturnsCard from '@/components/portfolio/ReturnsCard';
import DrawdownChart from '@/components/portfolio/DrawdownChart';
import { APP_CONFIG } from '@/lib/client-config';

import SectorAllocationWrapper from '@/components/portfolio/SectorAllocationWrapper';
import EquityCurve from '@/components/portfolio/EquityCurve';
import PerformanceHeatmap from '@/components/portfolio/CalendarHeatmap';
import MonthlyReturnsHeatmap from '@/components/portfolio/MonthlyReturnsHeatmap';
import MarketCapAreaChart from '@/components/portfolio/MarketCapAreaChartWrapper';
import SectorHistoryChart from '@/components/portfolio/SectorHistoryChartWrapper';
import ExitsScatterChart from '@/components/exits/ExitsScatterChart';
import DailyPnLChart from '@/components/portfolio/DailyPnLChart';
import { ChartErrorBoundary } from '@/components/ui/ErrorBoundary';

// Loading skeleton component
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 md:gap-8 pb-8 md:pb-0 animate-pulse">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-48 bg-slate-800/50 rounded-xl"></div>
        <div className="w-8 h-8 rounded-full bg-slate-800/50"></div>
      </div>
      
      {/* Row 1: Big Cards */}
      <div className="h-[240px] grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
        <div className="bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="bg-slate-800/50 rounded-2xl border border-white/5"></div>
      </div>
      
      {/* Row 2: Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-8 h-[180px]">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-slate-800/50 rounded-2xl border border-white/5"></div>
        ))}
      </div>
      
      {/* Row 3 */}
      <div className="grid grid-cols-1 md:grid-cols-8 gap-4 md:gap-8 h-[200px]">
        <div className="md:col-span-3 bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="md:col-span-3 bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="md:col-span-2 bg-slate-800/50 rounded-2xl border border-white/5"></div>
      </div>
      
      {/* Charts */}
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 h-[500px]">
        <div className="w-full md:w-[40%] bg-slate-800/50 rounded-2xl border border-white/5"></div>
        <div className="w-full md:w-[60%] bg-slate-800/50 rounded-2xl border border-white/5"></div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isFetching } = useDashboardData();
  const hasMounted = useHasMounted();

  // Show skeleton on server render AND initial client load (before mount + no data)
  if (!hasMounted || (isLoading && !data)) {
    return <DashboardSkeleton />;
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
    totalPnL,
    totalRealizedPnL,
    totalUnrealizedPnL,
    xirrValue,
    isWeekPositive
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
        />
      </div>

      {/* Row 2: Secondary Stats (P/L, XIRR, Holding, Win/Loss) - Equal Widths */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-8 flex-none h-auto md:h-[180px]">
        {/* P/L Card */}
        <div className="col-span-1 h-full">
             <PnLCard 
                totalPnL={totalPnL} 
                realizedPnL={totalRealizedPnL} 
                unrealizedPnL={totalUnrealizedPnL} 
             />
        </div>

        {/* XIRR Card */}
        <div className="col-span-1 h-full">
            <XirrCard xirrValue={xirrValue} />
        </div>

        {/* Avg Holding */}
        <div className="col-span-1 h-full">
            <AvgHoldingCard avgHoldingPeriod={portfolioStats.avgHoldingPeriod} />
        </div>

        {/* Win/Loss Ratio */}
        <div className="col-span-1 h-full">
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
                        <SectorAllocationWrapper allocations={sectorAllocations} privacyMode={false} />
                    </div>
              </div>
          </div>

          {/* Drawdown Chart (60% width) */}
          <div className="w-full md:w-[60%] h-[500px]">
              <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                    <ChartErrorBoundary componentName="Drawdown Chart">
                      <DrawdownChart data={dashboardHistory.map(d => ({ date: d.date, drawdown: d.drawdown }))} />
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

      {/* Row 5.5: Daily Gain/Loss Bar Chart */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex-1">
                     <ChartErrorBoundary componentName="Daily P&L Chart">
                       <DailyPnLChart data={chartData} />
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

      {/* Row 9: Exits Analysis */}
      <div className="w-full h-auto flex-none">
          <div className="h-full bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden flex flex-col glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center">
                        <FontAwesomeIcon icon={faBullseye} className="text-emerald-400 text-lg" />
                    </div>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Exits Analysis</span>
                </div>
                <div className="flex-1 h-[500px]">
                     <ChartErrorBoundary componentName="Exits Scatter Chart">
                       <ExitsScatterChart exits={exits} />
                     </ChartErrorBoundary>
                </div>
          </div>
      </div>
    </div>
  );
}
