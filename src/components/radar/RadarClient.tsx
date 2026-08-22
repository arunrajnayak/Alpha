'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFire,
  faPlus,
  faArrowsRotate,
  faArrowTrendUp,
  faArrowTrendDown,
  faSpinner,
  faCircleCheck,
  faCircleExclamation,
  faTrashCan,
  faArrowDownAZ,
} from '@fortawesome/free-solid-svg-icons';

import { usePortfolioHoldings } from '@/hooks/useQueries';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useLiveData } from '@/context/LiveDataContext';
import { getCandles, scanBreakouts, validateSymbol, type CandlesResult, type ScanRow } from '@/app/actions/charts';
import { TIMEFRAMES, TIMEFRAME_CONFIG, type Timeframe, type Candle } from '@/lib/charts/candles';
import BreakoutList from './BreakoutList';
import NewsPanel from './NewsPanel';

const CandlestickChart = dynamic(() => import('./CandlestickChart'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading chart…</div>
  ),
});

const SCAN_INTERVAL_MS = 45_000;
const CANDLE_INTERVAL_MS = 30_000;
const LIVE_FLUSH_MS = 600;

export default function RadarClient() {
  const { data: holdingsData } = usePortfolioHoldings();
  const { symbols: customSymbols, add, remove, hydrated } = useWatchlist();
  const {
    subscribeToPrices,
    subscribeToInstruments,
    initialize,
    data: liveContextData,
    privacyMode,
  } = useLiveData();

  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [scanRows, setScanRows] = useState<ScanRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [candlesData, setCandlesData] = useState<CandlesResult | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<{ type: 'error' | 'exists' | 'added' | 'adding'; msg: string } | null>(null);
  const [sortMode, setSortMode] = useState<'score' | 'breakout' | 'breakdown' | 'az'>('score');
  const [flash, setFlash] = useState<{ symbol: string; nonce: number } | null>(null);
  const pendingHighlightRef = useRef<{ sym: string; isNew: boolean } | null>(null);

  // Live price buffers (flushed to state on an interval to avoid render storms).
  const priceBufRef = useRef<Map<string, { ltp: number; changePct: number }>>(new Map());
  const [livePrice, setLivePrice] = useState<Map<string, number>>(new Map());
  const [liveChange, setLiveChange] = useState<Map<string, number>>(new Map());

  // Kick off the shared live-data context (idempotent).
  useEffect(() => {
    initialize();
  }, [initialize]);

  const holdingSymbols = useMemo(
    () => (holdingsData ?? []).map((h) => h.symbol.toUpperCase()).filter(Boolean),
    [holdingsData],
  );
  const holdingsSet = useMemo(() => new Set(holdingSymbols), [holdingSymbols]);
  const customSet = useMemo(() => new Set(customSymbols), [customSymbols]);

  const universe = useMemo(() => {
    return Array.from(new Set([...holdingSymbols, ...customSymbols]));
  }, [holdingSymbols, customSymbols]);
  const universeKey = universe.join(',');

  const marketOpen = liveContextData?.marketStatus === 'OPEN';
  const hasToken = !!liveContextData?.tokenStatus?.hasToken;

  // -------------------------------------------------------------------------
  // Scan the universe for breakouts.
  // -------------------------------------------------------------------------
  const runScan = useCallback(async () => {
    if (universe.length === 0) {
      setScanRows([]);
      return;
    }
    setScanning(true);
    try {
      const res = await scanBreakouts(universe, timeframe);
      setScanRows(res.rows);
      setScannedAt(res.scannedAt);
      // Subscribe the whole universe to the shared live stream for LTP updates.
      const instruments = res.rows
        .filter((r) => r.instrumentKey)
        .map((r) => ({ instrumentKey: r.instrumentKey as string, symbol: r.symbol }));
      if (instruments.length > 0) subscribeToInstruments(instruments);
      // Auto-select the top mover if nothing is selected yet.
      setSelected((prev) => prev ?? res.rows[0]?.symbol ?? null);
    } catch {
      /* keep previous rows on failure */
    } finally {
      setScanning(false);
    }
  }, [universe, universeKey, timeframe, subscribeToInstruments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial + dependency-driven scan.
  useEffect(() => {
    runScan();
  }, [universeKey, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic re-scan while the market is open and Live is enabled.
  useEffect(() => {
    if (!marketOpen || !liveEnabled) return;
    const id = setInterval(runScan, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [marketOpen, liveEnabled, runScan]);

  // -------------------------------------------------------------------------
  // Load candles for the selected symbol.
  // -------------------------------------------------------------------------
  const loadCandles = useCallback(async () => {
    if (!selected) {
      setCandlesData(null);
      return;
    }
    setCandlesLoading(true);
    try {
      const res = await getCandles(selected, timeframe);
      setCandlesData(res);
    } catch {
      /* ignore */
    } finally {
      setCandlesLoading(false);
    }
  }, [selected, timeframe]);

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  useEffect(() => {
    if (!marketOpen || !selected || !liveEnabled) return;
    const id = setInterval(loadCandles, CANDLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [marketOpen, selected, liveEnabled, loadCandles]);

  // -------------------------------------------------------------------------
  // Live price stream → buffer → flush to state.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!marketOpen || !hasToken || !liveEnabled) return;
    const unsub = subscribeToPrices((updates) => {
      for (const u of updates) {
        const sym = u.symbol?.toUpperCase();
        if (!sym) continue;
        priceBufRef.current.set(sym, { ltp: u.ltp, changePct: u.changePercent });
      }
    });
    return unsub;
  }, [marketOpen, hasToken, subscribeToPrices]);

  useEffect(() => {
    const id = setInterval(() => {
      if (priceBufRef.current.size === 0) return;
      setLivePrice((prev) => {
        const next = new Map(prev);
        priceBufRef.current.forEach((v, k) => next.set(k, v.ltp));
        return next;
      });
      setLiveChange((prev) => {
        const next = new Map(prev);
        priceBufRef.current.forEach((v, k) => next.set(k, v.changePct));
        return next;
      });
      priceBufRef.current.clear();
    }, LIVE_FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // When Live is paused, stop folding any buffered ticks into the view.
  useEffect(() => {
    if (!liveEnabled) priceBufRef.current.clear();
  }, [liveEnabled]);

  // Candles with the live LTP folded into the forming (last) candle.
  const displayCandles: Candle[] = useMemo(() => {
    if (!candlesData || candlesData.candles.length === 0) return candlesData?.candles ?? [];
    if (!liveEnabled) return candlesData.candles;
    const ltp = livePrice.get(candlesData.symbol);
    if (!ltp) return candlesData.candles;
    const cs = candlesData.candles;
    const last = { ...cs[cs.length - 1] };
    last.close = ltp;
    last.high = Math.max(last.high, ltp);
    last.low = Math.min(last.low, ltp);
    return [...cs.slice(0, -1), last];
  }, [candlesData, livePrice, liveEnabled]);

  const triggerFlash = useCallback((symbol: string) => {
    setFlash({ symbol, nonce: Date.now() });
  }, []);

  // Reveal a symbol: select it, then scroll+glow its row if it's already in the
  // scan list — otherwise remember it and reveal the moment the scan surfaces it.
  const revealSymbol = useCallback(
    (sym: string, isNew: boolean) => {
      setSelected(sym);
      if (scanRows.some((r) => r.symbol === sym)) {
        triggerFlash(sym);
        pendingHighlightRef.current = null;
      } else {
        pendingHighlightRef.current = { sym, isNew };
      }
    },
    [scanRows, triggerFlash],
  );

  const handleAdd = useCallback(async () => {
    const clean = addInput.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!clean) return;

    // Already on the Radar (a holding or a previously-added symbol) → reveal it.
    if (holdingsSet.has(clean) || customSet.has(clean)) {
      setAddInput('');
      setAddStatus({ type: 'exists', msg: `${clean} is already on your Radar` });
      revealSymbol(clean, false);
      return;
    }

    // Validate against the real instrument master before adding.
    setAdding(true);
    setAddStatus(null);
    try {
      const res = await validateSymbol(clean);
      if (!res.valid) {
        setAddStatus({ type: 'error', msg: `"${clean}" doesn't exist as a symbol` });
        return;
      }
      add(clean);
      setAddInput('');
      // Keep an "Adding…" message up until the next scan surfaces the row.
      setAddStatus({ type: 'adding', msg: `Adding ${clean}…` });
      // Row appears after the scan re-runs with the new symbol — reveal it then.
      pendingHighlightRef.current = { sym: clean, isNew: true };
    } catch {
      setAddStatus({ type: 'error', msg: 'Could not verify symbol — try again' });
    } finally {
      setAdding(false);
    }
  }, [add, addInput, holdingsSet, customSet, revealSymbol]);

  // Once a pending symbol shows up in the scan results, select + glow it.
  useEffect(() => {
    const pending = pendingHighlightRef.current;
    if (!pending) return;
    if (scanRows.some((r) => r.symbol === pending.sym)) {
      setSelected(pending.sym);
      triggerFlash(pending.sym);
      if (pending.isNew) {
        setAddStatus({ type: 'added', msg: `${pending.sym} added to Radar` });
      }
      pendingHighlightRef.current = null;
    }
  }, [scanRows, triggerFlash]);

  // Auto-dismiss the add-status message (but keep the "Adding…" spinner up
  // until the row actually surfaces in the scan).
  useEffect(() => {
    if (!addStatus || addStatus.type === 'adding') return;
    const t = setTimeout(() => setAddStatus(null), 3500);
    return () => clearTimeout(t);
  }, [addStatus]);

  const breakoutCount = scanRows.filter((r) => r.direction === 'breakout').length;
  const breakdownCount = scanRows.filter((r) => r.direction === 'breakdown').length;

  // Client-side ordering of the scan results (instant, no re-scan).
  const displayRows = useMemo(() => {
    const rows = [...scanRows];
    switch (sortMode) {
      case 'az':
        rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
      case 'breakout': {
        // Breakouts first (strongest first), then neutral, then breakdowns.
        const rank = (r: ScanRow) => (r.direction === 'breakout' ? 0 : r.direction === 'none' ? 1 : 2);
        rows.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
        break;
      }
      case 'breakdown': {
        // Breakdowns first (most negative first), then neutral, then breakouts.
        const rank = (r: ScanRow) => (r.direction === 'breakdown' ? 0 : r.direction === 'none' ? 1 : 2);
        rows.sort((a, b) => rank(a) - rank(b) || a.score - b.score);
        break;
      }
      case 'score':
      default:
        // Pure magnitude — strongest move in either direction on top.
        rows.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        break;
    }
    return rows;
  }, [scanRows, sortMode]);

  const selectedRow = scanRows.find((r) => r.symbol === selected);
  const liveSelChange = selected ? liveChange.get(selected) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/20">
            <FontAwesomeIcon icon={faFire} className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100 leading-tight">Radar</h1>
            <p className="text-[11px] text-gray-500">Live candlesticks + volume-breakout scanner</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live toggle — pause auto-refresh & live ticks to study a frozen last-session chart */}
          <button
            onClick={() => setLiveEnabled((v) => !v)}
            title={liveEnabled ? 'Live updates on — click to pause' : 'Paused — click to go live'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[12px] font-semibold transition-colors ${
              liveEnabled
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-zinc-800/40 border-white/10 text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {liveEnabled && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  liveEnabled ? 'bg-emerald-400' : 'bg-gray-500'
                }`}
              />
            </span>
            {liveEnabled ? 'Live' : 'Paused'}
          </button>

          {/* Timeframe selector */}
          <div className="flex items-center gap-1 bg-zinc-800/40 border border-white/5 rounded-xl p-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  timeframe === tf ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {TIMEFRAME_CONFIG[tf].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart pane */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 flex flex-col rounded-2xl border border-white/5 bg-gradient-to-br from-slate-900 via-slate-900/60 to-slate-900 shadow-xl overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}
        >
          {/* Chart header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-base font-bold text-gray-100 truncate">
                {selected ?? '—'}
              </span>
              {selectedRow && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                    selectedRow.direction === 'breakout'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : selectedRow.direction === 'breakdown'
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-slate-600/20 text-slate-400'
                  }`}
                >
                  {selectedRow.direction === 'breakdown' ? (
                    <FontAwesomeIcon icon={faArrowTrendDown} className="w-2.5 h-2.5" />
                  ) : (
                    <FontAwesomeIcon icon={faArrowTrendUp} className="w-2.5 h-2.5" />
                  )}
                  {selectedRow.direction}
                </span>
              )}
              {selectedRow && (
                <span className="text-[11px] text-gray-500 tabular-nums hidden sm:inline">
                  {selectedRow.volRatio.toFixed(1)}× vol · trend {selectedRow.trend}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {typeof liveSelChange === 'number' && (
                <span
                  className={`text-[13px] font-bold tabular-nums ${
                    liveSelChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {liveSelChange >= 0 ? '+' : ''}
                  {liveSelChange.toFixed(2)}%
                </span>
              )}
              {candlesLoading && (
                <FontAwesomeIcon icon={faSpinner} className="w-3.5 h-3.5 text-gray-500 animate-spin" />
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-2 sm:p-3">
            {candlesData?.error ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                {candlesData.error}
              </div>
            ) : (
              <CandlestickChart
                candles={displayCandles}
                pivots={candlesData?.pivots ?? []}
                donchianHigh={candlesData?.donchianHigh ?? null}
                donchianLow={candlesData?.donchianLow ?? null}
                timeframe={timeframe}
                height={460}
                breakoutStartIndex={candlesData?.breakout.startIndex}
                breakoutDirection={candlesData?.breakout.direction}
                resetKey={`${selected ?? ''}-${timeframe}`}
              />
            )}
          </div>
        </motion.div>

        {/* Scanner pane */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl border border-white/5 bg-slate-900/60 shadow-xl flex flex-col overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}
        >
          {/* Scanner header */}
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-sm font-semibold text-gray-200">Breakout Scanner</h2>
              <button
                onClick={runScan}
                disabled={scanning}
                className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                title="Re-scan now"
              >
                <FontAwesomeIcon icon={faArrowsRotate} className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning…' : 'Refresh'}
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11px] mb-2.5">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {breakoutCount} breakout
              </span>
              <span className="flex items-center gap-1 text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> {breakdownCount} breakdown
              </span>
              <span className="text-gray-600 ml-auto">{universe.length} symbols</span>
            </div>

            {/* Sort control */}
            <div className="flex items-center gap-1.5 mb-2.5">
              <FontAwesomeIcon icon={faArrowDownAZ} className="w-3 h-3 text-gray-600 shrink-0" />
              <span className="text-[9px] uppercase tracking-wider text-gray-600 shrink-0">Sort</span>
              <div className="flex items-center gap-0.5 bg-zinc-800/40 border border-white/5 rounded-lg p-0.5 ml-auto">
                {([
                  ['score', 'Strength'],
                  ['breakout', 'BO'],
                  ['breakdown', 'BD'],
                  ['az', 'A–Z'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortMode(key)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors ${
                      sortMode === key
                        ? key === 'breakout'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : key === 'breakdown'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-indigo-500/20 text-indigo-300'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                    title={
                      key === 'score'
                        ? 'Strongest move (volume × distance), either direction'
                        : key === 'breakout'
                        ? 'Breakouts first'
                        : key === 'breakdown'
                        ? 'Breakdowns first'
                        : 'Alphabetical'
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Add-to-watchlist input */}
            <div className="flex items-center gap-1.5">
              <input
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value);
                  if (addStatus) setAddStatus(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !adding) handleAdd();
                }}
                placeholder="Add symbol (e.g. RELIANCE)"
                className={`flex-1 min-w-0 bg-zinc-800/50 border rounded-lg px-2.5 py-1.5 text-[12px] text-gray-200 placeholder:text-gray-600 focus:outline-none transition-colors ${
                  addStatus?.type === 'error'
                    ? 'border-red-500/50 focus:border-red-500/60'
                    : 'border-white/5 focus:border-indigo-500/40'
                }`}
              />
              <button
                onClick={handleAdd}
                disabled={adding}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 transition-colors shrink-0 disabled:opacity-50"
                title="Add to watchlist"
              >
                <FontAwesomeIcon icon={adding ? faSpinner : faPlus} className={`w-3.5 h-3.5 ${adding ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Add feedback */}
            {addStatus && (
              <div
                className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                  addStatus.type === 'error'
                    ? 'text-red-400'
                    : addStatus.type === 'adding'
                    ? 'text-indigo-300'
                    : 'text-emerald-400'
                }`}
              >
                <FontAwesomeIcon
                  icon={
                    addStatus.type === 'error'
                      ? faCircleExclamation
                      : addStatus.type === 'adding'
                      ? faSpinner
                      : faCircleCheck
                  }
                  className={`w-3 h-3 shrink-0 ${addStatus.type === 'adding' ? 'animate-spin' : ''}`}
                />
                <span>{addStatus.msg}</span>
              </div>
            )}

            {/* Your added symbols — removable chips (holdings are not shown here) */}
            {customSymbols.length > 0 && (
              <div className="mt-2.5">
                <p className="text-[9px] uppercase tracking-wider text-gray-600 mb-1.5">Your symbols</p>
                <div className="flex flex-wrap gap-1.5">
                  {customSymbols.map((sym) => {
                    const inScan = scanRows.some((r) => r.symbol === sym);
                    return (
                      <span
                        key={sym}
                        className="group/chip inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-zinc-800/60 border border-white/5 text-[11px]"
                      >
                        <button
                          onClick={() => {
                            if (inScan) revealSymbol(sym, false);
                          }}
                          className={`font-medium ${inScan ? 'text-gray-200 hover:text-white' : 'text-gray-500'}`}
                          title={inScan ? 'Show in list' : 'Not a tradable symbol — remove it'}
                        >
                          {sym}
                          {!inScan && <span className="ml-1 text-red-400/70">·?</span>}
                        </button>
                        <button
                          onClick={() => {
                            remove(sym);
                            setAddStatus({ type: 'added', msg: `${sym} removed` });
                          }}
                          className="flex items-center justify-center w-5 h-5 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Remove from your list"
                        >
                          <FontAwesomeIcon icon={faTrashCan} className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* List */}
          <div className="flex-1 min-h-0">
            {!hydrated ? null : (
              <BreakoutList
                rows={displayRows}
                selectedSymbol={selected}
                onSelect={setSelected}
                holdings={holdingsSet}
                custom={customSet}
                onRemove={remove}
                liveChange={liveChange}
                livePrice={livePrice}
                privacyMode={privacyMode}
                loading={scanning}
                flashSymbol={flash?.symbol}
                flashNonce={flash?.nonce}
              />
            )}
          </div>

          {scannedAt && (
            <div className="px-4 py-2 border-t border-white/5 text-[10px] text-gray-600">
              {!liveEnabled
                ? 'Paused · frozen last snapshot'
                : marketOpen
                ? 'Live · auto-refresh 45s'
                : 'Market closed · last session'}{' '}
              · scanned{' '}
              {new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </motion.div>
      </div>

      {/* News + market-mood for the selected stock (full-width, below both panes) */}
      <NewsPanel symbol={selected} />
    </div>
  );
}
