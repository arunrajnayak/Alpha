
import { prisma } from "@/lib/db";
import { format } from "date-fns";
import { formatCurrency } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WeeklySnapshotPage() {
    const snapshots = await prisma.weeklyPortfolioSnapshot.findMany({
        orderBy: { date: 'desc' },
        take: 52 
    });

    return (
        <div style={{ padding: '2rem' }}>
            <h1 style={{ marginBottom: '1.5rem' }}>Weekly Snapshots</h1>
            <div className="scroll-smooth" style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
                            <th style={{ padding: '1rem' }}>Date</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Total Equity</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>NAV</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Weekly Return</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Win %</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Loss %</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Avg Hold (Days)</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Large Cap %</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Mid Cap %</th>
                            <th style={{ padding: '1rem', textAlign: 'right' }}>Small Cap %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {snapshots.map((s) => (
                            <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '1rem' }}>{format(s.date, 'dd/MM/yyyy')}</td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>{formatCurrency(s.totalEquity)}</td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>{s.nav.toFixed(2)}</td>
                                <td style={{ padding: '1rem', textAlign: 'right', color: (s.weeklyReturn || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                    {s.weeklyReturn ? `${(s.weeklyReturn * 100).toFixed(2)}%` : '-'}
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right', color: 'var(--success)' }}>
                                    {s.winPercent?.toFixed(1)}%
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right', color: 'var(--danger)' }}>
                                    {s.lossPercent?.toFixed(1)}%
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>
                                    {s.avgHoldingPeriod?.toFixed(0)}
                                </td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>{s.largeCapPercent?.toFixed(1)}%</td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>{s.midCapPercent?.toFixed(1)}%</td>
                                <td style={{ padding: '1rem', textAlign: 'right' }}>{s.smallCapPercent?.toFixed(1)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
