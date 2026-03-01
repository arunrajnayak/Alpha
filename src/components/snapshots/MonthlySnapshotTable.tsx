'use client';

import { 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
    Paper, Typography
} from '@mui/material';
import { formatCurrency } from '@/lib/format';
import { styled } from '@mui/material/styles';
import { format } from 'date-fns';
import { MonthlyPortfolioSnapshot } from '@prisma/client';
import ReturnChip from './ReturnChip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';

const StyledTableCell = styled(TableCell)(() => ({
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    color: '#d1d5db',
    whiteSpace: 'nowrap',
    '&.MuiTableCell-head': {
        backgroundColor: '#111827',
        color: '#9ca3af',
        fontWeight: 600,
        textTransform: 'uppercase',
        fontSize: '0.75rem',
    },
}));

const StyledTableRow = styled(TableRow)(() => ({
    '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
}));

// const formatCurrency = (val: number) => {
//     return new Intl.NumberFormat('en-IN', {
//         style: 'currency',
//         currency: 'INR',
//         maximumFractionDigits: 0
//     }).format(val);
// };





export default function MonthlySnapshotTable({ snapshots }: { snapshots: MonthlyPortfolioSnapshot[] }) {
    if (!snapshots || snapshots.length === 0) {
        return (
            <Paper className="glass-card" sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent' }}>
                <FontAwesomeIcon icon={faInbox} className="text-4xl text-gray-600 mb-4 block" />
                <Typography variant="body1" sx={{ color: '#9ca3af' }}>No monthly snapshots found.</Typography>
            </Paper>
        );
    }
    return (
        <TableContainer component={Paper} className="glass-card animate-fade-in-up" sx={{ height: 'calc(100vh - 180px)', overflow: 'auto', backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none' }}>
            <Table stickyHeader sx={{ minWidth: 1000 }} aria-label="monthly snapshot table">
                <TableHead>
                    <TableRow>
                        <StyledTableCell>Date</StyledTableCell>
                        <StyledTableCell align="right">Closing Value</StyledTableCell>
                        <StyledTableCell align="right">NAV</StyledTableCell>
                        <StyledTableCell align="right">Return</StyledTableCell>
                        <StyledTableCell align="center">Trades</StyledTableCell>
                        <StyledTableCell align="center">Avg Trades</StyledTableCell>

                    </TableRow>
                </TableHead>
                <TableBody>
                    {snapshots.map((row, i) => {
                    
                        return (
                            <StyledTableRow 
                                key={row.id}
                                sx={{ animationDelay: `${i * 50}ms` }}
                            >
                                <StyledTableCell component="th" scope="row">
                                    <span className="font-semibold text-white">
                                        {format(new Date(row.date), 'MMM yyyy')}
                                    </span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-white font-medium">{formatCurrency(row.totalEquity)}</span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-blue-300 font-mono">{row.nav != null ? row.nav.toFixed(2) : '-'}</span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <ReturnChip value={row.monthlyReturn} period="monthly" />
                                </StyledTableCell>
                                <StyledTableCell align="center">
                                    <span className="text-gray-300">
                                        {row.exitCount != null ? row.exitCount : '-'}
                                    </span>
                                </StyledTableCell>
                                <StyledTableCell align="center">
                                    <span className="text-gray-300">
                                        {row.avgExitsPerMonth != null ? row.avgExitsPerMonth.toFixed(1) : '-'}
                                    </span>
                                </StyledTableCell>


                            </StyledTableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
