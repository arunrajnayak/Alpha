'use client';

import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import Link from 'next/link';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LogoutIcon from '@mui/icons-material/Logout';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import StatsBar from './StatsBar';
import RulesInfoModal from './RulesInfoModal';
import RankHistoryModal from './RankHistoryModal';
import StockChartModal from '@/components/chart/StockChartModal';
import { getScreenerData, syncScreener, getRankHistoriesBatch, type ScreenerRow, type ScreenerStats } from '@/app/actions/screener';

interface ScreenerClientProps {
  initialData: { rows: ScreenerRow[]; stats: ScreenerStats };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMcap(cr: number): string {
  if (!cr || cr <= 0) return '—';
  return Math.round(cr).toLocaleString('en-IN');
}

const MCAP_BADGE: Record<string, { label: string; cls: string }> = {
  'Large Cap': { label: 'Large', cls: 'text-blue-400' },
  'Large':     { label: 'Large', cls: 'text-blue-400' },
  'Mid Cap':   { label: 'Mid',   cls: 'text-orange-400' },
  'Mid':       { label: 'Mid',   cls: 'text-orange-400' },
  'Small Cap': { label: 'Small', cls: 'text-cyan-400' },
  'Small':     { label: 'Small', cls: 'text-cyan-400' },
  'Micro Cap': { label: 'Micro', cls: 'text-amber-400' },
  'Micro':     { label: 'Micro', cls: 'text-amber-400' },
};

function getRankAccent(rank: number, inPortfolio: boolean, isPrefiltered: boolean = false): string {
  if (isPrefiltered) {
    if (rank <= 30) return 'rgb(34,197,94)';
    if (rank <= 50) return 'rgb(234,179,8)';
    return 'rgba(239,68,68,0.6)';
  }
  if (inPortfolio) return 'rgb(99,102,241)';
  if (rank <= 50) return 'rgb(34,197,94)';
  return 'rgba(239,68,68,0.6)';
}

function getRankTextColor(rank: number, isPrefiltered: boolean = false): string {
  if (isPrefiltered) {
    if (rank <= 30) return 'text-green-400';
    if (rank <= 50) return 'text-yellow-400';
    return 'text-red-400';
  }
  if (rank <= 50) return 'text-green-400';
  return 'text-red-400';
}

// ─── Badge Tooltip ───────────────────────────────────────────────────────────

interface BadgeTooltipProps {
  label: string;
  badgeCls: string;
  lines: string[];
  icon?: React.ReactNode;
  iconOnly?: boolean;
}

function BadgeTooltip({ label, badgeCls, lines, icon, iconOnly }: BadgeTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const reposition = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left });
  }, []);

  const handleEnter = useCallback(() => {
    reposition();
    setOpen(true);
  }, [reposition]);

  const handleLeave = useCallback(() => setOpen(false), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const tooltip = open && pos && lines.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
        >
          <div
            className="rounded-xl border border-zinc-700/60 bg-zinc-950/95 backdrop-blur-md shadow-2xl overflow-hidden"
            style={{ minWidth: '200px', maxWidth: '300px', boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)' }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-zinc-800/80 flex items-center gap-1.5">
              {icon && <span className="text-zinc-400 flex items-center">{icon}</span>}
              <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: 'inherit' }}>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold tracking-wider ${badgeCls.includes('bg-') ? badgeCls : `border ${badgeCls} bg-zinc-800/60`}`}>{label}</span>
              </span>
            </div>
            {/* Lines */}
            <div className="px-3 py-2.5 flex flex-col gap-2">
              {lines.map((line, i) => {
                const isAsm = line.startsWith('⚠');
                const isLock = line.startsWith('🔒');
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                      isLock ? 'bg-amber-400' : isAsm ? 'bg-orange-400' : 'bg-zinc-500'
                    }`} />
                    <span className={`text-[11px] leading-snug ${
                      isLock ? 'text-amber-300' : isAsm ? 'text-orange-300' : 'text-zinc-300'
                    }`}>{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Arrow */}
          <div className="ml-3 w-2.5 h-2.5 rotate-45 -mt-1.5 bg-zinc-950 border-b border-r border-zinc-700/60" />
        </div>,
        document.body
      )
    : null;

  return (
    <span
      ref={ref}
      className="relative inline-flex shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={e => { e.stopPropagation(); reposition(); setOpen(v => !v); }}
    >
      {iconOnly ? (
        <button
          type="button"
          className={`p-0.5 flex items-center justify-center cursor-pointer transition-colors ${badgeCls}`}
          title={label}
          aria-label={label}
        >
          {icon}
        </button>
      ) : (
        <span
          className={`text-[9px] px-1.5 h-4 rounded border leading-none flex items-center gap-0.5 font-extrabold tracking-wider cursor-pointer ${badgeCls}`}
        >
          {icon}
          {label}
        </span>
      )}
      {tooltip}
    </span>
  );
}

