'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { NSEMarketBreadthData } from '@/app/actions/market-breadth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowTrendUp, faArrowTrendDown, faLayerGroup } from '@fortawesome/free-solid-svg-icons';

interface NSEMarketBreadthCardProps {
  breadth: NSEMarketBreadthData | null;
  loading: boolean;
  refreshSecondsLeft?: number;
  onRefresh?: () => void;
}

export default function NSEMarketBreadthCard({
  breadth,
  loading,
  refreshSecondsLeft,
  onRefresh,
}: NSEMarketBreadthCardProps) {
  if (!breadth) {
    return (
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 md:p-5 h-[230px] animate-pulse" />
    );
  }

  const { advances, declining: declines, unchanged, total, adRatio, advPercent, netAdvances, tiers } = {
    advances: breadth.advances,
    declining: breadth.declines,
    unchanged: breadth.unchanged,
    total: breadth.total,
    adRatio: breadth.adRatio,
    advPercent: breadth.advPercent,
    netAdvances: breadth.netAdvances,
    tiers: breadth.tiers,
  };

  const decPercent = total > 0 ? ((declines / total) * 100).toFixed(1) : '0';
  const unchPercent = total > 0 ? ((unchanged / total) * 100).toFixed(1) : '0';

  const tierList = [
    { label: 'Large Cap', data: tiers.large },
    { label: 'Mid Cap', data: tiers.mid },
    { label: 'Small Cap', data: tiers.small },
    { label: 'Micro Cap', data: tiers.micro },
  ];

  return (
    <div className="flex flex-col justify-between bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-5 shadow-xl relative overflow-hidden">
      {/* Background Accent Glow */}
      <div
        className={`absolute -top-16 -right-16 w-36 h-36 rounded-full blur-3xl pointer-events-none opacity-20 ${
          netAdvances >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />

      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FontAwesomeIcon icon={faArrowTrendUp} className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm md:text-base text-white tracking-tight">
                  NSE Market Breadth
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-gray-400 border border-white/5 font-mono">
                  {total} Stocks
                </span>
              </div>
              <p className="text-[11px] text-gray-400">All active traded equities</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {typeof refreshSecondsLeft === 'number' && (
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-white/5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {refreshSecondsLeft}s
              </span>
            )}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="text-[11px] px-2 py-0.5 text-gray-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-white/5 rounded-md transition disabled:opacity-50"
              >
                {loading ? '...' : 'Refresh'}
              </button>
            )}
          </div>
        </div>

        {/* Big Numbers: Adv vs Dec */}
        <div className="grid grid-cols-3 gap-2 py-2 mb-2 bg-slate-800/30 rounded-xl px-3 border border-white/5">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-semibold text-emerald-400/80 tracking-wider">
              Advances
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl md:text-2xl font-bold font-mono text-emerald-400">
                {advances.toLocaleString()}
              </span>
              <span className="text-[11px] text-emerald-400/70 font-mono">
                ({advPercent}%)
              </span>
            </div>
          </div>

          <div className="flex flex-col text-center">
            <span className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">
              A/D Ratio
            </span>
            <div className="flex items-baseline justify-center gap-1">
              <span
                className={`text-xl md:text-2xl font-bold font-mono ${
                  adRatio >= 1 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {adRatio.toFixed(2)}
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                {netAdvances >= 0 ? `+${netAdvances}` : `${netAdvances}`}
              </span>
            </div>
          </div>

          <div className="flex flex-col text-right">
            <span className="text-[10px] uppercase font-semibold text-rose-400/80 tracking-wider">
              Declines
            </span>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="text-[11px] text-rose-400/70 font-mono">
                ({decPercent}%)
              </span>
              <span className="text-xl md:text-2xl font-bold font-mono text-rose-400">
                {declines.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Advance / Decline Bar */}
        <div className="relative h-3 w-full rounded-full overflow-hidden flex bg-slate-800/80 shadow-inner my-2.5">
          <motion.div
            className="h-full bg-emerald-500"
            style={{ width: `${advPercent}%` }}
            initial={false}
            animate={{ width: `${advPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
          {unchanged > 0 && (
            <motion.div
              className="h-full bg-slate-500/80"
              style={{ width: `${unchPercent}%` }}
              initial={false}
              animate={{ width: `${unchPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          )}
          <motion.div
            className="h-full bg-rose-500"
            style={{ width: `${decPercent}%` }}
            initial={false}
            animate={{ width: `${decPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Market Cap Tier Breadth Breakdown */}
      <div className="pt-2.5 mt-2 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 mb-2">
          <FontAwesomeIcon icon={faLayerGroup} className="w-3 h-3 text-indigo-400" />
          <span>Breadth by Market Cap</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {tierList.map((tier) => {
            const adv = tier.data.advances;
            const dec = tier.data.declines;
            const tot = tier.data.total || 1;
            const pct = Math.round((adv / tot) * 100);
            return (
              <div
                key={tier.label}
                className="bg-slate-800/40 border border-white/5 rounded-xl p-2 flex flex-col justify-between"
              >
                <div className="flex justify-between items-center text-[10px] text-gray-400 mb-1">
                  <span className="font-semibold text-gray-300">{tier.label}</span>
                  <span className="font-mono text-gray-500">{tot}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono font-bold mb-1.5">
                  <span className="text-emerald-400">{adv}↑</span>
                  <span className="text-[10px] text-gray-400 font-normal font-mono">{pct}%</span>
                  <span className="text-rose-400">{dec}↓</span>
                </div>
                <div className="w-full bg-slate-700/60 rounded-full h-1.5 overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                  <div
                    className="bg-rose-500 h-full transition-all duration-500"
                    style={{ width: `${100 - pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
