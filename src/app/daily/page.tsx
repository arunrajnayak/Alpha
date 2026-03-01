'use client';

import { useDailySnapshots } from "@/hooks/useQueries";
import { useHasMounted } from '@/hooks/useHasMounted';
import { format } from "date-fns";
import { formatCurrency } from '@/lib/format';

// Loading skeleton
function DailySkeleton() {
  return (
    <div style={{ padding: '2rem' }} className="animate-pulse">
      <div className="h-8 w-48 bg-slate-800/50 rounded-xl mb-6"></div>
      <div className="h-[600px] bg-slate-800/50 rounded-xl border border-white/5"></div>
    </div>
  );
}

export default function DailySnapshotPage() {
  const { data: snapshots, isLoading, isFetching } = useDailySnapshots();
  const hasMounted = useHasMounted();

  // Show skeleton on server render AND initial client load
  if (!hasMounted || (isLoading && !snapshots)) {
    return <DailySkeleton />;
  }

  if (!snapshots) {
    return <div className="text-center py-8 text-gray-400">Failed to load snapshots</div>;
  }

  return (
    <div style={{ padding: '2rem' }}>
      {/* Background refresh indicator */}
      {isFetching && !isLoading && (
        <div className="fixed top-4 right-4 z-50 bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          Refreshing...
        </div>
      )}
      <h1 style={{ marginBottom: '1.5rem' }}>Daily Snapshots</h1>
      <div className="scroll-smooth" style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', background: 'var(--surface-hover)' }}>
              <th style={{ padding: '1rem' }}>Date</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Total Equity</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>NAV</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Invested</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Cashflow</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Drawdown</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Daily PnL</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>% Return</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '1rem' }}>{format(s.date, 'dd/MM/yyyy')}</td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>{formatCurrency(s.totalEquity)}</td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>{s.portfolioNAV.toFixed(2)}</td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>{formatCurrency(s.investedCapital)}</td>
                <td style={{ padding: '1rem', textAlign: 'right', color: (s.cashflow || 0) > 0 ? 'var(--success)' : '' }}>
                  {s.cashflow ? formatCurrency(s.cashflow) : '-'}
                </td>
                <td style={{ padding: '1rem', textAlign: 'right', color: 'var(--danger)' }}>
                  {s.drawdown ? `${(s.drawdown * 100).toFixed(2)}%` : '0%'}
                </td>
                <td style={{ padding: '1rem', textAlign: 'right', color: (s.dailyPnL || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {s.dailyPnL ? formatCurrency(s.dailyPnL) : '-'}
                </td>
                <td style={{ padding: '1rem', textAlign: 'right', color: (s.dailyReturn || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {s.dailyReturn ? `${(s.dailyReturn * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
