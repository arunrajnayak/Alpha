'use client';

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { formatCurrency, formatNumber } from '@/lib/format';
import { ExitRecord } from '@/lib/exits';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SwapVertIcon from '@mui/icons-material/SwapVert';

interface ExitsTableProps {
  exits: ExitRecord[];
}

type SortKey = 'sellDate' | 'symbol' | 'quantity' | 'buyDate' | 'changePercent' | 'gainLoss' | 'timeHeld' | 'marketCapCategory';
type SortDirection = 'asc' | 'desc';
type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro';

// Stats Component
const StatsSummary = ({ exits }: { exits: ExitRecord[] }) => {
    const totalExits = exits.length;
    const wins = exits.filter(e => e.gainLoss > 0).length;
    const winRate = totalExits > 0 ? (wins / totalExits) * 100 : 0;
    const totalPnL = exits.reduce((sum, e) => sum + e.gainLoss, 0);
    const avgReturn = totalExits > 0 ? exits.reduce((sum, e) => sum + e.changePercent, 0) / totalExits : 0;

    return (
        <>
            <div className="bg-white/5 rounded-lg px-4 py-2 border border-white/10 backdrop-blur-md flex flex-col justify-center min-w-[100px]">
                <div className="text-gray-400 text-[10px] uppercase font-semibold">Total Exits</div>
                <div className="text-lg font-bold text-white leading-tight">{totalExits}</div>
            </div>
            <div className="bg-white/5 rounded-lg px-4 py-2 border border-white/10 backdrop-blur-md flex flex-col justify-center min-w-[100px]">
                <div className="text-gray-400 text-[10px] uppercase font-semibold">Win Rate</div>
                <div className={`text-lg font-bold leading-tight ${winRate >= 50 ? 'text-green-400' : 'text-orange-400'}`}>
                    {winRate.toFixed(1)}%
                </div>
            </div>
            <div className="bg-white/5 rounded-lg px-4 py-2 border border-white/10 backdrop-blur-md flex flex-col justify-center min-w-[100px]">
                <div className="text-gray-400 text-[10px] uppercase font-semibold">Total P&L</div>
                <div className={`text-lg font-bold leading-tight ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(totalPnL, 0, 0)}
                </div>
            </div>
            <div className="bg-white/5 rounded-lg px-4 py-2 border border-white/10 backdrop-blur-md flex flex-col justify-center min-w-[100px]">
                <div className="text-gray-400 text-[10px] uppercase font-semibold">Avg Return</div>
                <div className={`text-lg font-bold leading-tight ${avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {avgReturn > 0 ? '+' : ''}{avgReturn.toFixed(2)}%
                </div>
            </div>
        </>
    );
};

// Helper component
const SortIcon = ({ active, direction }: { active: boolean; direction: SortDirection }) => {
  if (!active) {
    return <SwapVertIcon className="w-4 h-4 text-gray-600 opacity-0 group-hover/th:opacity-100 transition-opacity ml-1 inline-block align-middle" style={{ fontSize: '1rem' }} />;
  }
  return direction === 'asc' 
    ? <ArrowUpwardIcon className="w-4 h-4 text-white ml-1 inline-block align-middle" style={{ fontSize: '1rem' }} />
    : <ArrowDownwardIcon className="w-4 h-4 text-white ml-1 inline-block align-middle" style={{ fontSize: '1rem' }} />;
};

const Th = ({ 
    id, 
    label, 
    align = 'left',
    sortKey,
    sortDirection,
    onSort
}: { 
    id: SortKey, 
    label: string, 
    align?: 'left' | 'right',
    sortKey: SortKey,
    sortDirection: SortDirection,
    onSort: (key: SortKey) => void
}) => (
  <th 
      className={`md:px-6 px-4 py-4 font-semibold tracking-wider cursor-pointer select-none group/th hover:text-white transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(id)}
  >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          {label}
          <SortIcon active={sortKey === id} direction={sortDirection} />
      </div>
  </th>
);

export default function ExitsTable({ exits }: ExitsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('sellDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterCategory, setFilterCategory] = useState<MarketCapCategory | 'All'>('All');

  const filteredExits = useMemo(() => {
      if (filterCategory === 'All') return exits;
      return exits.filter(e => e.marketCapCategory === filterCategory);
  }, [exits, filterCategory]);

  const handleSort = (key: SortKey) => {
    const defaultKey = 'sellDate';
    const defaultDirection = 'desc';
    const isDefault = sortKey === defaultKey && sortDirection === defaultDirection;

    if (sortKey === key && !isDefault) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortKey(defaultKey);
        setSortDirection(defaultDirection);
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedExits = useMemo(() => {
    return [...filteredExits].sort((a, b) => {
      const isAsc = sortDirection === 'asc';
      let valA: string | number | Date | undefined = a[sortKey];
      let valB: string | number | Date | undefined = b[sortKey];

      // Handle undefined for marketCapCategory sorting
      if (valA === undefined) valA = '';
      if (valB === undefined) valB = '';

      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();

      if (valA === valB) return 0;
      // TS sees valA/valB as union, simple comparison works for primitive values we reduced them to
      return (valA > valB ? 1 : -1) * (isAsc ? 1 : -1);
    });
  }, [filteredExits, sortKey, sortDirection]);

  return (
    <div>
        <div className="flex flex-col xl:flex-row justify-between items-end mb-6 gap-6">
             <div className="flex flex-col gap-4 w-full xl:w-auto">
                 <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap">
                    <span className="gradient-text">
                        <span className="md:hidden">Exits</span>
                        <span className="hidden md:inline">Portfolio Exits</span>
                    </span>
                 </h1>
                 <div className="flex gap-2 flex-wrap">
                    {(['All', 'Large', 'Mid', 'Small', 'Micro'] as const).map(cat => (
                        <button
                            key={cat}
                            onClick={() => setFilterCategory(cat)}
                            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
                                filterCategory === cat 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                 </div>
             </div>
             
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full xl:w-auto">
                <StatsSummary exits={filteredExits} />
             </div>
        </div>

    <div className="overflow-x-auto overflow-y-auto scroll-smooth max-h-[calc(100vh-230px)] rounded-xl border border-white/5 bg-black/40 backdrop-blur-md custom-scrollbar">
      <table className="w-full text-left text-sm relative">
        <thead className="bg-[#1a1a1a] text-xs uppercase text-gray-400 sticky top-0 z-10 shadow-lg shadow-black/20">
          <tr className="border-b border-white/5">
            <Th id="sellDate" label="Sell Date" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="symbol" label="Symbol" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="marketCapCategory" label="Cap" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="quantity" label="Qty" align="right" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="buyDate" label="Buy Date" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <th className="md:px-6 px-4 py-4 font-semibold tracking-wider text-right">Buy Avg</th>
            <th className="md:px-6 px-4 py-4 font-semibold tracking-wider text-right">Sell Avg</th>
            <Th id="changePercent" label="Change" align="right" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="gainLoss" label="P/L" align="right" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
            <Th id="timeHeld" label="Days" align="right" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
          </tr>
        </thead>
        <tbody className="">
          {sortedExits.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-6 py-8 text-center text-gray-500">
                No exits recorded yet.
              </td>
            </tr>
          ) : (
            sortedExits.map((exit) => (
              <tr key={exit.id} className="hover:bg-white/5 transition-colors group border-b border-white/5 last:border-b-0">
                <td className="md:px-6 px-4 py-4 text-gray-300 whitespace-nowrap">
                  {format(exit.sellDate, 'dd MMM yyyy')}
                </td>
                <td className="md:px-6 px-4 py-4 font-medium text-white">
                  {exit.symbol}
                </td>
                <td className="md:px-6 px-4 py-4 text-gray-400 text-xs font-semibold uppercase">
                   {exit.marketCapCategory || '-'}
                </td>
                <td className="md:px-6 px-4 py-4 text-right text-gray-300 font-mono">
                  {formatNumber(exit.quantity, 0, 0)}
                </td>
                <td className="md:px-6 px-4 py-4 text-gray-400 whitespace-nowrap">
                  {format(exit.buyDate, 'dd MMM yyyy')}
                </td>
                <td className="md:px-6 px-4 py-4 text-right text-gray-300 font-mono">
                  {exit.buyPrice.toFixed(2)}
                </td>
                <td className="md:px-6 px-4 py-4 text-right text-gray-300 font-mono">
                  {exit.sellPrice.toFixed(2)}
                </td>
                <td className={`md:px-6 px-4 py-4 text-right font-mono font-medium ${exit.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {exit.changePercent > 0 ? '+' : ''}{exit.changePercent.toFixed(2)}%
                </td>
                <td className={`md:px-6 px-4 py-4 text-right font-mono font-medium ${exit.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatNumber(exit.gainLoss, 2, 2)}
                </td>
                <td className="md:px-6 px-4 py-4 text-right text-gray-400 font-mono">
                  {exit.timeHeld}d
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
