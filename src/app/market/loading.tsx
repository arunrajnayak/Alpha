export default function MarketLoading() {
  return (
    <div className="flex flex-col gap-3 sm:gap-4 md:gap-6 pb-24 md:pb-8 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-7 md:h-9 w-44 bg-slate-800/60 rounded-lg" />
            <div className="h-5 w-12 bg-slate-800/40 rounded-full" />
          </div>
          <div className="h-3 w-36 bg-slate-800/40 rounded mt-1.5" />
        </div>
        <div className="h-8 w-20 bg-slate-800/50 rounded-lg" />
      </div>

      {/* Section 1: Market Breadth + Top Movers + Stock Moves */}
      <div className="flex flex-col gap-3 sm:gap-4 md:gap-5">
        {/* Breadth chart card */}
        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3 sm:p-5 md:p-6">
          <div className="flex items-center justify-between pb-2.5 sm:pb-3 border-b border-white/5 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-slate-800/60 rounded-lg" />
              <div className="h-5 w-32 bg-slate-800/60 rounded" />
            </div>
            <div className="h-6 w-24 bg-slate-800/50 rounded-lg" />
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3.5 mb-3">
            <div className="h-12 sm:h-14 bg-emerald-500/[0.05] border border-emerald-500/10 rounded-xl" />
            <div className="h-12 sm:h-14 bg-slate-800/40 border border-white/5 rounded-xl" />
            <div className="h-12 sm:h-14 bg-rose-500/[0.05] border border-rose-500/10 rounded-xl" />
          </div>
          <div className="h-[260px] sm:h-[340px] md:h-[460px] w-full bg-slate-800/20 rounded-xl" />
        </div>

        {/* Top Movers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
          {[{ color: 'emerald', w: 28 }, { color: 'rose', w: 24 }].map(({ color, w }, ci) => (
            <div key={ci} className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6">
              <div className="flex items-center gap-2 pb-2.5 border-b border-white/5 mb-2.5">
                <div className={`w-2.5 h-2.5 rounded-full bg-${color}-500/40`} />
                <div className={`h-4 w-${w} bg-slate-800/60 rounded`} />
              </div>
              <div className="space-y-1 mt-2">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 bg-slate-800/50 rounded" />
                      <div className="w-20 h-4 bg-slate-800/60 rounded" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-3 bg-slate-800/40 rounded" />
                      <div className="w-16 h-6 bg-slate-800/60 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Stock Moves Distribution */}
        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3 sm:p-5 md:p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-slate-800/60 rounded-lg" />
              <div className="h-5 w-44 bg-slate-800/60 rounded" />
            </div>
            <div className="h-9 w-20 bg-slate-800/40 rounded-lg" />
          </div>
          <div className="h-[270px] sm:h-[320px] md:h-[400px] w-full mt-3 bg-slate-800/20 rounded-xl" />
        </div>
      </div>

      {/* Section 2: Index Constituents & Heatmap Divider */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-white/5" />
        <div className="h-4 w-48 bg-slate-800/40 rounded" />
        <div className="h-px flex-1 bg-white/5" />
      </div>

      {/* Index Sidebar + Heatmap */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-5">
        <div className="hidden md:flex flex-col gap-2 w-[220px] shrink-0">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-[76px] bg-slate-800/50 rounded-xl border border-white/5" />
          ))}
        </div>
        <div className="flex md:hidden gap-2 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[52px] w-[110px] bg-slate-800/50 rounded-xl border border-white/5 shrink-0" />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="h-3 w-28 bg-slate-800/50 rounded" />
                <div className="flex items-baseline gap-2">
                  <div className="h-6 w-20 bg-slate-800/60 rounded" />
                  <div className="h-4 w-14 bg-slate-800/40 rounded" />
                </div>
              </div>
              <div className="flex-1 max-w-[340px] flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <div className="h-4 w-8 bg-slate-800/50 rounded" />
                  <div className="h-4 w-8 bg-slate-800/40 rounded" />
                </div>
                <div className="h-2.5 w-full bg-slate-800/50 rounded-full" />
              </div>
            </div>
            <div className="h-[280px] sm:h-[380px] md:h-[500px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
          </div>
        </div>
      </div>

      {/* Sectoral Heatmap */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-1">
        <div className="px-5 pt-5 pb-2">
          <div className="h-3 w-36 bg-slate-800/50 rounded" />
        </div>
        <div className="h-[240px] sm:h-[310px] md:h-[400px] mx-4 mb-4 bg-slate-800/30 rounded-xl" />
      </div>

      {/* Section 3: ATH Distribution */}
      <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3 sm:p-5 md:p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 bg-slate-800/60 rounded-lg" />
          <div className="h-5 w-48 bg-slate-800/60 rounded" />
        </div>
        <div className="h-[240px] sm:h-[320px] md:h-[400px] w-full mt-3 bg-slate-800/20 rounded-xl" />
      </div>

      {/* Section 4: Market Health */}
      <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-3 sm:p-5 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-slate-800/60 rounded-lg" />
            <div className="h-5 w-40 bg-slate-800/60 rounded" />
          </div>
          <div className="flex gap-1.5">
            {['6M', '1Y', 'ALL'].map((t) => (
              <div key={t} className="h-7 w-10 bg-slate-800/50 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-slate-800/30 rounded-xl p-3">
              <div className="h-3 w-20 bg-slate-800/60 rounded mb-2" />
              <div className="h-6 w-12 bg-slate-800/80 rounded" />
            </div>
          ))}
        </div>
        <div className="h-[240px] sm:h-[300px] w-full bg-slate-800/20 rounded-xl" />
      </div>
    </div>
  );
}
