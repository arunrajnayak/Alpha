'use client';

import { useState, useMemo, memo, forwardRef } from 'react';
import { formatCurrency, formatNumber } from '@/lib/format';
import { PortfolioHolding } from '@/lib/types';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';
import { TableVirtuoso, TableComponents } from 'react-virtuoso';
import LazySparkline from './LazySparkline';

// Threshold for enabling virtualization (only virtualize large tables)
const VIRTUALIZATION_THRESHOLD = 25;

type SortKey = 'symbol' | 'age' | 'weight' | 'pnlPercent';
type SortDirection = 'asc' | 'desc';

// Styled components to match the "glass" look
const StyledTableCell = styled(TableCell)(() => ({
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  color: '#d1d5db', // gray-300
  '&.MuiTableCell-head': {
    backgroundColor: '#111827',
    color: '#9ca3af', // gray-400
    fontWeight: 600,
    textTransform: 'uppercase',
    fontSize: '0.75rem',
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': {
      color: 'white',
    },
  },
}));

const StyledTableRow = styled(TableRow)(() => ({
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
}));

// Sort indicator component - memoized to prevent unnecessary re-renders
const SortIndicator = memo(function SortIndicator({ 
  columnKey, 
  sortKey, 
  sortDirection 
}: { 
  columnKey: SortKey; 
  sortKey: SortKey; 
  sortDirection: SortDirection; 
}) {
  if (sortKey !== columnKey) {
    return <SwapVertIcon sx={{ fontSize: 14, ml: 0.5, opacity: 0.3, verticalAlign: 'middle' }} />;
  }
  return sortDirection === 'asc' 
    ? <ArrowUpwardIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} /> 
    : <ArrowDownwardIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'middle' }} />;
});

// Memoized chip components for better performance with many rows
const MarketCapChip = memo(function MarketCapChip({ category }: { category?: string }) {
    if (!category) return null;
    let color = '#9ca3af';
    let bg = 'rgba(156, 163, 175, 0.1)';
    
    switch (category) {
        case 'Large': color = '#67e8f9'; bg = 'rgba(103, 232, 249, 0.1)'; break; // cyan
        case 'Mid': color = '#c4b5fd'; bg = 'rgba(196, 181, 253, 0.1)'; break; // violet
        case 'Small': color = '#f0abfc'; bg = 'rgba(240, 171, 252, 0.1)'; break; // fuchsia
        case 'Micro': color = '#bef264'; bg = 'rgba(190, 242, 100, 0.1)'; break; // lime
    }

    return (
        <span className="text-[0.55rem] px-1.5 py-0.5 rounded-full uppercase font-medium tracking-wide" style={{ 
            backgroundColor: bg, 
            color: color,
        }}>
            {category}
        </span>
    );
});

const SECTOR_DISPLAY_NAMES: Record<string, string> = {
    'Engineering & Capital Goods': 'Capex',
    'Financial Services': 'Financials',
    'Software Services': 'Software',
    'Media & Entertainment': 'Media',
    'Tourism & Hospitality': 'Tourism',
    'Education & Training': 'Education',
    'Consumer Durables': 'Consumer',
    'Dairy Products': 'Dairy',
};

const SectorChip = memo(function SectorChip({ sector }: { sector?: string }) {
    if (!sector) return null;
    const displayName = SECTOR_DISPLAY_NAMES[sector] || sector;
    
    return (
        <span className="text-[0.55rem] px-1.5 py-0.5 rounded-full font-normal tracking-wide truncate max-w-[90px]" style={{ 
            backgroundColor: 'rgba(251, 191, 36, 0.1)', 
            color: '#d4a83a',
        }} title={sector}>
            {displayName}
        </span>
    );
});

// Memoized row component for virtualization
interface HoldingRowProps {
    holding: PortfolioHolding;
    totalPortfolioValue: number;
    index: number;
}

