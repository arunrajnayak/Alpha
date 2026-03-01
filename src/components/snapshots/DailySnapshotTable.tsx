'use client';

import React, { useState, useMemo } from 'react';
import { 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
    Paper, Typography 
} from '@mui/material';
import { formatCurrency } from '@/lib/format';
import { TableVirtuoso } from 'react-virtuoso';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';
import { styled } from '@mui/material/styles';
import { format } from 'date-fns';
import { DailyPortfolioSnapshot } from '@prisma/client';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import HoldingsModal from './HoldingsModal';
import { getSnapshotHoldings, HistoricalHolding } from '@/app/actions';
import ReturnChip from './ReturnChip';

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

// Formatter helper
// const formatCurrency = (val: number) => {
//     return new Intl.NumberFormat('en-IN', {
//         style: 'currency',
//         currency: 'INR',
//         maximumFractionDigits: 0
//     }).format(val);
// };

type SortKey = 'date' | 'portfolioNAV' | 'dailyReturn' | 'dailyPnL' | 'drawdown' | 'cashflow';
type SortDirection = 'asc' | 'desc';

function SortIndicator({ 
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
}

// Virtuoso Components customized for this table
const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof TableContainer>>((props, ref) => (
    <TableContainer component={Paper} {...props} ref={ref} sx={{ boxShadow: 'none', backgroundColor: 'transparent' }} />
));
VirtuosoScroller.displayName = 'VirtuosoScroller';

const VirtuosoTable = (props: React.ComponentProps<typeof Table>) => (
    <Table {...props} sx={{ borderCollapse: 'separate', tableLayout: 'fixed' }} />
);

const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<typeof TableHead>>((props, ref) => (
    <TableHead {...props} ref={ref} sx={{ position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }} />
));
VirtuosoTableHead.displayName = 'VirtuosoTableHead';

const VirtuosoTableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<typeof TableBody>>((props, ref) => (
    <TableBody {...props} ref={ref} />
));
VirtuosoTableBody.displayName = 'VirtuosoTableBody';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const VirtuosoTableRow = ({ item, ...props }: { item: DailyPortfolioSnapshot } & React.ComponentProps<typeof TableRow>) => <StyledTableRow {...props} />;

export default function DailySnapshotTable({ snapshots }: { snapshots: DailyPortfolioSnapshot[], lockDate: string | null }) {
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    
    // Modal State
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [holdings, setHoldings] = useState<HistoricalHolding[]>([]);
    const [loadingHoldings, setLoadingHoldings] = useState(false);
    
    const handleViewHoldings = async (date: Date) => {
        setSelectedDate(date);
        setModalOpen(true);
        setLoadingHoldings(true);
        try {
            const data = await getSnapshotHoldings(date.toISOString());
            setHoldings(data);
        } catch (error) {
            console.error("Failed to fetch holdings:", error);
        } finally {
            setLoadingHoldings(false);
        }
    };

    const handleSort = (key: SortKey) => {
        const defaultKey = 'date';
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

    const filteredSnapshots = useMemo(() => {
        return snapshots.filter(s => Math.abs(s.dailyReturn || 0) > 0.000001 || Math.abs(s.cashflow || 0) > 0.01);
    }, [snapshots]);

    const sortedSnapshots = useMemo(() => {
        const compare = (a: number | null | undefined, b: number | null | undefined, asc: boolean) => {
            if (a === b) return 0;
            if (a === null || a === undefined) return 1; // Always nulls last
            if (b === null || b === undefined) return -1;
            return asc ? a - b : b - a;
        };

        return [...filteredSnapshots].sort((a, b) => {
            const isAsc = sortDirection === 'asc';
            
            // Special handling for Date (always present)
            if (sortKey === 'date') {
                 const timeA = new Date(a.date).getTime();
                 const timeB = new Date(b.date).getTime();
                 return isAsc ? timeA - timeB : timeB - timeA;
            }

            let valA: number | null | undefined;
            let valB: number | null | undefined;

            switch (sortKey) {
                case 'portfolioNAV':
                    valA = a.portfolioNAV;
                    valB = b.portfolioNAV;
                    break;
                case 'dailyReturn':
                    valA = a.dailyReturn;
                    valB = b.dailyReturn;
                    break;
                case 'dailyPnL':
                    valA = a.dailyPnL;
                    valB = b.dailyPnL;
                    break;
                case 'drawdown':
                    valA = a.drawdown;
                    valB = b.drawdown;
                    break;
                case 'cashflow':
                    valA = a.cashflow;
                    valB = b.cashflow;
                    break;
                default:
                    return 0;
            }

            return compare(valA, valB, isAsc);
        });
    }, [filteredSnapshots, sortKey, sortDirection]);

    if (!filteredSnapshots || filteredSnapshots.length === 0) {
        return (
            <Paper className="glass-card" sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent' }}>
                <FontAwesomeIcon icon={faInbox} className="text-4xl text-gray-600 mb-4 block" />
                <Typography variant="body1" sx={{ color: '#9ca3af' }}>No trading activity found (zero return days hidden).</Typography>
            </Paper>
        );
    }

    return (
        <>
        <Paper className="glass-card animate-fade-in-up" sx={{ height: 'calc(100vh - 180px)', backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none', overflow: 'hidden' }}>
            <TableVirtuoso
                data={sortedSnapshots}
                components={{
                    Scroller: VirtuosoScroller,
                    Table: VirtuosoTable,
                    TableHead: VirtuosoTableHead,
                    TableBody: VirtuosoTableBody,
                    TableRow: VirtuosoTableRow,
                }}
                fixedHeaderContent={() => (
                    <TableRow sx={{ backgroundColor: '#111827' }}>
                        <StyledTableCell onClick={() => handleSort('date')} sx={{ width: '150px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                            Date <SortIndicator columnKey="date" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                        <StyledTableCell align="right" sx={{ width: '120px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>Closing Value</StyledTableCell>
                        <StyledTableCell align="right" sx={{ width: '120px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>Invested</StyledTableCell>
                        <StyledTableCell align="right" onClick={() => handleSort('cashflow')} sx={{ width: '110px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>
                            Cashflow <SortIndicator columnKey="cashflow" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                        <StyledTableCell align="right" onClick={() => handleSort('portfolioNAV')} sx={{ width: '100px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>
                            NAV <SortIndicator columnKey="portfolioNAV" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                        <StyledTableCell align="right" onClick={() => handleSort('dailyReturn')} sx={{ width: '120px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>
                            Return <SortIndicator columnKey="dailyReturn" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                        <StyledTableCell align="right" onClick={() => handleSort('dailyPnL')} sx={{ width: '120px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>
                            P/L <SortIndicator columnKey="dailyPnL" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                        <StyledTableCell align="right" onClick={() => handleSort('drawdown')} sx={{ width: '100px', position: 'sticky', top: 0, zIndex: 100, backgroundColor: '#111827' }}>
                            Drawdown <SortIndicator columnKey="drawdown" sortKey={sortKey} sortDirection={sortDirection} />
                        </StyledTableCell>
                    </TableRow>
                )}
                itemContent={(index, row) => {
                    const isProfit = (row.dailyPnL || 0) >= 0;

                    return (
                        <>
                            <StyledTableCell component="th" scope="row" sx={{ backgroundColor: '#111827', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                                <span className="font-semibold text-white">
                                    {format(new Date(row.date), 'dd MMM yyyy')}
                                </span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <span 
                                    className="text-white font-medium cursor-pointer hover:text-blue-400 hover:underline transition-colors"
                                    onClick={() => handleViewHoldings(new Date(row.date))}
                                    title="View Holdings"
                                >
                                    {formatCurrency(row.totalEquity)}
                                </span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <span className="text-gray-400">{formatCurrency(row.investedCapital)}</span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                {(() => {
                                    // Hide cashflow for the first day (last in list since sorted desc by default)
                                    // Actually, we sort by date. If sorted desc (newest first), last item is 1st day.
                                    // If sorted asc (oldest first), first item is 1st day.
                                    
                                    // Robust check: Is this the earliest date in the full list?
                                    // Since we receive `snapshots` prop which might be filtered/sorted...
                                    // Let's just key off index if we are sure about sort order.
                                    // Virtuoso renders based on `sortedSnapshots`.
                                    
                                    // Safest way: Check against the oldest date in the entire set
                                    const isFirstDay = row.date === sortedSnapshots[sortedSnapshots.length - 1].date || 
                                                       (sortDirection === 'asc' && index === 0) ||
                                                       (sortDirection === 'desc' && index === sortedSnapshots.length - 1);

                                    if (isFirstDay) return <span className="text-gray-500 text-xs">-</span>;

                                    const cf = row.cashflow || 0;
                                    if (Math.abs(cf) < 0.01) return <span className="text-gray-500 text-xs">-</span>;
                                    const isPositive = cf > 0;
                                    return (
                                        <span className={`text-xs font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {isPositive ? '+' : ''}{formatCurrency(cf)}
                                        </span>
                                    );
                                })()}
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <span className="text-blue-300 font-mono">{row.portfolioNAV != null ? row.portfolioNAV.toFixed(2) : '-'}</span>
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                <ReturnChip value={row.dailyReturn} period="daily" />
                            </StyledTableCell>
                            <StyledTableCell align="right">
                                    <span className={`text-sm ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {row.dailyPnL != null ? (isProfit ? '+' : '') + formatCurrency(row.dailyPnL, 0, 0) : '-'}
                                    </span>
                            </StyledTableCell>
                                <StyledTableCell align="right">
                                    {(() => {
                                        const dd = row.drawdown || 0;
                                        // Effectively zero (allowing for tiny float errors)
                                        const isATH = dd >= -0.0001; 
                                        
                                        let colorClass = 'text-gray-400';
                                        if (isATH) colorClass = 'text-orange-500 font-bold flex items-center justify-end gap-1';
                                        else if (dd < -0.20) colorClass = 'text-red-500 font-medium';
                                        else if (dd < -0.10) colorClass = 'text-orange-400';
                                        else if (dd < -0.05) colorClass = 'text-amber-400';

                                        if (isATH) {
                                            return (
                                                <span className={colorClass}>
                                                    ATH <RocketLaunchIcon sx={{ fontSize: 16 }} />
                                                </span>
                                            );
                                        }

                                        return (
                                            <span className={colorClass}>
                                                {(dd * 100).toFixed(2)}%
                                            </span>
                                        );
                                    })()}
                                </StyledTableCell>
                        </>
                    );
                }}
            />
        </Paper>
        <HoldingsModal 
            open={modalOpen} 
            onClose={() => setModalOpen(false)} 
            date={selectedDate} 
            holdings={holdings} 
            isLoading={loadingHoldings} 
        />
        </>
    );
}
