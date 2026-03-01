'use client';

import { 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
    Paper, Typography, Tooltip
} from '@mui/material';
import { formatCurrency } from '@/lib/format';
import { styled } from '@mui/material/styles';
import { format } from 'date-fns';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';
import { WeeklyPortfolioSnapshot } from '@prisma/client';
import ReturnChip from './ReturnChip';

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

const formatMcap = (large: number | null, mid: number | null, small: number | null, micro: number | null) => {
    const l = large ? Math.round(large) : 0;
    const m = mid ? Math.round(mid) : 0;
    const s = small ? Math.round(small) : 0;
    const mi = micro ? Math.round(micro) : 0;
    
    // Calculate total roughly to ensure it fits 100% or close to it
    // const total = l + m + s + mi;

    return (
        <Tooltip title={
            <div className="text-xs">
                <div>Large: <span className="text-cyan-400">{l}%</span></div>
                <div>Mid: <span className="text-violet-400">{m}%</span></div>
                <div>Small: <span className="text-fuchsia-400">{s}%</span></div>
                <div>Micro: <span className="text-lime-400">{mi}%</span></div>
            </div>
        }>
            <div className="flex h-3 w-32 rounded-full overflow-hidden bg-gray-800 mx-auto border border-gray-700">
                {l > 0 && <div style={{ width: `${l}%` }} className="h-full bg-cyan-500" />}
                {m > 0 && <div style={{ width: `${m}%` }} className="h-full bg-violet-500" />}
                {s > 0 && <div style={{ width: `${s}%` }} className="h-full bg-fuchsia-500" />}
                {mi > 0 && <div style={{ width: `${mi}%` }} className="h-full bg-lime-500" />}
            </div>
        </Tooltip>
    );
};

const formatWinLossAvg = (avgWin: number | null, avgLoss: number | null) => {
    const w = avgWin || 0;
    const l = avgLoss ? Math.abs(avgLoss) : 0;
    const total = w + l;
    
    if (total === 0) return <span className="text-gray-500">-</span>;

    const wPct = (w / total) * 100;
    const lPct = (l / total) * 100;

    return (
        <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-medium text-emerald-400 min-w-[32px] text-right">{w.toFixed(1)}</span>
            <div className="flex h-3 w-24 rounded-full overflow-hidden bg-gray-800 border border-gray-700">
                <div style={{ width: `${wPct}%` }} className="h-full bg-emerald-500" />
                <div style={{ width: `${lPct}%` }} className="h-full bg-rose-500" />
            </div>
            <span className="text-xs font-medium text-rose-400 min-w-[32px] text-left">{l.toFixed(1)}</span>
        </div>
    );
};

export default function WeeklySnapshotTable({ snapshots }: { snapshots: WeeklyPortfolioSnapshot[] }) {
    if (!snapshots || snapshots.length === 0) {
        return (
            <Paper className="glass-card" sx={{ p: 4, textAlign: 'center', backgroundColor: 'transparent' }}>
                <FontAwesomeIcon icon={faInbox} className="text-4xl text-gray-600 mb-4 block" />
                <Typography variant="body1" sx={{ color: '#9ca3af' }}>No weekly snapshots found.</Typography>
            </Paper>
        );
    }

    return (
        <TableContainer component={Paper} className="glass-card animate-fade-in-up" sx={{ height: 'calc(100vh - 180px)', overflow: 'auto', backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none' }}>
            <Table stickyHeader sx={{ minWidth: 1000 }} aria-label="weekly snapshot table">
                <TableHead>
                    <TableRow>
                        <StyledTableCell>Date</StyledTableCell>
                        <StyledTableCell align="right">Closing Value</StyledTableCell>
                        <StyledTableCell align="right">NAV</StyledTableCell>
                        <StyledTableCell align="right">Return</StyledTableCell>
                        <StyledTableCell align="right">Win %</StyledTableCell>
                        <StyledTableCell align="center">
                            <span>Win/Loss Avg</span>
                        </StyledTableCell>
                         <StyledTableCell align="right">
                             <Tooltip title="Avg Holding Period (Days)">
                                <span>Hold Days</span>
                             </Tooltip>
                         </StyledTableCell>
                        <StyledTableCell align="center">
                            <Tooltip title="Large/Mid/Small/Micro %">
                                <span>Mcap Split</span>
                            </Tooltip>
                        </StyledTableCell>
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
                                        {format(new Date(row.date), 'dd MMM yyyy')}
                                    </span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-white font-medium">{formatCurrency(row.totalEquity)}</span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-blue-300 font-mono">{row.nav != null ? row.nav.toFixed(2) : '-'}</span>
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <ReturnChip value={row.weeklyReturn} period="weekly" />
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-gray-300">
                                        {row.winPercent != null ? `${row.winPercent.toFixed(1)}%` : '-'}
                                    </span>
                                </StyledTableCell>
                                <StyledTableCell align="center">
                                    {formatWinLossAvg(row.avgWinnerGain, row.avgLoserLoss)}
                                </StyledTableCell>
                                <StyledTableCell align="right">
                                    <span className="text-gray-400">
                                        {row.avgHoldingPeriod != null ? row.avgHoldingPeriod.toFixed(1) : '-'}
                                    </span>
                                </StyledTableCell>
                                <StyledTableCell align="center">
                                    {formatMcap(row.largeCapPercent, row.midCapPercent, row.smallCapPercent, row.microCapPercent)}
                                </StyledTableCell>
                            </StyledTableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
