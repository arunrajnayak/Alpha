'use client';

import { memo } from 'react';
import type { ScreenerStats } from '@/app/actions/screener';

interface StatsBarProps {
  stats: ScreenerStats;
  activeTab: 'all' | 'prefiltered' | 'portfolio';
  onTabChange: (tab: 'all' | 'prefiltered' | 'portfolio') => void;
  filteredCount: number;
  hidePortfolio: boolean;
  onHidePortfolioChange: (val: boolean) => void;
  hideWarnings: boolean;
  onHideWarningsChange: (val: boolean) => void;
  signalFilter: 'hold' | 'warning' | 'exit' | null;
  onSignalFilterChange: (val: 'hold' | 'warning' | 'exit' | null) => void;
}

export default memo(function StatsBar({
  stats,
  activeTab,
  onTabChange,
  filteredCount,
  hidePortfolio,
  onHidePortfolioChange,
  hideWarnings,
  onHideWarningsChange,
  signalFilter,
  onSignalFilterChange,
}: StatsBarProps) {
  const { total, allTotal, portfolioCount, rankedPortfolioCount, rankBuckets, mcapBreakdown } = stats;
  const totalMcap = mcapBreakdown.large + mcapBreakdown.mid + mcapBreakdown.small + mcapBreakdown.micro;

  const tabs = [
    { key: 'all' as const,         label: 'All',          count: allTotal },
    { key: 'prefiltered' as const, label: 'Pre-filtered', count: total },
    { key: 'portfolio' as const,   label: 'Portfolio',    count: portfolioCount },
  ];

  const handleStatClick = (type: 'hold' | 'warning' | 'exit') => {
    if (signalFilter === type) {
      onSignalFilterChange(null);
    } else {
      onSignalFilterChange(type);
    }
  };

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 w-full md:h-12">
      {/* Left side: Tabs */}
      <div className="flex items-center gap-1 bg-slate-800/50 border border-white/5 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label} <span className="text-gray-500 ml-0.5">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Right side: Switch or Portfolio Stats */}
      <div className="flex flex-wrap items-center gap-4 text-[11px]">
        {/* Pre-filtered switches: Hide Portfolio & Hide Warnings */}
        {activeTab === 'prefiltered' && (
          <>
            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-gray-400 hover:text-gray-200 transition-colors py-1">
              <input
                type="checkbox"
                checked={hidePortfolio}
                onChange={(e) => onHidePortfolioChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="relative w-8 h-4 bg-slate-850 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-emerald-400 after:content-[''] after:absolute after:top-[1px] after:start-[1px] after:bg-gray-500 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500/20 border border-white/10 peer-checked:border-emerald-500/30"></div>
              <span>Hide Portfolio Stocks</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-gray-400 hover:text-gray-200 transition-colors py-1">
              <input
                type="checkbox"
                checked={hideWarnings}
                onChange={(e) => onHideWarningsChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="relative w-8 h-4 bg-slate-850 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:bg-amber-400 after:content-[''] after:absolute after:top-[1px] after:start-[1px] after:bg-gray-500 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500/20 border border-white/10 peer-checked:border-amber-500/30"></div>
              <span>Hide Warning Stocks</span>
            </label>
          </>
        )}

        {/* Portfolio rank distribution + Market cap breakdown — rendered only for portfolio tab */}
        {activeTab === 'portfolio' && (
          <div className="flex items-center gap-4 text-[11px]">
            {/* Portfolio rank buckets */}
            <div className="flex items-center gap-2 bg-slate-800/30 border border-white/5 rounded-lg p-1">
              <StatPill
                label="HOLD"
                value={rankBuckets.hold}
                color="text-emerald-400"
                isActive={signalFilter === 'hold'}
                onClick={() => handleStatClick('hold')}
              />
              <StatPill
                label="WARN"
                value={rankBuckets.warning}
                color="text-yellow-400"
                isActive={signalFilter === 'warning'}
                onClick={() => handleStatClick('warning')}
              />
              <StatPill
                label="EXIT"
                value={rankBuckets.exit}
                color="text-red-400"
                isActive={signalFilter === 'exit'}
                onClick={() => handleStatClick('exit')}
              />
            </div>

            {/* Market cap breakdown */}
            <div className="hidden md:flex items-center gap-4 bg-slate-800/30 border border-white/5 rounded-lg px-4 py-1.5">
              <McapPill label="LARGE" value={mcapBreakdown.large} total={totalMcap} color="text-blue-400" />
              <McapPill label="MID" value={mcapBreakdown.mid} total={totalMcap} color="text-yellow-400" />
              <McapPill label="SMALL" value={mcapBreakdown.small} total={totalMcap} color="text-green-400" />
              <McapPill label="MICRO" value={mcapBreakdown.micro} total={totalMcap} color="text-purple-400" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function StatPill({
  label,
  value,
  color,
  isActive,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-all cursor-pointer border border-transparent select-none outline-none ${
        isActive
          ? 'bg-slate-700/60 border-white/10 shadow-inner scale-[1.03]'
          : 'hover:bg-slate-800/60 hover:border-white/5'
      }`}
    >
      <span className="text-gray-500 font-medium uppercase tracking-wider" style={{ fontSize: '9px' }}>{label}</span>
      <span className={`text-xl font-black tabular-nums leading-none ${color}`}>{value}</span>
    </button>
  );
}

function McapPill({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-gray-500 font-medium uppercase tracking-wider" style={{ fontSize: '9px' }}>{label}</span>
      <span className={`text-xl font-black tabular-nums leading-none ${color}`}>{pct}%</span>
    </div>
  );
}
