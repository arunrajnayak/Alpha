import React, { useState, useMemo } from 'react';
import { 
    Dialog, DialogTitle, DialogContent, 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
    Paper, Typography, IconButton, Box
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { format } from 'date-fns';
import { HistoricalHolding } from '@/app/actions';
import { formatCurrency, formatNumber } from '@/lib/format';
import TableSkeleton from '@/components/ui/TableSkeleton';

interface HoldingsModalProps {
    open: boolean;
    onClose: () => void;
    date: Date | null;
    holdings: HistoricalHolding[];
    isLoading: boolean;
}

// const formatCurrency = (val: number) => {
//     return new Intl.NumberFormat('en-IN', {
//         style: 'currency',
//         currency: 'INR',
//         maximumFractionDigits: 0
//     }).format(val);
// };

type SortKey = 'symbol' | 'quantity' | 'price' | 'currentValue' | 'pnl';
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

export default function HoldingsModal({ open, onClose, date, holdings, isLoading }: HoldingsModalProps) {
    const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
    
    
    const [sortKey, setSortKey] = useState<SortKey>('currentValue');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection(key === 'symbol' ? 'asc' : 'desc'); // Default to ASC for symbol, DESC for stats
        }
    };



    const sortedHoldings = useMemo(() => {
        return [...holdings].sort((a, b) => {
            let aValue: number | string = 0;
            let bValue: number | string = 0;

            switch (sortKey) {
                case 'symbol':
                    aValue = a.symbol;
                    bValue = b.symbol;
                    break;
                case 'quantity':
                    aValue = a.quantity;
                    bValue = b.quantity;
                    break;
                case 'price':
                    aValue = a.price;
                    bValue = b.price;
                    break;
                case 'currentValue':
                    aValue = a.currentValue;
                    bValue = b.currentValue;
                    break;
                case 'pnl':
                    aValue = a.pnl;
                    bValue = b.pnl;
                    break;
            }

            if (sortKey === 'symbol') {
                return sortDirection === 'asc' 
                    ? (aValue as string).localeCompare(bValue as string)
                    : (bValue as string).localeCompare(aValue as string);
            }

            return sortDirection === 'asc' 
                ? (aValue as number) - (bValue as number)
                : (bValue as number) - (aValue as number);
        });
    }, [holdings, sortKey, sortDirection]);

    return (
        <Dialog 
            open={open} 
            onClose={onClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                style: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    backdropFilter: 'blur(16px)',
                    color: 'white',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                }
            }}
        >
            <DialogTitle sx={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', pb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography variant="overline" sx={{ color: 'gray', lineHeight: 1, letterSpacing: 1.5 }}>
                        HOLDINGS SNAPSHOT
                    </Typography>
                    <IconButton onClick={onClose} size="small" sx={{ color: 'gray', '&:hover': { color: 'white' }, mt: -0.5, mr: -0.5 }}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                
                {date && (
                    <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Paper sx={{ 
                            p: 2, 
                            flex: 1, 
                            backgroundColor: 'rgba(255, 255, 255, 0.03)', 
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: 2
                        }}>
                            <Typography variant="caption" sx={{ color: 'gray', display: 'block', mb: 0.5, letterSpacing: 1 }}>
                                SNAPSHOT DATE
                            </Typography>
                            <Typography variant="h5" component="div" sx={{ color: 'white', fontWeight: 600 }}>
                                {format(date, 'dd MMM yyyy')}
                            </Typography>
                        </Paper>
                        
                        <Paper sx={{ 
                            p: 2, 
                            flex: 1, 
                            backgroundColor: 'rgba(255, 255, 255, 0.03)', 
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: 2,
                            textAlign: 'right'
                        }}>
                            <Typography variant="caption" sx={{ color: 'gray', display: 'block', mb: 0.5, letterSpacing: 1 }}>
                                TOTAL VALUE
                            </Typography>
                            <Typography variant="h5" component="div" sx={{ color: '#34d399', fontWeight: 600, fontFamily: 'monospace' }}>
                                {formatCurrency(totalValue)}
                            </Typography>
                        </Paper>
                    </Box>
                )}
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
                {isLoading ? (
                    <TableSkeleton rows={8} cols={7} showHeader={true} />
                ) : holdings.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography sx={{ color: 'gray' }}>No holdings found for this date.</Typography>
                    </Box>
                ) : (
                    <TableContainer component={Paper} sx={{ backgroundColor: 'transparent', boxShadow: 'none', maxHeight: '60vh' }}>
                        <Table stickyHeader size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell 
                                        onClick={() => handleSort('symbol')}
                                        sx={{ cursor: 'pointer', backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        Symbol <SortIndicator columnKey="symbol" sortKey={sortKey} sortDirection={sortDirection} />
                                    </TableCell>
                                    <TableCell 
                                        align="right" 
                                        onClick={() => handleSort('quantity')}
                                        sx={{ cursor: 'pointer', backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        Qty <SortIndicator columnKey="quantity" sortKey={sortKey} sortDirection={sortDirection} />
                                    </TableCell>
                                    <TableCell 
                                        align="right" 
                                        onClick={() => handleSort('price')}
                                        sx={{ cursor: 'pointer', backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        Avg Price <SortIndicator columnKey="price" sortKey={sortKey} sortDirection={sortDirection} />
                                    </TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>Close Price</TableCell>
                                    <TableCell 
                                        align="right" 
                                        onClick={() => handleSort('currentValue')}
                                        sx={{ cursor: 'pointer', backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        Value <SortIndicator columnKey="currentValue" sortKey={sortKey} sortDirection={sortDirection} />
                                    </TableCell>
                                    <TableCell 
                                        align="right" 
                                        onClick={() => handleSort('pnl')}
                                        sx={{ cursor: 'pointer', backgroundColor: 'rgba(17, 24, 39, 1)', color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        P/L <SortIndicator columnKey="pnl" sortKey={sortKey} sortDirection={sortDirection} />
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {sortedHoldings.map((h) => {
                                    const isProfit = h.pnl >= 0;
                                    return (
                                        <TableRow key={h.symbol} hover sx={{ '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }}>
                                            <TableCell sx={{ color: 'white', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                {h.symbol}
                                            </TableCell>
                                            <TableCell align="right" sx={{ color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                {formatNumber(h.quantity, 0, 0)}
                                            </TableCell>
                                            <TableCell align="right" sx={{ color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                {(h.invested / h.quantity).toFixed(2)}
                                            </TableCell>
                                            <TableCell align="right" sx={{ color: 'gray', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                {h.price.toFixed(2)}
                                            </TableCell>
                                            <TableCell align="right" sx={{ color: 'white', fontWeight: 500, borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                {formatCurrency(h.currentValue)}
                                            </TableCell>
                                            <TableCell align="right" sx={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                <span className={isProfit ? 'text-emerald-400' : 'text-red-400'}>
                                                    {isProfit ? '+' : ''}{formatCurrency(h.pnl)} <br/>
                                                    <span className="text-xs op-70">({h.pnlPercent.toFixed(2)}%)</span>
                                                </span>
                                            </TableCell>

                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </DialogContent>
        </Dialog>
    );
}
