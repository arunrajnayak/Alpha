'use client';

import { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSackDollar, 
  faArrowTrendUp, 
  faArrowTrendDown, 
  faBullseye, 
  faChartColumn, 
  faChartLine,
  faReceipt,
  faHandHoldingDollar,
  faEquals,
  faScaleBalanced,
} from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

// ============================================================================
// Types
// ============================================================================

interface ChartCardsProps {
    totalCurrentValue: number;
    currentNAV: number;
    currentDD: number;
    totalInvested: number;
    costBasis?: number;
    dashboardHistory: {
        date: string;
        totalEquity: number;
        portfolioNAV: number;
        drawdown: number;
    }[];
    privacyMode?: boolean;
}

export interface PnLRowProps {
    realizedPnL: number;
    unrealizedPnL: number;
    totalCharges: number;
    totalTax: number;
    dividends?: number; // upcoming feature
    privacyMode?: boolean;
}

interface XirrCardProps {
    xirrValue: number;
    totalCharges?: number;
    totalTax?: number;
    totalInvested?: number;
    privacyMode?: boolean;
}

interface CagrCardProps {
    cagrValue: number | null;
    totalCharges?: number;
    totalTax?: number;
    totalInvested?: number;
    privacyMode?: boolean;
}

interface AlphaCardProps {
    cagrValue: number | null;
    niftyCagr: number | null;
    nifty500M50Cagr: number | null;
    niftyMidcapCagr: number | null;
    niftySmallcapCagr: number | null;
}