const HoldingRow = memo(function HoldingRow({ holding: h, totalPortfolioValue, index }: HoldingRowProps) {
    const avgPrice = h.invested / h.quantity;
    const isProfit = h.pnl >= 0;
    const weight = totalPortfolioValue > 0 ? (h.currentValue / totalPortfolioValue) * 100 : 0;
    
    return (
        <StyledTableRow sx={{ animationDelay: `${Math.min(index, 10) * 50}ms` }}>
            <StyledTableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 10, bgcolor: '#111827', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col gap-1">
                    <span className="font-semibold text-white">
                        {h.symbol}
                    </span>
                    <div className="hidden md:flex gap-1 flex-wrap">
                        <MarketCapChip category={h.marketCapCategory} />
                        <SectorChip sector={h.sector} />
                    </div>
                </div>
            </StyledTableCell>
            <StyledTableCell align="center" className="hidden md:table-cell" sx={{ display: { xs: 'none', md: 'table-cell' }, borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <LazySparkline 
                    symbol={h.symbol} 
                    initialData={h.priceHistory && h.priceHistory.length > 0 ? h.priceHistory : undefined} 
                />
            </StyledTableCell>
            <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col">
                    <span className="text-gray-300">{formatNumber(h.quantity, 0, 0)}</span>
                    <span className="text-gray-500 text-xs">{formatCurrency(avgPrice, 2, 2)}</span>
                </div>
            </StyledTableCell>
            <StyledTableCell align="center" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span className="text-gray-300 text-sm">
                    {typeof h.holdingPeriodDays === 'number' ? `${h.holdingPeriodDays}d` : '-'}
                </span>
            </StyledTableCell>
            <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                {formatCurrency(h.price, 2, 2)}
            </StyledTableCell>
            <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col">
                    <span className="text-white">{formatCurrency(h.currentValue)}</span>
                    <span className="text-gray-500 text-xs">{formatCurrency(h.invested)}</span>
                </div>
            </StyledTableCell>
            <StyledTableCell align="center" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <Chip 
                    label={`${weight.toFixed(1)}%`}
                    size="small"
                    sx={{ 
                        fontWeight: 600, 
                        fontSize: '0.75rem',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        color: '#a5b4fc',
                        height: '24px',
                        border: 'none',
                    }}
                />
            </StyledTableCell>
            <StyledTableCell align="center">
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Chip 
                        label={`${isProfit ? '▲' : '▼'} ${Math.abs(h.pnlPercent).toFixed(2)}%`}
                        size="small"
                        sx={{ 
                            fontWeight: 'bold', 
                            fontSize: '0.75rem',
                            height: '24px',
                            backgroundColor: isProfit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isProfit ? '#34d399' : '#f87171',
                            border: 'none',
                            boxShadow: isProfit ? '0 1px 2px rgba(16, 185, 129, 0.2)' : '0 1px 2px rgba(239, 68, 68, 0.2)'
                        }} 
                    />
                    <span className={`text-xs mt-1 ${isProfit ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        {isProfit ? '+' : ''}{formatCurrency(h.pnl)}
                    </span>
                </Box>
            </StyledTableCell>
        </StyledTableRow>
    );
});

export default function HoldingsTable({ holdings }: { holdings: PortfolioHolding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Calculate total portfolio value for weight calculation
  const totalPortfolioValue = useMemo(() => {
    return holdings.reduce((sum, h) => sum + h.currentValue, 0);
  }, [holdings]);

  // Sort holdings based on current sort state
  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortKey) {
        case 'symbol':
          aValue = a.symbol;
          bValue = b.symbol;
          break;
        case 'age':
          aValue = a.holdingPeriodDays ?? 0;
          bValue = b.holdingPeriodDays ?? 0;
          break;
        case 'weight':
          aValue = a.currentValue / totalPortfolioValue;
          bValue = b.currentValue / totalPortfolioValue;
          break;
        case 'pnlPercent':
          aValue = a.pnlPercent;
          bValue = b.pnlPercent;
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
      }

      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number) 
        : (bValue as number) - (aValue as number);
    });
  }, [holdings, sortKey, sortDirection, totalPortfolioValue]);

  const handleSort = (key: SortKey) => {
    const defaultKey = 'weight';
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

  // TableVirtuoso components for virtualized rendering
  const VirtuosoTableComponents: TableComponents<PortfolioHolding> = useMemo(() => {
    const VirtuosoScroller = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
      <TableContainer 
        component={Paper} 
        {...props} 
        ref={ref} 
        className="scroll-smooth" 
        sx={{ backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none' }}
      />
    ));
    VirtuosoScroller.displayName = 'VirtuosoScroller';

    const VirtuosoTableHead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>((props, ref) => (
      <TableHead {...props} ref={ref} sx={{ background: '#111827' }} />
    ));
    VirtuosoTableHead.displayName = 'VirtuosoTableHead';

    const VirtuosoTableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>((props, ref) => (
      <TableBody {...props} ref={ref} />
    ));
    VirtuosoTableBody.displayName = 'VirtuosoTableBody';

    return {
      Scroller: VirtuosoScroller,
      Table: (props) => (
        <Table {...props} sx={{ minWidth: 650, borderCollapse: 'separate', tableLayout: 'fixed' }} />
      ),
      TableHead: VirtuosoTableHead,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      TableRow: ({ item, ...props }) => <StyledTableRow {...props} />,
      TableBody: VirtuosoTableBody,
    };
  }, []);

  // Header row for virtualized table
  const fixedHeaderContent = () => (
    <TableRow>
      <StyledTableCell onClick={() => handleSort('symbol')} sx={{ position: 'sticky', left: 0, top: 0, zIndex: 20, bgcolor: '#111827', width: 150 }}>
        Symbol<SortIndicator columnKey="symbol" sortKey={sortKey} sortDirection={sortDirection} />
      </StyledTableCell>
      <StyledTableCell align="center" className="hidden md:table-cell" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' }, display: { xs: 'none', md: 'table-cell' }, width: 120 }}>
        1Y Chart
      </StyledTableCell>
      <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' }, width: 100 }}>
        Qty / Avg
      </StyledTableCell>
      <StyledTableCell align="center" onClick={() => handleSort('age')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', width: 70 }}>
        Age<SortIndicator columnKey="age" sortKey={sortKey} sortDirection={sortDirection} />
      </StyledTableCell>
      <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' }, width: 100 }}>
        LTP
      </StyledTableCell>
      <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' }, width: 130 }}>
        Current / Invested
      </StyledTableCell>
      <StyledTableCell align="center" onClick={() => handleSort('weight')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', width: 80 }}>
        Weight<SortIndicator columnKey="weight" sortKey={sortKey} sortDirection={sortDirection} />
      </StyledTableCell>
      <StyledTableCell align="center" onClick={() => handleSort('pnlPercent')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', width: 100 }}>
        P/L<SortIndicator columnKey="pnlPercent" sortKey={sortKey} sortDirection={sortDirection} />
      </StyledTableCell>
    </TableRow>
  );

  if (holdings.length === 0) {
      return (
        <Paper className="glass-card" sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent' }}>
            <FontAwesomeIcon icon={faInbox} className="text-4xl text-gray-600 mb-4 block" />
            <Typography variant="body1" sx={{ color: '#9ca3af' }}>No holdings found.</Typography>
        </Paper>
      );
  }

  // Use virtualization for large portfolios
  if (sortedHoldings.length > VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="glass-card glass-card-no-inset animate-fade-in-up" style={{ height: 'calc(100vh - 170px)' }}>
        <TableVirtuoso
          data={sortedHoldings}
          components={VirtuosoTableComponents}
          fixedHeaderContent={fixedHeaderContent}
          itemContent={(index, h) => (
            <>
              <StyledTableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 10, bgcolor: '#111827', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-white">{h.symbol}</span>
                  <div className="hidden md:flex gap-1 flex-wrap">
                    <MarketCapChip category={h.marketCapCategory} />
                    <SectorChip sector={h.sector} />
                  </div>
                </div>
              </StyledTableCell>
              <StyledTableCell align="center" className="hidden md:table-cell" sx={{ display: { xs: 'none', md: 'table-cell' }, borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <LazySparkline symbol={h.symbol} initialData={h.priceHistory && h.priceHistory.length > 0 ? h.priceHistory : undefined} />
              </StyledTableCell>
              <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col">
                  <span className="text-gray-300">{formatNumber(h.quantity, 0, 0)}</span>
                  <span className="text-gray-500 text-xs">{formatCurrency(h.invested / h.quantity, 2, 2)}</span>
                </div>
              </StyledTableCell>
              <StyledTableCell align="center" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span className="text-gray-300 text-sm">
                  {typeof h.holdingPeriodDays === 'number' ? `${h.holdingPeriodDays}d` : '-'}
                </span>
              </StyledTableCell>
              <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                {formatCurrency(h.price, 2, 2)}
              </StyledTableCell>
              <StyledTableCell align="right" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div className="flex flex-col">
                  <span className="text-white">{formatCurrency(h.currentValue)}</span>
                  <span className="text-gray-500 text-xs">{formatCurrency(h.invested)}</span>
                </div>
              </StyledTableCell>
              <StyledTableCell align="center" sx={{ borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <Chip label={`${(totalPortfolioValue > 0 ? (h.currentValue / totalPortfolioValue) * 100 : 0).toFixed(1)}%`} size="small" sx={{ fontWeight: 600, fontSize: '0.75rem', backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', height: '24px', border: 'none' }} />
              </StyledTableCell>
              <StyledTableCell align="center">
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Chip label={`${h.pnl >= 0 ? '▲' : '▼'} ${Math.abs(h.pnlPercent).toFixed(2)}%`} size="small" sx={{ fontWeight: 'bold', fontSize: '0.75rem', height: '24px', backgroundColor: h.pnl >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: h.pnl >= 0 ? '#34d399' : '#f87171', border: 'none', boxShadow: h.pnl >= 0 ? '0 1px 2px rgba(16, 185, 129, 0.2)' : '0 1px 2px rgba(239, 68, 68, 0.2)' }} />
                  <span className={`text-xs mt-1 ${h.pnl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>{h.pnl >= 0 ? '+' : ''}{formatCurrency(h.pnl)}</span>
                </Box>
              </StyledTableCell>
            </>
          )}
        />
      </div>
    );
  }

  // Standard table for smaller portfolios (better for animation, no virtualization overhead)
  return (
    <TableContainer component={Paper} className="glass-card glass-card-no-inset animate-fade-in-up scroll-smooth" sx={{ backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none', maxHeight: 'calc(100vh - 170px)', overflow: 'auto' }}>
        <Table sx={{ minWidth: 650 }} aria-label="holdings table">
            <TableHead sx={{ background: '#111827' }}>
                <TableRow>
                    <StyledTableCell onClick={() => handleSort('symbol')} sx={{ position: 'sticky', left: 0, top: 0, zIndex: 20, bgcolor: '#111827' }}>
                      Symbol<SortIndicator columnKey="symbol" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="center" className="hidden md:table-cell" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' }, display: { xs: 'none', md: 'table-cell' } }}>
                      1Y Chart
                    </StyledTableCell>
                    <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' } }}>
                      Qty / Avg
                    </StyledTableCell>
                    <StyledTableCell align="center" onClick={() => handleSort('age')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Age<SortIndicator columnKey="age" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' } }}>
                      LTP
                    </StyledTableCell>
                    <StyledTableCell align="right" sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827', cursor: 'default', '&:hover': { color: '#9ca3af' } }}>
                      Current / Invested
                    </StyledTableCell>
                    <StyledTableCell align="center" onClick={() => handleSort('weight')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Weight<SortIndicator columnKey="weight" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="center" onClick={() => handleSort('pnlPercent')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      P/L<SortIndicator columnKey="pnlPercent" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {sortedHoldings.map((h, i) => (
                    <HoldingRow key={h.symbol} holding={h} totalPortfolioValue={totalPortfolioValue} index={i} />
                ))}
            </TableBody>
        </Table>
    </TableContainer>
  );
}