// ─── Price Sparkline ─────────────────────────────────────────────────────────

function buildSparklinePath(data: number[], w: number, h: number): string | null {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - pad * 2) + pad;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return 'M ' + pts.join(' L ');
}

const Sparkline = memo(function Sparkline({ data }: { data: number[] }) {
  const w = 240, h = 36;
  const path = buildSparklinePath(data, w, h);
  if (!path) return <span className="text-zinc-600 text-xs">—</span>;
  const isUp = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={path} fill="none" stroke={isUp ? '#10b981' : '#f43f5e'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

// ─── DMA Swatches (5 dots: 10/20/50/100/200) ────────────────────────────────

const DMA_PERIODS = [10, 20, 50, 100, 200] as const;

const DMASwatches = memo(function DMASwatches({ swatches }: { swatches: ScreenerRow['dmaSwatches'] }) {
  const vals = [swatches.above10, swatches.above20, swatches.above50, swatches.above100, swatches.above200];
  return (
    <div className="flex gap-0.5">
      {DMA_PERIODS.map((period, i) => (
        <div
          key={period}
          title={`${vals[i] ? 'Above' : 'Below'} ${period} DMA`}
          className={`w-3.5 h-3.5 rounded-sm ${vals[i] ? 'bg-emerald-500' : 'bg-rose-500/70'}`}
        />
      ))}
    </div>
  );
});

// ─── ATH Swatches (5 dots: 10/15/20/25/30%) ────────────────────────────────

const ATH_THRESHOLDS = [10, 15, 20, 25, 30];

const ATHSwatches = memo(function ATHSwatches({ athProximity }: { athProximity: number }) {
  const awayPct = (1 - athProximity) * 100;
  return (
    <div className="flex gap-0.5">
      {ATH_THRESHOLDS.map(t => (
        <div
          key={t}
          title={`${awayPct <= t ? 'Within' : 'Beyond'} ${t}% of ATH (${awayPct.toFixed(1)}% away)`}
          className={`w-3.5 h-3.5 rounded-sm ${awayPct <= t ? 'bg-emerald-500' : 'bg-rose-500/70'}`}
        />
      ))}
    </div>
  );
});

// ─── Table skeleton row ──────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-800/30 animate-pulse">
      <td className="pl-5 pr-2 py-3">
        <div className="h-7 w-7 bg-zinc-800 rounded" />
      </td>
      <td className="px-1 py-3"><div className="h-3 w-5 bg-zinc-800 rounded mx-auto" /></td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-24 bg-zinc-800 rounded" />
          <div className="h-3 w-36 bg-zinc-800/50 rounded" />
        </div>
      </td>
      <td className="px-1 py-3"><div className="h-3.5 w-14 bg-zinc-800 rounded mx-auto" /></td>
      <td className="px-3 py-3 hidden md:table-cell"><div className="h-9 bg-zinc-800/50 rounded" /></td>
      <td className="px-1 py-3"><div className="h-3.5 w-10 bg-zinc-800 rounded mx-auto" /></td>
      <td className="px-2 py-3">
        <div className="flex gap-0.5 justify-center">
          {[...Array(5)].map((_, i) => <div key={i} className="w-3.5 h-3.5 bg-zinc-800 rounded-sm" />)}
        </div>
      </td>
      <td className="px-2 py-3">
        <div className="flex gap-0.5 justify-center">
          {[...Array(5)].map((_, i) => <div key={i} className="w-3.5 h-3.5 bg-zinc-800 rounded-sm" />)}
        </div>
      </td>
      <td className="px-1 py-3"><div className="h-3.5 w-12 bg-zinc-800 rounded mx-auto" /></td>
    </tr>
  );
}

// ─── Table header cell ────────────────────────────────────────────────────────

const TH_BASE = 'px-3 py-4 text-sm font-bold text-zinc-300 uppercase tracking-wider select-none';

function SortHeader({
  field, current, dir, onClick, children, center, pl,
}: {
  field: string; current: string; dir: 'asc' | 'desc';
  onClick: (f: string) => void; children: React.ReactNode; center?: boolean; pl?: string;
}) {
  return (
    <th
      className={`${TH_BASE} cursor-pointer hover:text-zinc-200 transition-colors${pl ? ` ${pl}` : ''}`}
      onClick={() => onClick(field)}
    >
      <span className={`flex items-center gap-0.5 ${center ? 'justify-center' : ''}`}>
        {children}
        {current === field && <span className="text-emerald-400 ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ScreenerClient({ initialData }: ScreenerClientProps) {
  const [rows, setRows] = useState<ScreenerRow[]>(initialData.rows);
  const [stats, setStats] = useState<ScreenerStats>(initialData.stats);
  const [activeTab, setActiveTab] = useState<'all' | 'prefiltered' | 'portfolio'>('portfolio');
  const [hidePortfolio, setHidePortfolio] = useState(true);
  const [signalFilter, setSignalFilter] = useState<'hold' | 'warning' | 'exit' | null>(null);
  const [loading, setLoading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [sortField, setSortField] = useState('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rankHistoryCacheRef = useRef<Record<string, { date: string; rank: number; compositeScore: number }[]>>({});

  const chartRow = useMemo(() => {
    return chartSymbol ? rows.find(r => r.symbol === chartSymbol) : null;
  }, [chartSymbol, rows]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/screener/progress');
        if (res.ok) {
          const json = await res.json();
          if (json.step)     setSyncStep(json.step);
          if (json.progress != null) setSyncProgress(json.progress);
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 2000);
  }, [stopPolling]);

  // Clean up polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const prefetchRankHistories = useCallback(async (tabRows: ScreenerRow[], rType: 'filtered' | 'all') => {
    // Silently pre-load all visible symbols in one DB round-trip
    const syms = tabRows.map(r => r.symbol);
    if (syms.length === 0) return;
    try {
      const batch = await getRankHistoriesBatch(syms, rType);
      rankHistoryCacheRef.current = { ...rankHistoryCacheRef.current, ...batch };
    } catch {
      // non-fatal — modal will fall back to per-symbol fetch
    }
  }, []);

  // Prefetch rank histories for the initial pre-filtered rows (background, non-blocking)
  useEffect(() => {
    prefetchRankHistories(initialData.rows, 'filtered');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // only on mount — initialData is stable

  const handleTabChange = useCallback(async (tab: 'all' | 'prefiltered' | 'portfolio') => {
    setActiveTab(tab);
    setSignalFilter(null);
    setLoading(true);
    try {
      const data = await getScreenerData(tab);
      setRows(data.rows);
      setStats(data.stats);
      const rType = tab === 'all' ? 'all' : 'filtered';
      prefetchRankHistories(data.rows, rType);  // background prefetch — non-blocking
    } finally {
      setLoading(false);
    }
  }, [prefetchRankHistories]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncStep('Starting...');
    setSyncProgress(0);
    startPolling();
    try {
      const result = await syncScreener();
      if (result.success) {
        const data = await getScreenerData(activeTab);
        setRows(data.rows);
        setStats(data.stats);
      }
    } finally {
      stopPolling();
      setSyncing(false);
      setSyncStep(null);
      setSyncProgress(0);
    }
  }, [activeTab, startPolling, stopPolling]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir(field === 'score' || field === 'rankChange' ? 'desc' : 'asc'); }
  };

  const handleExportCSV = () => {
    if (!displayRows.length) return;
    const headers = ['Rank', 'Symbol', 'Company', 'Score', 'Avg Sharpe', 'ATH Proximity', 'Price', '200 DMA %', 'Turnover Cr', 'Market Cap Cr', 'Category', 'Rank Change'];
    const csvRows = displayRows.map(r => [
      r.rank === 9999 ? '' : r.rank,
      r.symbol,
      r.companyName,
      r.compositeScore.toFixed(4),
      r.avgSharpe.toFixed(4),
      r.athProximity.toFixed(4),
      r.currentPrice.toFixed(2),
      r.aboveDma200Pct.toFixed(2),
      r.medianTurnoverCr.toFixed(2),
      r.marketCapCr.toFixed(0),
      r.marketCapCategory || '',
      r.rankChange ?? '',
    ]);
    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayRows = useMemo(() => {
    let filtered = [...rows];
    if (activeTab === 'prefiltered' && hidePortfolio) {
      filtered = filtered.filter(r => !r.inPortfolio);
    }

    if (activeTab === 'portfolio' && signalFilter) {
      filtered = filtered.filter(r => {
        const sig = r.exitSignal?.signalType;
        if (signalFilter === 'hold') {
          return !r.exitSignal;
        } else if (signalFilter === 'warning') {
          return r.exitSignal?.signalType === 'yellow';
        } else if (signalFilter === 'exit') {
          return r.exitSignal?.signalType === 'red';
        }
        return true;
      });
    }

    return filtered.sort((a, b) => {
      // Pin active exit stocks (red signal, not protected) to the end of the table on the portfolio tab
      if (activeTab === 'portfolio') {
        const aIsExit = a.exitSignal?.signalType === 'red' && !a.exitSignal?.protected;
        const bIsExit = b.exitSignal?.signalType === 'red' && !b.exitSignal?.protected;
        if (aIsExit && !bIsExit) return 1;
        if (!aIsExit && bIsExit) return -1;
      }

      // For rank sort: unranked stocks (rank=9999, e.g. BE) are placed
      // by their compositeScore relative to ranked stocks so they appear
      // at their natural score position rather than pinned to the bottom.
      if (sortField === 'rank' || sortField === 'default') {
        const aUnranked = a.rank === 9999;
        const bUnranked = b.rank === 9999;
        if (!aUnranked && !bUnranked) {
          // Both ranked — sort by rank asc/desc normally
          return sortDir === 'asc' ? a.rank - b.rank : b.rank - a.rank;
        }
        if (aUnranked && bUnranked) {
          // Both unranked — sort by score desc (higher score = better position)
          return b.compositeScore - a.compositeScore;
        }
        // One ranked, one unranked: find where unranked's score fits
        const rankedRow = aUnranked ? b : a;
        const unrankedRow = aUnranked ? a : b;
        // Unranked goes after ranked stock if ranked score > unranked score
        const cmp = rankedRow.compositeScore - unrankedRow.compositeScore;
        // aUnranked: a is unranked; if cmp > 0 ranked is better, so a goes after => +1
        return aUnranked ? cmp : -cmp;
      }

      let cmp = 0;
      switch (sortField) {
        case 'symbol': cmp = a.symbol.localeCompare(b.symbol); break;
        case 'mcap':   cmp = a.marketCapCr - b.marketCapCr; break;
        case 'dd': {
          if (activeTab === 'portfolio') {
            const aDd = a.drawdownSinceEntry ?? 0;
            const bDd = b.drawdownSinceEntry ?? 0;
            cmp = aDd - bDd;
          } else {
            cmp = a.athProximity - b.athProximity;
          }
          break;
        }
        case 'score':      cmp = a.compositeScore - b.compositeScore; break;
        case 'rankChange': cmp = (a.rankChange ?? 0) - (b.rankChange ?? 0); break;
        default:           cmp = a.rank - b.rank;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortField, sortDir, activeTab, hidePortfolio, signalFilter]);

  const isClickableTab = activeTab === 'all' || activeTab === 'prefiltered' || activeTab === 'portfolio';

  return (
    <motion.div className="flex flex-col gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-3xl font-bold">
          <span className="gradient-text">Momentum Screener</span>
        </h1>
        <div className="flex items-center gap-2">
          {/* Sync button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-700/50 border border-white/5 rounded-lg transition-all disabled:opacity-50"
          >
            {syncing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                Syncing...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Sync
              </span>
            )}
          </button>

          {/* CSV Export button */}
          <button
            onClick={handleExportCSV}
            disabled={!displayRows.length}
            className="px-2 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-700/50 border border-white/5 rounded-lg transition-all disabled:opacity-30"
            title="Export CSV"
          >
            {/* Download icon */}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          <button
            onClick={() => setRulesOpen(true)}
            className="px-2 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-700/50 border border-white/5 rounded-lg transition-all"
            title="Strategy Rules"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </div>

      {/* Sync progress bar */}
      {syncing && (
        <div className="flex flex-col gap-1">
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500"
              style={{ width: `${syncProgress}%` }}
            />
          </div>
          {syncStep && (
            <span className="text-[10px] text-zinc-400">{syncStep}</span>
          )}
        </div>
      )}

      {/* Stats Bar */}
      <StatsBar
        stats={stats}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        filteredCount={rows.length}
        hidePortfolio={hidePortfolio}
        onHidePortfolioChange={setHidePortfolio}
        signalFilter={signalFilter}
        onSignalFilterChange={setSignalFilter}
      />

      {/* Table */}
      <div
        className="overflow-auto rounded-lg border border-zinc-800/60"
        style={{ maxHeight: 'calc(100vh - 226px)' }}
      >
        <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: '1000px' }}>
            <colgroup>
              <col style={{ width: '4%',  minWidth: '60px' }} />
              <col style={{ width: '4%',  minWidth: '50px' }} />
              <col style={{ width: '18%', minWidth: '180px' }} />
              <col style={{ width: '8%',  minWidth: '90px' }} />
              <col style={{ width: '16%', minWidth: '160px' }} />
              <col style={{ width: '7%',  minWidth: '70px' }} />
              <col style={{ width: '9%',  minWidth: '100px' }} />
              <col style={{ width: '9%',  minWidth: '100px' }} />
              <col style={{ width: '6%',  minWidth: '60px' }} />
            </colgroup>

            <thead className="sticky top-0 z-10 bg-slate-900 border-b border-zinc-800/60">
              <tr>
                <SortHeader field="rank"   current={sortField} dir={sortDir} onClick={handleSort} pl="pl-5">#</SortHeader>
                <SortHeader field="rankChange" current={sortField} dir={sortDir} onClick={handleSort} center>Δ</SortHeader>
                <SortHeader field="symbol" current={sortField} dir={sortDir} onClick={handleSort}>Stock</SortHeader>
                <SortHeader field="mcap"   current={sortField} dir={sortDir} onClick={handleSort} center>Marketcap</SortHeader>
                <th className={`${TH_BASE} hidden md:table-cell`}>Trend</th>
                <SortHeader field="score"  current={sortField} dir={sortDir} onClick={handleSort} center>Score</SortHeader>
                <th className={`${TH_BASE} text-center`} title="10 / 20 / 50 / 100 / 200 DMA">DMA</th>
                <th className={`${TH_BASE} text-center`} title="Away from ATH: 10/15/20/25/30%">ATH</th>
                <SortHeader field="dd" current={sortField} dir={sortDir} onClick={handleSort} center>DD</SortHeader>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-800/30">
              {loading ? (
                [...Array(12)].map((_, i) => <SkeletonRow key={i} />)
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-zinc-500 text-sm">
                      <span>No rankings yet.</span>
                      <span className="text-xs text-zinc-600">Trigger a sync to run the pipeline.</span>
                    </div>
                  </td>
                </tr>
              ) : displayRows.map(row => {
                const exit = activeTab === 'portfolio' ? row.exitSignal : undefined;
                const isExitCandidate = !!exit && exit.signalType === 'red' && !exit.protected;
                const isWarning        = !!exit && exit.signalType === 'yellow';
                const isProtected      = !!exit && exit.protected;

                // All-tab tier: portfolio > pre-filtered > universe-only
                const isAllTab = activeTab === 'all';
                const allTier = isAllTab
                  ? row.inPortfolio ? 'portfolio'
                  : row.isPreFiltered ? 'prefiltered'
                  : 'normal'
                  : null;

                const accentColor = isAllTab
                  ? (allTier === 'portfolio' || allTier === 'prefiltered') ? 'rgb(34,197,94)'
                  : 'rgb(39,39,42)'
                  : isExitCandidate
                    ? 'rgb(239,68,68)'
                    : isWarning
                      ? 'rgb(234,179,8)'
                      : isProtected
                        ? 'rgb(234,179,8)'
                        : row.isUnranked
                          ? 'rgb(63,63,70)'
                          : getRankAccent(row.rank, row.inPortfolio, activeTab === 'prefiltered');

                const rowBg = isAllTab
                  ? (allTier === 'portfolio' || allTier === 'prefiltered') ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                  : 'bg-zinc-950 hover:bg-zinc-800/40'
                  : isExitCandidate           ? 'bg-red-500/[0.08] hover:bg-red-500/[0.13]'
                  : isWarning                 ? 'bg-amber-500/[0.06] hover:bg-amber-500/[0.11]'
                  : isProtected               ? 'bg-amber-500/[0.03] hover:bg-amber-500/[0.08]'
                  : row.isUnranked            ? 'bg-zinc-950'
                  : row.inPortfolio && activeTab !== 'portfolio' ? 'bg-indigo-950/30 hover:bg-indigo-950/40'
                  : 'bg-zinc-950 hover:bg-zinc-800/60';

                return (
                  <tr
                    key={row.symbol}
                    onClick={() => {
                      if (isClickableTab) {
                        setSelectedSymbol(row.symbol);
                        setSelectedCompany(row.companyName);
                      }
                    }}
                    className={`group transition-colors ${isClickableTab ? 'cursor-pointer' : ''} ${rowBg}`}
                  >
                    {/* Rank — left accent bar */}
                    <td className="pl-5 pr-2 py-3" style={{ boxShadow: `inset 5px 0 0 ${accentColor}` }}>
                      {row.isUnranked ? (
                        <span className="text-zinc-600 text-xs">—</span>
                      ) : (
                        <span className={`font-mono text-xl font-black tabular-nums leading-none ${
                          isAllTab
                            ? (allTier === 'portfolio' || allTier === 'prefiltered') ? 'text-emerald-400'
                            : 'text-zinc-400'
                            : getRankTextColor(row.rank, activeTab === 'prefiltered')
                        }`}>
                          {row.rank}
                        </span>
                      )}
                    </td>

                    {/* Rank change */}
                    <td className="px-1 py-3 text-center">
                      {!row.isUnranked && (
                        row.rankChange == null || row.rankChange === 0
                          ? <span className="text-zinc-600 text-xs">—</span>
                          : <span className={`font-mono text-xs font-semibold tabular-nums ${row.rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {row.rankChange > 0 ? `↑${row.rankChange}` : `↓${Math.abs(row.rankChange)}`}
                            </span>
                      )}
                    </td>

                    {/* Stock info */}
                    <td className="flex flex-col px-3 py-3 gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`font-bold text-base truncate leading-none ${
                          isExitCandidate
                            ? 'text-red-300'
                            : isWarning
                              ? 'text-amber-300'
                              : isProtected
                                ? 'text-amber-100/90'
                                : 'text-white'
                        }`}>{row.symbol}</span>
                        {(() => {
                          const b = MCAP_BADGE[row.marketCapCategory || ''];
                          return b ? (
                            <span className={`text-[10px] font-medium leading-none shrink-0 flex items-center ${b.cls}`}>
                              {b.label}
                            </span>
                          ) : null;
                        })()}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChartSymbol(row.symbol);
                          }}
                          className="p-0.5 transition-all duration-150 hover:scale-110 hover:brightness-125 cursor-pointer shrink-0"
                          title={`Open ${row.symbol} chart`}
                          aria-label={`Open ${row.symbol} chart`}
                        >
                          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                            <defs>
                              <linearGradient id={`chart-grad-${row.symbol.replace(/[^a-zA-Z0-9]/g, '_')}`} x1="0%" y1="100%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" />
                                <stop offset="50%" stopColor="#06b6d4" />
                                <stop offset="100%" stopColor="#818cf8" />
                              </linearGradient>
                            </defs>
                            <path
                              d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"
                              fill={`url(#chart-grad-${row.symbol.replace(/[^a-zA-Z0-9]/g, '_')})`}
                            />
                          </svg>
                        </button>
                        {/* Exit / Warning / Caution signal badges */}
                        {exit && activeTab === 'portfolio' && exit.signalType === 'red' && (() => {
                          const exitLines = [
                            exit.isUnranked
                               ? (exit.unrankedReason ? `Dropped: ${exit.unrankedReason}` : 'Dropped from screener universe')
                               : exit.byRank ? 'Rank > 50' : '',
                            exit.byFilter ? 'Below 200 DMA or outside 25% of ATH' : '',
                            exit.by50Dma ? 'Below 50 DMA' : '',
                            exit.byDrawdown ? 'Dropped > 25% since entry' : '',
                            exit.protected ? '🔒 Min hold not met (< 14 days)' : '',
                            row.asmInfo ? `⚠ ASM ${row.asmInfo.type}-${row.asmInfo.stage}: ${row.asmInfo.desc}` : '',
                          ].filter(Boolean) as string[];
                          return (
                            <BadgeTooltip
                              label={exit.protected ? 'LOCKED' : 'EXIT'}
                              badgeCls={exit.protected
                                ? 'text-amber-400 hover:text-amber-300'
                                : 'text-red-400 hover:text-red-300'}
                              lines={exitLines}
                              iconOnly
                              icon={exit.protected ? (
                                <LockOutlinedIcon sx={{ fontSize: 16 }} />
                              ) : (
                                <LogoutIcon sx={{ fontSize: 16 }} />
                              )}
                            />
                          );
                        })()}
                        {exit && activeTab === 'portfolio' && exit.signalType === 'yellow' && (() => {
                          const cautionLines = [
                            exit.byRank && !exit.isUnranked ? 'Rank 51–60 (watch zone)' : '',
                            exit.isBE ? 'Moved to BE (T+0) settlement category' : '',
                            exit.by50Dma ? 'Below 50 DMA' : '',
                            exit.byDrawdownWarn && !exit.byDrawdown ? 'Dropped > 20% since entry (warn zone)' : '',
                            row.asmInfo ? `⚠ ASM ${row.asmInfo.type}-${row.asmInfo.stage}: ${row.asmInfo.desc}` : '',
                          ].filter(Boolean) as string[];
                          return (
                            <BadgeTooltip
                              label="CAUTION"
                              badgeCls="text-amber-400 hover:text-amber-300"
                              lines={cautionLines}
                              iconOnly
                              icon={<WarningAmberIcon sx={{ fontSize: 16 }} />}
                            />
                          );
                        })()}
                        {/* ASM badge — only shown outside portfolio tab */}
                        {row.asmInfo && activeTab !== 'portfolio' && (
                          <BadgeTooltip
                            label={`ASM ${row.asmInfo.type}-${row.asmInfo.stage}`}
                            badgeCls="bg-amber-500/20 text-amber-300 border-amber-500/40"
                            lines={[row.asmInfo.desc]}
                            icon={
                              <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            }
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate leading-tight mt-0.5">
                        {row.companyName}
                      </div>
                    </td>

                    {/* Mcap */}
                    <td className="px-1 py-3 text-center">
                      <span className="font-mono text-xs tabular-nums text-zinc-400">
                        {formatMcap(row.marketCapCr)}
                      </span>
                    </td>

                    {/* Price trend sparkline */}
                    <td className="px-3 py-3 hidden md:table-cell">
                      <Sparkline data={row.sparklineData} />
                    </td>

                    {/* Score */}
                    <td className="px-1 py-3 text-center">
                      {row.isUnranked && row.compositeScore === 0 ? (
                        <span className="text-zinc-700 text-xs">—</span>
                      ) : (
                        <span className={`font-mono text-xs font-semibold tabular-nums ${row.isUnranked ? 'text-zinc-500' : 'text-zinc-300'}`}>
                          {row.compositeScore.toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* DMA swatches (10/20/50/100/200) */}
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <DMASwatches swatches={row.dmaSwatches} />
                      </div>
                    </td>

                    {/* ATH swatches */}
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        {row.currentPrice > 0 ? (
                          <ATHSwatches athProximity={row.athProximity} />
                        ) : (
                          <span className="text-zinc-700 text-xs">—</span>
                        )}
                      </div>
                    </td>

                    {/* DD — drawdown */}
                    <td className="px-1 py-3 text-center">
                      {row.currentPrice > 0 ? (() => {
                        const athDd = -((1 - row.athProximity) * 100);
                        
                        const isPortfolioTab = activeTab === 'portfolio';
                        const hasEntryDd = isPortfolioTab && row.drawdownSinceEntry !== undefined && row.drawdownSinceEntry !== null;
                        const entryDd = row.drawdownSinceEntry ?? 0;
                        const isSame = hasEntryDd && Math.abs(athDd - entryDd) < 0.05;

                        // Primary value is drawdown since entry on portfolio tab, else ATH drawdown
                        const primaryDd = hasEntryDd ? entryDd : athDd;
                        const cls = primaryDd >= -5 ? 'text-emerald-400' : primaryDd >= -15 ? 'text-yellow-400' : primaryDd >= -30 ? 'text-orange-400' : 'text-red-400';

                        return (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-mono text-xs font-semibold tabular-nums ${cls}`}>
                              {primaryDd.toFixed(1)}%
                            </span>
                            {hasEntryDd && !isSame && (
                              <span className="font-mono text-[10px] text-zinc-500 tabular-nums leading-none mt-0.5" title="Drawdown from All-Time High">
                                ({athDd.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        );
                      })() : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </div>

      <RulesInfoModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      {selectedSymbol && (
        <RankHistoryModal
          symbol={selectedSymbol}
          companyName={selectedCompany}
          rankType={activeTab === 'all' ? 'all' : 'filtered'}
          onClose={() => setSelectedSymbol(null)}
          onOpenChart={(sym) => setChartSymbol(sym)}
          preloadedHistory={rankHistoryCacheRef.current[selectedSymbol]}
        />
      )}

      <StockChartModal
        symbol={chartSymbol}
        isOpen={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
        holding={chartRow ? {
          symbol: chartRow.symbol,
          currentPrice: chartRow.currentPrice > 0 ? chartRow.currentPrice : undefined,
          marketCapCategory: chartRow.marketCapCategory || undefined,
        } : null}
      />
    </motion.div>
  );
}