interface MetricsComboCardProps {
    xirrValue: number;
    cagrValue: number | null;
    totalCharges: number;
    totalTax: number;
    totalInvested: number;
    totalDividends?: number;
    niftyCagr: number | null;
    nifty500M50Cagr: number | null;
    niftyMidcapCagr: number | null;
    niftySmallcapCagr: number | null;
    privacyMode?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

// Mini sparkline widget — memoized to prevent re-renders
 
const ChartWidget = memo(({ data, dataKey, color, domain }: { data: any[], dataKey: string, color: string, domain?: any }) => (
  <div className="absolute bottom-0 left-0 right-0 h-[80px] opacity-30 pointer-events-none">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={data}>
              <defs>
                  <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={color} stopOpacity={0}/>
                  </linearGradient>
              </defs>
              <YAxis domain={domain || ['auto', 'auto']} hide />
              <Area 
                  type="monotone" 
                  dataKey={dataKey} 
                  stroke={color} 
                  fill={`url(#gradient-${dataKey})`} 
                  strokeWidth={2}
                  isAnimationActive={true}
                  animationDuration={2000}
              />
          </AreaChart>
      </ResponsiveContainer>
  </div>
));
ChartWidget.displayName = 'ChartWidget';

// Shared card shell for P/L row items
const PnLCard = memo(function PnLCard({
    label,
    icon,
    iconBg,
    iconColor,
    value,
    prefix,
    valueColor,
    subLabel,
    privacyMode,
    isPlaceholder = false,
}: {
    label: string;
    icon: React.ComponentProps<typeof FontAwesomeIcon>['icon'];
    iconBg: string;
    iconColor: string;
    value?: number;
    prefix?: string;
    valueColor: string;
    subLabel?: string;
    privacyMode?: boolean;
    isPlaceholder?: boolean;
}) {
    return (
        <div className="glass-card p-5 flex flex-col justify-between animate-fade-in-up h-full">
            <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
                    <FontAwesomeIcon icon={icon} className={`${iconColor} text-sm`} />
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{label}</span>
            </div>
            {isPlaceholder ? (
                <div className="flex-1 flex flex-col justify-center">
                    <div className="text-sm text-gray-600 font-medium">Coming soon</div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col justify-center">
                    <div className={`text-2xl font-bold ${valueColor} leading-tight`}>
                        {privacyMode ? '****' : (
                            value !== undefined
                                ? <AnimatedNumber value={Math.abs(value)} prefix={prefix} formatOptions={{ maximumFractionDigits: 0 }} />
                                : '—'
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
PnLCard.displayName = 'PnLCard';

// ============================================================================
// Row 1 — Main Chart Cards (Current Value, NAV, Drawdown)
// ============================================================================

export const MainChartCards = memo(function MainChartCards({
    totalCurrentValue,
    totalInvested,
    costBasis,
    currentNAV,
    currentDD,
    dashboardHistory,
    privacyMode = false
}: ChartCardsProps) {
  return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full">
        {/* Current Valuation Card */}
        <div className="glass-card relative overflow-hidden p-6 flex flex-col justify-between animate-fade-in-up stagger-1 h-full">
          <div>
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faSackDollar} className="text-violet-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Current Value</span>
            </div>
            <h2 className="text-4xl font-bold text-violet-400 mb-2 z-10 relative">
                {privacyMode ? '****' : <AnimatedNumber value={totalCurrentValue} prefix="₹" formatOptions={{ maximumFractionDigits: 0 }} />}
            </h2>
            <div className="flex items-center gap-1.5 text-sm text-gray-500 z-10 relative font-medium flex-wrap">
                <span>Invested:</span>
                <span className="text-gray-400 font-semibold">
                    {privacyMode ? '****' : <>₹<AnimatedNumber value={totalInvested} formatOptions={{ maximumFractionDigits: 0 }} /></>}
                </span>
                {costBasis !== undefined && Math.abs(costBasis - totalInvested) > 1 && (
                  <span
                    className="text-[11px] text-gray-500 cursor-help"
                    title={`Cost basis of current holdings: ₹${Math.round(costBasis).toLocaleString('en-IN')}`}
                  >
                    ({privacyMode ? '****' : <>Cost: ₹<AnimatedNumber value={costBasis} formatOptions={{ maximumFractionDigits: 0 }} /></>})
                  </span>
                )}
            </div>
          </div>
          <ChartWidget data={dashboardHistory} dataKey="totalEquity" color="#8b5cf6" domain={['dataMin', 'dataMax']} />
        </div>

        {/* Current NAV Card */}
        <div className="glass-card relative overflow-hidden p-6 flex flex-col justify-between animate-fade-in-up stagger-2 h-full">
           <div>
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lime-500/20 to-lime-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faChartColumn} className="text-lime-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Current NAV</span>
            </div>
            <div className="text-4xl font-bold text-lime-400 z-10 relative mb-1">
                <AnimatedNumber value={currentNAV} decimals={2} />
            </div>
            <div className="text-sm text-gray-500 z-10 relative font-medium">Portfolio value per unit</div>
           </div>
           <ChartWidget data={dashboardHistory} dataKey="portfolioNAV" color="#a3e635" domain={['dataMin', 'dataMax']} />
        </div>

        {/* Current Drawdown Card */}
        <div className="glass-card relative overflow-hidden p-6 flex flex-col justify-between animate-fade-in-up stagger-3 h-full">
          <div>
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faChartLine} className="text-rose-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Current DD</span>
            </div>
            <div className={`text-4xl font-bold ${currentDD < 0 ? 'text-red-400' : 'text-emerald-400'} z-10 relative mb-1`}>
                <AnimatedNumber value={Math.abs(currentDD)} prefix={currentDD >= 0 ? '+' : '-'} suffix="%" decimals={2} />
            </div>
            <div className="text-sm text-gray-500 z-10 relative font-medium">From all-time high</div>
          </div>
          <ChartWidget data={dashboardHistory} dataKey="drawdown" color="#ef4444" />
        </div>
      </div>
  );
});

// ============================================================================
// Row 2 — P/L Breakdown (5 cards spanning full width)
// Realized + Unrealized − Charges − Tax + Dividends = Net P/L
// ============================================================================

export const PnLRow = memo(function PnLRow({
    realizedPnL,
    unrealizedPnL,
    totalCharges,
    totalTax,
    dividends = 0,
    privacyMode = false,
}: PnLRowProps) {
    const netPnL = realizedPnL + unrealizedPnL - totalCharges - totalTax + dividends;
    const totalCosts = totalCharges + totalTax;
    const isNetPositive = netPnL >= 0;

    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6 h-full">
            {/* Realized P/L */}
            <PnLCard
                label="Realized P/L"
                icon={realizedPnL >= 0 ? faArrowTrendUp : faArrowTrendDown}
                iconBg={realizedPnL >= 0 ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5' : 'bg-gradient-to-br from-red-500/20 to-red-500/5'}
                iconColor={realizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
                value={realizedPnL}
                prefix={realizedPnL >= 0 ? '₹' : '-₹'}
                valueColor={realizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
                privacyMode={privacyMode}
            />

            {/* Unrealized P/L */}
            <PnLCard
                label="Unrealized P/L"
                icon={unrealizedPnL >= 0 ? faArrowTrendUp : faArrowTrendDown}
                iconBg={unrealizedPnL >= 0 ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5' : 'bg-gradient-to-br from-red-500/20 to-red-500/5'}
                iconColor={unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
                value={unrealizedPnL}
                prefix={unrealizedPnL >= 0 ? '₹' : '-₹'}
                valueColor={unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
                privacyMode={privacyMode}
            />

            {/* Charges & Tax */}
            <PnLCard
                label="Charges & Tax"
                icon={faReceipt}
                iconBg="bg-gradient-to-br from-orange-500/20 to-orange-500/5"
                iconColor="text-orange-400"
                value={totalCosts}
                prefix="-₹"
                valueColor="text-orange-400"
                privacyMode={privacyMode}
            />

            {/* Dividends — Coming Soon */}
            <PnLCard
                label="Dividends"
                icon={faHandHoldingDollar}
                iconBg="bg-gradient-to-br from-teal-500/20 to-teal-500/5"
                iconColor="text-teal-500"
                valueColor="text-teal-400"
                isPlaceholder={true}
                privacyMode={privacyMode}
            />

            {/* Net P/L */}
            <div className="glass-card p-5 flex flex-col justify-between animate-fade-in-up h-full border border-white/10 relative overflow-hidden">
                {/* Subtle highlight ring */}
                <div className={`absolute inset-0 rounded-xl pointer-events-none ${isNetPositive ? 'ring-1 ring-emerald-500/20' : 'ring-1 ring-red-500/20'}`} />
                <div className="flex items-center gap-2.5 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isNetPositive ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5' : 'bg-gradient-to-br from-red-500/20 to-red-500/5'}`}>
                        <FontAwesomeIcon icon={faEquals} className={`text-sm ${isNetPositive ? 'text-emerald-400' : 'text-red-400'}`} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-tight">Net P/L</span>
                </div>
                <div className="flex-1 flex flex-col justify-center">
                    <div className={`text-2xl font-bold leading-tight ${isNetPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {privacyMode ? '****' : (
                            <AnimatedNumber
                                value={Math.abs(netPnL)}
                                prefix={isNetPositive ? '₹' : '-₹'}
                                formatOptions={{ maximumFractionDigits: 0 }}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

// ============================================================================
// Row 3 — XIRR Card
// ============================================================================

export const XirrCard = memo(function XirrCard({ xirrValue, totalCharges = 0, totalTax = 0, totalInvested = 0, privacyMode = false }: XirrCardProps) {
  const isXirrPositive = xirrValue >= 0;
  const chargeDragPct = totalInvested > 0 ? ((totalCharges + totalTax) / totalInvested) * 100 : 0;
  const postChargesXirr = xirrValue - chargeDragPct;
  const hasCharges = chargeDragPct > 0;

  return (
        <div className="glass-card p-6 flex flex-col animate-fade-in-up stagger-5 h-full">
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isXirrPositive
                    ? 'bg-gradient-to-br from-fuchsia-500/20 to-fuchsia-500/5'
                    : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                }`}>
                    <FontAwesomeIcon icon={faBullseye} className={`text-lg ${isXirrPositive ? 'text-fuchsia-400' : 'text-red-400'}`} />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">XIRR</span>
            </div>

            <div className="flex-1 flex flex-col justify-center">
                <h2 className={`text-4xl font-bold ${isXirrPositive ? 'text-fuchsia-400' : 'text-red-400'}`}>
                    <AnimatedNumber value={xirrValue} suffix="%" decimals={2} />
                </h2>
                {hasCharges && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 font-medium">Post charges</span>
                    <span className={`text-xs font-semibold ${postChargesXirr >= 0 ? 'text-fuchsia-400/60' : 'text-red-400/80'}`}>
                      <AnimatedNumber value={postChargesXirr} suffix="%" decimals={2} />
                    </span>
                  </div>
                )}
            </div>
        </div>
  );
});

// ============================================================================
// Row 3 — CAGR Card
// ============================================================================

export const CagrCard = memo(function CagrCard({
  cagrValue,
  totalCharges = 0,
  totalTax = 0,
  totalInvested = 0,
  privacyMode = false
}: CagrCardProps) {
  const isCagrPositive = (cagrValue ?? 0) >= 0;
  const chargeDragPct = totalInvested > 0 ? ((totalCharges + totalTax) / totalInvested) * 100 : 0;
  const postChargesCagr = cagrValue != null ? cagrValue - chargeDragPct : null;
  const hasCharges = chargeDragPct > 0 && cagrValue != null;

  return (
        <div className="glass-card p-6 flex flex-col animate-fade-in-up stagger-5 h-full">
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isCagrPositive
                    ? 'bg-gradient-to-br from-violet-500/20 to-violet-500/5'
                    : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                }`}>
                    <FontAwesomeIcon icon={faChartLine} className={`text-lg ${isCagrPositive ? 'text-violet-400' : 'text-red-400'}`} />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">CAGR</span>
            </div>

            <div className="flex-1 flex flex-col justify-center">
                <h2 className={`text-4xl font-bold ${isCagrPositive ? 'text-violet-400' : 'text-red-400'}`}>
                    {cagrValue != null ? (
                        <AnimatedNumber value={cagrValue} suffix="%" decimals={2} />
                    ) : (
                        <span className="text-gray-600">—</span>
                    )}
                </h2>
                {hasCharges && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 font-medium">Post charges</span>
                    <span className={`text-xs font-semibold ${(postChargesCagr ?? 0) >= 0 ? 'text-violet-400/60' : 'text-red-400/80'}`}>
                      <AnimatedNumber value={postChargesCagr!} suffix="%" decimals={2} />
                    </span>
                  </div>
                )}
            </div>
        </div>
  );
});

// ============================================================================
// Row 3 — Alpha Card (Benchmark comparisons with center-aligned bar indicators)
// ============================================================================

export const AlphaCard = memo(function AlphaCard({
    cagrValue,
    niftyCagr = null,
    nifty500M50Cagr = null,
    niftyMidcapCagr = null,
    niftySmallcapCagr = null
}: AlphaCardProps) {
    const benchmarks = [
        { label: 'Nifty 50', val: niftyCagr },
        { label: 'n500m50', val: nifty500M50Cagr },
        { label: 'Midcap 100', val: niftyMidcapCagr },
        { label: 'Smallcap 250', val: niftySmallcapCagr },
    ];

    const maxRange = 30; // Caps alpha visual width at ±30%

    return (
        <div className="glass-card p-5 flex flex-col animate-fade-in-up stagger-5 h-full">
            <div className="flex items-center gap-2.5 mb-2.5 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center flex-shrink-0">
                    <FontAwesomeIcon icon={faScaleBalanced} className="text-indigo-400 text-sm" />
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-tight">Index Alpha</span>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-2 min-h-[90px]">
                {benchmarks.map(({ label, val }) => {
                    if (val === null || cagrValue === null) return null;
                    const alpha = cagrValue - val;
                    const isPositive = alpha >= 0;
                    const pct = Math.min(Math.abs(alpha) / maxRange, 1) * 50;

                    return (
                        <div key={label} className="flex flex-col gap-0.5">
                            <div className="flex justify-between items-center text-[9px] font-semibold">
                                <span className="text-gray-400">{label}</span>
                                <span className={isPositive ? 'text-emerald-400' : 'text-rose-400 font-mono'}>
                                    {isPositive ? '+' : ''}{alpha.toFixed(2)}%
                                </span>
                            </div>
                            <div className="h-1 bg-gray-800/40 rounded-full relative overflow-hidden flex items-center">
                                {/* Center marker line */}
                                <div className="absolute left-1/2 w-[1px] h-full bg-gray-700/50 z-10" />
                                {/* Alpha bar */}
                                <div
                                    className={`absolute h-full rounded-full transition-all duration-1000 ${
                                        isPositive
                                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                                            : 'bg-gradient-to-l from-rose-500 to-rose-400'
                                    }`}
                                    style={{
                                        left: isPositive ? '50%' : `${50 - pct}%`,
                                        width: `${pct}%`,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

// ============================================================================
// Combined Card: P/L Summary (single card, all items stacked)
// ============================================================================

export const PnLSummaryCard = memo(function PnLSummaryCard({
    realizedPnL,
    unrealizedPnL,
    totalCharges,
    totalTax,
    dividends = 0,
    privacyMode = false,
}: PnLRowProps) {
    const netPnL = realizedPnL + unrealizedPnL - totalCharges - totalTax + dividends;
    const totalCosts = totalCharges + totalTax;
    const isNetPositive = netPnL >= 0;

    const rows: { label: string; icon: React.ComponentProps<typeof FontAwesomeIcon>['icon']; iconColor: string; value: number | null; prefix?: string; valueColor: string }[] = [
        {
            label: 'Realized',
            icon: realizedPnL >= 0 ? faArrowTrendUp : faArrowTrendDown,
            iconColor: realizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400',
            value: realizedPnL,
            prefix: realizedPnL >= 0 ? '₹' : '-₹',
            valueColor: realizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400',
        },
        {
            label: 'Unrealized',
            icon: unrealizedPnL >= 0 ? faArrowTrendUp : faArrowTrendDown,
            iconColor: unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400',
            value: unrealizedPnL,
            prefix: unrealizedPnL >= 0 ? '₹' : '-₹',
            valueColor: unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400',
        },
        {
            label: 'Charges & Tax',
            icon: faReceipt,
            iconColor: 'text-orange-400',
            value: totalCosts,
            prefix: '-₹',
            valueColor: 'text-orange-400',
        },
        {
            label: 'Dividends',
            icon: faHandHoldingDollar,
            iconColor: 'text-teal-500',
            value: dividends,
            prefix: '₹',
            valueColor: 'text-teal-400',
        },
    ];

    return (
        <div className="glass-card p-5 flex flex-col h-full animate-fade-in-up">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4 flex-shrink-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isNetPositive
                        ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5'
                        : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                }`}>
                    <FontAwesomeIcon
                        icon={isNetPositive ? faArrowTrendUp : faArrowTrendDown}
                        className={`text-lg ${isNetPositive ? 'text-emerald-400' : 'text-red-400'}`}
                    />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">P/L Summary</span>
            </div>

            {/* Line items */}
            <div className="flex-1 flex flex-col justify-center gap-4">
                {rows.map(({ label, icon, iconColor, value, prefix, valueColor }) => (
                    <div key={label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <FontAwesomeIcon icon={icon} className={`${iconColor} text-base w-4`} />
                            <span className="text-base text-gray-400 font-medium">{label}</span>
                        </div>
                        {value === null ? (
                            <span className="text-base text-gray-600 font-medium">Coming soon</span>
                        ) : (
                            <span className={`text-lg font-bold ${valueColor}`}>
                                {privacyMode ? '****' : (
                                    <AnimatedNumber value={Math.abs(value)} prefix={prefix} formatOptions={{ maximumFractionDigits: 0 }} />
                                )}
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* Net P/L divider row */}
            <div className="border-t border-gray-700/50 mt-4 pt-4 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2.5">
                    <FontAwesomeIcon icon={faEquals} className={`text-base ${isNetPositive ? 'text-emerald-400' : 'text-red-400'}`} />
                    <span className="text-base font-bold text-gray-300 uppercase tracking-wide">Net P/L</span>
                </div>
                <span className={`text-3xl font-bold ${isNetPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {privacyMode ? '****' : (
                        <AnimatedNumber
                            value={Math.abs(netPnL)}
                            prefix={isNetPositive ? '₹' : '-₹'}
                            formatOptions={{ maximumFractionDigits: 0 }}
                        />
                    )}
                </span>
            </div>
        </div>
    );
});

// ============================================================================
// Combined Card: Metrics (XIRR + CAGR top, Index Alpha bottom)
// ============================================================================

export const MetricsComboCard = memo(function MetricsComboCard({
    xirrValue,
    cagrValue,
    totalCharges,
    totalTax,
    totalInvested,
    totalDividends = 0,
    niftyCagr,
    nifty500M50Cagr,
    niftyMidcapCagr,
    niftySmallcapCagr,
    privacyMode = false,
}: MetricsComboCardProps) {
    const isXirrPositive = xirrValue >= 0;
    const isCagrPositive = (cagrValue ?? 0) >= 0;
    const chargeDragPct = totalInvested > 0 ? ((totalCharges + totalTax) / totalInvested) * 100 : 0;
    const dividendYieldPct = totalInvested > 0 ? (totalDividends / totalInvested) * 100 : 0;
    // post-charges & dividends: subtract charge drag, add dividend yield
    const postNetXirr = xirrValue - chargeDragPct + dividendYieldPct;
    const postNetCagr = cagrValue != null ? cagrValue - chargeDragPct + dividendYieldPct : null;
    const hasAdjustment = chargeDragPct > 0 || dividendYieldPct > 0;
    const postLabel = totalDividends > 0 ? 'Post charges & dividends' : 'Post charges';

    const benchmarks = [
        { label: 'Nifty 50',     val: niftyCagr },
        { label: 'N500M50',      val: nifty500M50Cagr },
        { label: 'Midcap 100',   val: niftyMidcapCagr },
        { label: 'Smallcap 250', val: niftySmallcapCagr },
    ];
    const maxRange = 30;

    return (
        <div className="glass-card p-5 flex flex-col h-full animate-fade-in-up">
            {/* Top half: XIRR + CAGR side by side */}
            <div className="flex gap-4 flex-shrink-0">
                {/* XIRR */}
                <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-3 mb-2">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isXirrPositive
                                ? 'bg-gradient-to-br from-fuchsia-500/20 to-fuchsia-500/5'
                                : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                        }`}>
                            <FontAwesomeIcon icon={faBullseye} className={`text-lg ${isXirrPositive ? 'text-fuchsia-400' : 'text-red-400'}`} />
                        </div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">XIRR</span>
                    </div>
                    <div className={`text-4xl font-bold leading-none ${isXirrPositive ? 'text-fuchsia-400' : 'text-red-400'}`}>
                        <AnimatedNumber value={xirrValue} suffix="%" decimals={2} />
                    </div>
                    {hasAdjustment && (
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-xs text-gray-500">{postLabel}</span>
                            <span className={`text-xs font-semibold ${postNetXirr >= 0 ? 'text-fuchsia-400/70' : 'text-red-400/80'}`}>
                                <AnimatedNumber value={postNetXirr} suffix="%" decimals={2} />
                            </span>
                        </div>
                    )}
                </div>

                {/* Vertical divider */}
                <div className="w-px bg-gray-700/40 self-stretch" />

                {/* CAGR */}
                <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-3 mb-2">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isCagrPositive
                                ? 'bg-gradient-to-br from-violet-500/20 to-violet-500/5'
                                : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                        }`}>
                            <FontAwesomeIcon icon={faChartLine} className={`text-lg ${isCagrPositive ? 'text-violet-400' : 'text-red-400'}`} />
                        </div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">CAGR</span>
                    </div>
                    <div className={`text-4xl font-bold leading-none ${isCagrPositive ? 'text-violet-400' : 'text-red-400'}`}>
                        {cagrValue != null ? (
                            <AnimatedNumber value={cagrValue} suffix="%" decimals={2} />
                        ) : (
                            <span className="text-gray-600">—</span>
                        )}
                    </div>
                    {hasAdjustment && postNetCagr != null && (
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-xs text-gray-500">{postLabel}</span>
                            <span className={`text-xs font-semibold ${postNetCagr >= 0 ? 'text-violet-400/70' : 'text-red-400/80'}`}>
                                <AnimatedNumber value={postNetCagr} suffix="%" decimals={2} />
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Horizontal divider */}
            <div className="h-px bg-gray-700/30 my-4 flex-shrink-0" />

            {/* Bottom: Strategy Alpha */}
            <div className="flex items-center gap-3 mb-3 flex-shrink-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 flex items-center justify-center">
                    <FontAwesomeIcon icon={faScaleBalanced} className="text-indigo-400 text-lg" />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Strategy Alpha</span>
            </div>
            <div className="flex-1 flex flex-col justify-center gap-3">
                {benchmarks.map(({ label, val }) => {
                    if (val === null || cagrValue === null) return null;
                    const alpha = cagrValue - val;
                    const isPositive = alpha >= 0;
                    const pct = Math.min(Math.abs(alpha) / maxRange, 1) * 50;
                    return (
                        <div key={label} className="flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-semibold text-gray-400">{label}</span>
                                <span className={`text-xs font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {isPositive ? '+' : ''}{alpha.toFixed(2)}%
                                </span>
                            </div>
                            <div className="h-2.5 bg-gray-800/60 rounded-full relative overflow-hidden">
                                <div className="absolute left-1/2 w-px h-full bg-gray-600/60 z-10" />
                                <div
                                    className={`absolute h-full rounded-full transition-all duration-1000 ${
                                        isPositive
                                            ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                                            : 'bg-gradient-to-l from-rose-600 to-rose-400'
                                    }`}
                                    style={{
                                        left: isPositive ? '50%' : `${50 - pct}%`,
                                        width: `${pct}%`,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

// Deprecated
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function SummaryCards(props: any) {
    return null; 
}
