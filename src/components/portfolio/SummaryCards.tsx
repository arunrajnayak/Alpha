'use client';

import { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faSackDollar, 
  faArrowTrendUp, 
  faArrowTrendDown, 
  faBullseye, 
  faChartColumn, 
  faChartLine 
} from '@fortawesome/free-solid-svg-icons';
import AnimatedNumber from '../ui/AnimatedNumber';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

interface ChartCardsProps {
    totalCurrentValue: number;
    currentNAV: number;
    currentDD: number;
    totalInvested: number;
    dashboardHistory: {
        date: string;
        totalEquity: number;
        portfolioNAV: number;
        drawdown: number;
    }[];
}

interface PnLCardProps {
    totalPnL: number;
    realizedPnL: number;
    unrealizedPnL: number;
}

interface XirrCardProps {
    xirrValue: number;
}


// Helper for mini charts - memoized to prevent re-renders
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export const MainChartCards = memo(function MainChartCards({
    totalCurrentValue,
    totalInvested,
    currentNAV,
    currentDD,
    dashboardHistory
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
                <AnimatedNumber 
                value={totalCurrentValue} 
                prefix="₹" 
                formatOptions={{ maximumFractionDigits: 0 }}
                />
            </h2>
            <p className="text-sm text-gray-500 z-10 relative font-medium">
                Invested: <span className="text-gray-400">₹<AnimatedNumber value={totalInvested} formatOptions={{ maximumFractionDigits: 0 }} /></span>
            </p>
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
                <AnimatedNumber 
                value={Math.abs(currentDD)} 
                prefix={currentDD >= 0 ? '+' : '-'} 
                suffix="%" 
                decimals={2}
                />
            </div>
            <div className="text-sm text-gray-500 z-10 relative font-medium">From all-time high</div>
          </div>
          <ChartWidget data={dashboardHistory} dataKey="drawdown" color="#ef4444" />
        </div>
      </div>
  );
});

export const PnLCard = memo(function PnLCard({ totalPnL, realizedPnL, unrealizedPnL }: PnLCardProps) {
  const isProfit = totalPnL >= 0;

  return (
        <div className="glass-card p-6 flex flex-col justify-between animate-fade-in-up stagger-4 h-full">
            <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isProfit 
                    ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5' 
                    : 'bg-gradient-to-br from-red-500/20 to-red-500/5'
                }`}>
                    <FontAwesomeIcon 
                        icon={isProfit ? faArrowTrendUp : faArrowTrendDown} 
                        className={`text-lg ${isProfit ? 'text-emerald-400' : 'text-red-400'}`} 
                    />
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Overall P/L</span>
            </div>
            
            <div className="mb-2">
                 <h2 className={`text-3xl font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                    <AnimatedNumber 
                        value={Math.abs(totalPnL)} 
                        prefix={isProfit ? '+₹' : '-₹'} 
                        formatOptions={{ maximumFractionDigits: 0 }}
                    />
                </h2>
            </div>
          
          <div className="flex flex-col gap-1 text-xs border-t border-gray-700/50 pt-3">
             <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Realized</span>
                <span className={`font-semibold ${realizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    <AnimatedNumber value={Math.abs(realizedPnL)} prefix={realizedPnL >= 0 ? '+' : '-'} formatOptions={{ maximumFractionDigits: 0 }} />
                </span>
             </div>
             <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Unrealized</span>
                <span className={`font-semibold ${unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    <AnimatedNumber value={Math.abs(unrealizedPnL)} prefix={unrealizedPnL >= 0 ? '+' : '-'} formatOptions={{ maximumFractionDigits: 0 }} />
                </span>
             </div>
          </div>
        </div>
  );
});

export const XirrCard = memo(function XirrCard({ xirrValue }: XirrCardProps) {
  const isXirrPositive = xirrValue >= 0;
  
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
            </div>
        </div>
  );
});

// Deprecated
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export default function SummaryCards(props: any) {
    return null; 
}

