'use client';

import { useState, useMemo, memo } from 'react';
import { formatCurrency, formatNumber } from '@/lib/format';
import { HistoricalHoldingData } from '@/lib/types';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { styled } from '@mui/material/styles';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';

type SortKey = 'symbol' | 'totalPnl' | 'realizedPnl' | 'unrealizedPnl' | 'currentValue' | 'quantity';
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

export default function HistoricalHoldingsTable({ holdings }: { holdings: HistoricalHoldingData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('totalPnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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
        case 'quantity':
            aValue = a.quantity;
            bValue = b.quantity;
            break;
        case 'currentValue':
            aValue = a.currentValue;
            bValue = b.currentValue;
            break;
        case 'realizedPnl':
            aValue = a.realizedPnl;
            bValue = b.realizedPnl;
            break;
        case 'unrealizedPnl':
            aValue = a.unrealizedPnl;
            bValue = b.unrealizedPnl;
            break;

        case 'totalPnl':
            aValue = a.totalPnl;
            bValue = b.totalPnl;
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
  }, [holdings, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    const defaultKey = 'totalPnl';
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

  if (holdings.length === 0) {
      return (
        <Paper className="glass-card" sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent' }}>
            <FontAwesomeIcon icon={faInbox} className="text-4xl text-gray-600 mb-4 block" />
            <Typography variant="body1" sx={{ color: '#9ca3af' }}>No historical holdings found.</Typography>
        </Paper>
      );
  }

  // const formatCurrency = (val: number) => `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; // Removed local definition
  const formatPnl = (val: number) => {
      if (val === 0) {
          return <span className="text-gray-400">{formatCurrency(val, 0, 0)}</span>;
      }
      const isProfit = val > 0;
      return (
          <span className={isProfit ? 'text-emerald-400' : 'text-red-400'}>
              {isProfit ? '+' : ''}{formatCurrency(val, 0, 0)}
          </span>
      );
  };

  return (
    <TableContainer component={Paper} className="glass-card glass-card-no-inset animate-fade-in-up scroll-smooth" sx={{ backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none', maxHeight: 'calc(100vh - 170px)', overflow: 'auto' }}>
        <Table sx={{ minWidth: 650 }} aria-label="historical holdings table">
            <TableHead sx={{ background: '#111827' }}>
                <TableRow>
                    <StyledTableCell onClick={() => handleSort('symbol')} sx={{ position: 'sticky', left: 0, top: 0, zIndex: 20, bgcolor: '#111827' }}>
                      Symbol<SortIndicator columnKey="symbol" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="right" onClick={() => handleSort('quantity')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Hold Qty<SortIndicator columnKey="quantity" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="right" onClick={() => handleSort('currentValue')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Current Value<SortIndicator columnKey="currentValue" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="right" onClick={() => handleSort('realizedPnl')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Realized P/L<SortIndicator columnKey="realizedPnl" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                    <StyledTableCell align="right" onClick={() => handleSort('unrealizedPnl')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Unrealized P/L<SortIndicator columnKey="unrealizedPnl" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>

                    <StyledTableCell align="right" onClick={() => handleSort('totalPnl')} sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: '#111827' }}>
                      Total P/L<SortIndicator columnKey="totalPnl" sortKey={sortKey} sortDirection={sortDirection} />
                    </StyledTableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {sortedHoldings.map((h, i) => {
                    const isProfit = h.totalPnl >= 0;
                    return (
                        <StyledTableRow 
                          key={h.symbol} 
                          sx={{ animationDelay: `${i * 50}ms` }}
                        >
                            <StyledTableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 10, bgcolor: '#111827' }}>
                                <span className="font-semibold text-white">
                                    {h.symbol}
                                </span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <span className="text-gray-300">{h.quantity > 0 ? formatNumber(h.quantity, 0, 0) : '-'}</span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <span className="text-gray-300">{h.quantity > 0 ? formatCurrency(h.currentValue, 0, 0) : '-'}</span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                {formatPnl(h.realizedPnl)}
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                {h.quantity > 0 ? formatPnl(h.unrealizedPnl) : <span className="text-gray-600">-</span>}
                            </StyledTableCell>

                            <StyledTableCell align="right">
                                <Chip 
                                    label={`${isProfit && h.totalPnl !== 0 ? '+' : ''}${formatNumber(h.totalPnl, 0, 0)}`}
                                    size="small"
                                    sx={{ 
                                        fontWeight: 'bold', 
                                        fontSize: '0.75rem',
                                        height: '24px',
                                        backgroundColor: h.totalPnl === 0 ? 'rgba(156, 163, 175, 0.15)' : isProfit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                        color: h.totalPnl === 0 ? '#9ca3af' : isProfit ? '#34d399' : '#f87171',
                                        border: 'none',
                                    }} 
                                />
                            </StyledTableCell>
                        </StyledTableRow>
                    );
                })}
            </TableBody>
        </Table>
    </TableContainer>
  );
}
