export default function RadarLoading() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-zinc-800/60" />
          <div className="flex flex-col gap-1.5">
            <div className="h-5 w-24 bg-zinc-800/60 rounded" />
            <div className="h-3 w-52 bg-zinc-800/40 rounded" />
          </div>
        </div>
        <div className="h-9 w-72 bg-zinc-800/40 rounded-xl hidden sm:block" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart pane */}
        <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-zinc-900/40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="h-5 w-40 bg-zinc-800/50 rounded" />
            <div className="h-4 w-16 bg-zinc-800/40 rounded" />
          </div>
          <div className="p-3">
            <div className="h-[460px] bg-zinc-800/20 rounded-lg" />
          </div>
        </div>

        {/* Scanner pane */}
        <div className="rounded-2xl border border-white/5 bg-zinc-900/40 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}>
          <div className="px-4 py-3 border-b border-white/5 flex flex-col gap-2.5">
            <div className="h-4 w-36 bg-zinc-800/50 rounded" />
            <div className="h-3 w-48 bg-zinc-800/40 rounded" />
            <div className="h-8 w-full bg-zinc-800/40 rounded-lg" />
          </div>
          <div className="flex flex-col">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
                <div className="h-3 w-4 bg-zinc-800/40 rounded" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3.5 w-20 bg-zinc-800/50 rounded" />
                  <div className="h-2 w-24 bg-zinc-800/30 rounded" />
                </div>
                <div className="h-4 w-14 bg-zinc-800/40 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
