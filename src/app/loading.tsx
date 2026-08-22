import ShimmerText from '@/components/ui/ShimmerText';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 md:gap-8 pb-8 md:pb-0 min-h-screen pt-4">
      {/* Processing indicator */}
      <div className="flex items-center justify-center">
        <ShimmerText withDot className="text-sm">Loading your portfolio…</ShimmerText>
      </div>

      <div className="flex flex-col gap-4 md:gap-8 animate-pulse">
      {/* LiveHeader skeleton */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="h-10 w-48 bg-slate-800/50 rounded-xl"></div>
          <div className="flex items-center gap-2 bg-slate-800/40 border border-white/5 rounded-2xl p-1.5 min-w-[120px]">
            <div className="h-8 w-24 bg-slate-800/50 rounded-lg hidden md:block mr-1"></div>
            <div className="flex gap-1.5">
              <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
              <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
              <div className="h-8 w-8 bg-slate-800/50 rounded-lg"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards - 4 cols */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-[160px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
        ))}
      </div>

      {/* Intraday PnL Chart */}
      <div className="h-[400px] bg-slate-800/50 rounded-2xl border border-white/5"></div>

      {/* Portfolio Heatmap */}
      <div className="h-[400px] bg-slate-800/50 rounded-2xl border border-white/5"></div>

      {/* Bottom: Movers + Performance Rank */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-[300px] bg-slate-800/50 rounded-2xl border border-white/5"></div>
        ))}
      </div>
      </div>
    </div>
  );
}
