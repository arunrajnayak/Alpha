'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface RulesInfoModalProps {
  open: boolean;
  onClose: () => void;
}

export default function RulesInfoModal({ open, onClose }: RulesInfoModalProps) {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Strategy Rules</h2>
              <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Universe Filters */}
            <Section title="Pre-filtered Criteria" subtitle="All must pass for Pre-filtered tab (AND logic). All tab has no market cap or price/trend filters.">
              <RuleRow label="Exchange" value="NSE equity (EQ & BE series) + GOLDBEES, SILVERBEES" />
              <RuleRow label="Market Cap" value=">= 1,000 Crores (NSE bhavcopy) — Pre-filtered tab only" />
              <RuleRow label="Min Price" value=">= ₹50 (ETFs exempt)" />
              <RuleRow label="Volume" value="Median daily turnover >= ₹1 Cr (126 trading days)" />
              <RuleRow label="Circuit Limit" value="Band width >= 9% (5% circuit stocks tagged with Warning; 2% circuit excluded)" />
              <RuleRow label="BE Category" value="Included with Warning/Caution tag (trade-to-trade stocks)" />
              <RuleRow label="200 DMA" value="Close >= 200-day simple moving average" />
              <RuleRow label="ATH Proximity" value="Close >= 70% of all-time high" />
            </Section>

            {/* Scoring */}
            <Section title="Scoring Formula">
              <div className="space-y-2 text-sm text-gray-300">
                <p className="font-mono text-xs text-gray-400 bg-slate-800/50 rounded-lg p-3">
                  Composite Score = avgSharpe = mean(Sharpe_12m, Sharpe_6m, Sharpe_3m)
                </p>
                <div className="space-y-1.5">
                  <p><span className="text-gray-500">Sharpe</span> = (mean × 252) / (std × √252) — annualized, sample std, rf = 0</p>
                  <p><span className="text-gray-500">3m window</span> = 62 days ending 21 days ago (4m→1m, skips recent month)</p>
                  <p><span className="text-gray-500">ATH proximity</span> = entry filter only (≥70% of ATH), not part of score</p>
                </div>
              </div>
            </Section>

            {/* Lookback Windows */}
            <Section title="Sharpe Lookback Windows">
              <RuleRow label="12-month" value="252 trading days ending today" />
              <RuleRow label="6-month" value="126 trading days ending today" />
              <RuleRow label="3-month" value="62 trading days ending 21 days ago (skip recent month)" />
              <RuleRow label="Min data" value="273 trading days required (252 + 21 skip)" />
              <RuleRow label="Min returns" value="20 daily returns per window (else excluded)" />
            </Section>

            {/* ATH */}
            <Section title="All-Time High">
              <RuleRow label="Scope" value="True all-time high (from 2000, seeded from monthly candles)" />
              <RuleRow label="Update" value="Daily from latest candle highs" />
            </Section>

            {/* Ranking */}
            <Section title="Ranking">
              <RuleRow label="Method" value="Sort by composite score (descending)" />
              <RuleRow label="Universe" value="All qualifying stocks ranked (no cap)" />
              <RuleRow label="History" value="50 trading days retained" />
              <RuleRow label="Schedule" value="Daily after market close (4:30 PM IST)" />
            </Section>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="text-gray-500 font-medium min-w-[90px] shrink-0">{label}</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}
