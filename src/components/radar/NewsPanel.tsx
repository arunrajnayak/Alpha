'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faNewspaper,
  faArrowTrendUp,
  faArrowTrendDown,
  faMinus,
  faGear,
  faRotate,
  faSpinner,
  faXmark,
  faPlus,
  faChevronLeft,
  faChevronRight,
  faArrowUpRightFromSquare,
  faLock,
  faMugHot,
  faCircleInfo,
  faGlobe,
  faPen,
} from '@fortawesome/free-solid-svg-icons';
import { getStockNews, type NewsResult, type NewsItem, type NewsMode } from '@/app/actions/news';
import { useNewsSources } from '@/hooks/useNewsSources';
import { PROVIDER_SPECS, providerById, providerForDomain, DEFAULT_PROVIDER } from '@/lib/news/providers';

const PAGE_SIZE = 5;
const MODE_KEY = 'radar-news-mode';

type Sentiment = NewsItem['sentiment'];

const MOOD_META: Record<Sentiment, { label: string; hint: string; color: string; bg: string; icon: typeof faMinus }> = {
  bullish: { label: 'Bullish', hint: 'leaning Buy', color: '#10b981', bg: 'bg-emerald-500/15 text-emerald-400', icon: faArrowTrendUp },
  bearish: { label: 'Bearish', hint: 'leaning Sell', color: '#ef4444', bg: 'bg-red-500/15 text-red-400', icon: faArrowTrendDown },
  neutral: { label: 'Neutral', hint: 'no clear bias', color: '#94a3b8', bg: 'bg-slate-500/15 text-slate-300', icon: faMinus },
};

// A few light-hearted lines for the "no news" state.
const EMPTY_QUIPS = [
  'All quiet on this counter — not a single headline stirring. Markets nap too. 😴',
  'Crickets. 🦗 No fresh news here — maybe grab a chai and check back later.',
  'Nothing to report. The news desk is on a tea break for this one. ☕',
  'Zero headlines. Sometimes no news really is good news. 🤷',
];

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function MoodGauge({ result }: { result: NewsResult }) {
  const meta = MOOD_META[result.mood];
  const pct = ((result.score + 100) / 200) * 100;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
      <div className="flex items-center gap-2.5 shrink-0">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${meta.bg}`}>
          <FontAwesomeIcon icon={meta.icon} className="w-3 h-3" />
          {meta.label}
        </span>
        <span className="text-[11px] text-gray-500">{meta.hint}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-red-500/70 via-slate-600/50 to-emerald-500/70">
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full ring-2 ring-slate-900 shadow"
            style={{ left: `${pct}%`, background: meta.color }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-gray-600 uppercase tracking-wide">
          <span>Bearish</span>
          <span>Neutral</span>
          <span>Bullish</span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
        <span className="text-emerald-400">▲ {result.bullishCount}</span>
        <span className="text-red-400">▼ {result.bearishCount}</span>
        <span className="text-gray-500">• {result.neutralCount}</span>
      </div>
    </div>
  );
}

/** Small logo for a source chip: X badge, site favicon, or a globe fallback. */
function SourceIcon({ domain, provider, isPrivate }: { domain: string; provider: string; isPrivate: boolean }) {
  const [err, setErr] = useState(false);

  if (provider === 'x') {
    return (
      <span
        className="grid place-items-center w-3.5 h-3.5 rounded bg-black text-white text-[8px] font-black shrink-0"
        title="X (Twitter) API"
      >
        X
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {!err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt=""
          width={14}
          height={14}
          className="w-3.5 h-3.5 rounded-sm"
          onError={() => setErr(true)}
        />
      ) : (
        <FontAwesomeIcon icon={faGlobe} className="w-3 h-3 text-gray-500" />
      )}
      {isPrivate && (
        <FontAwesomeIcon icon={faLock} className="w-2.5 h-2.5 text-amber-400/80" title="Private (authenticated) source" />
      )}
    </span>
  );
}

function SourceModal({ onClose }: { onClose: () => void }) {
  const { sources, loading, add, remove } = useNewsSources();
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<string>(DEFAULT_PROVIDER);
  const [showCreds, setShowCreds] = useState(false); // for rss private toggle
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spec = providerById(provider);
  const isX = provider === 'x';

  const bareDomain = (value: string) =>
    value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  // Any canonical domain that implies a non-default provider (e.g. x.com).
  const isProviderDomain = (value: string) =>
    PROVIDER_SPECS.some((p) => p.domains.includes(bareDomain(value)));

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reset = () => {
    setInput('');
    setConfig({});
    setShowCreds(false);
    setProvider(DEFAULT_PROVIDER);
  };

  // Typing a domain always re-detects the provider (x.com → X, else RSS).
  const onInput = (value: string) => {
    setInput(value);
    setError(null);
    setProvider(providerForDomain(bareDomain(value)));
  };

  // Load an existing source into the form for editing (domain + provider).
  // Secrets are never returned to the client, so credential inputs stay empty —
  // leaving them blank keeps the stored token.
  const editSource = (s: { domain: string; provider: string; isPrivate: boolean }) => {
    setInput(s.domain);
    setProvider(s.provider);
    setShowCreds(s.isPrivate);
    setConfig({});
    setError(null);
  };

  // Does the typed domain already exist? (drives Save vs Add + upsert behaviour)
  const existingMatch = sources.find((s) => bareDomain(s.domain) === bareDomain(input));
  const editingAuthSource = existingMatch?.hasAuth ? existingMatch : undefined;

  // Switching the Type dropdown fills/clears the domain to match.
  const onProviderChange = (p: string) => {
    setProvider(p);
    setConfig({});
    setError(null);
    const canonical = providerById(p).domains[0];
    if (canonical) {
      setInput(canonical); // e.g. X → x.com
    } else if (isProviderDomain(input)) {
      setInput(''); // clear an autofilled provider domain (x.com) when going back to RSS
    }
  };

  // Whether credential inputs should be visible for the current provider.
  const showFields = isX || (provider === 'rss' && showCreds);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim()) return;
      setBusy(true);
      setError(null);
      const sendConfig = showFields ? config : undefined;
      const isPrivate = isX || showCreds;
      const res = await add(input, { provider, isPrivate, config: sendConfig });
      setBusy(false);
      if (res.ok) reset();
      else setError(res.error ?? 'Could not add source.');
    },
    [add, input, provider, isX, showCreds, showFields, config],
  );

  const setField = (key: string, value: string) =>
    setConfig((c) => ({ ...c, [key]: value }));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-white/5 bg-slate-900">
          <span className="text-sm font-bold text-gray-100 flex items-center gap-2">
            <FontAwesomeIcon icon={faGear} className="w-3.5 h-3.5 text-indigo-400" /> News sources
          </span>
          <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5" title="Close">
            <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {/* Existing sources (newest first so a just-added one is visible) */}
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
            {loading && sources.length === 0 ? (
              <span className="text-[11px] text-gray-500">Loading…</span>
            ) : (
              [...sources].reverse().map((s) => (
                <span
                  key={s.domain}
                  className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md bg-slate-800/80 border border-white/5 text-[11px] text-gray-300"
                >
                  <SourceIcon domain={s.domain} provider={s.provider} isPrivate={s.isPrivate} />
                  {s.domain}
                  <button
                    onClick={() => editSource(s)}
                    className="w-4 h-4 grid place-items-center rounded text-gray-500 hover:text-indigo-300 hover:bg-indigo-500/10"
                    title={`Edit ${s.domain}`}
                  >
                    <FontAwesomeIcon icon={faPen} className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => remove(s.domain)}
                    className="w-4 h-4 grid place-items-center rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
                    title={`Remove ${s.domain}`}
                  >
                    <FontAwesomeIcon icon={faXmark} className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add form */}
          <form onSubmit={submit} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => onInput(e.target.value)}
                placeholder="Add a domain e.g. zeebiz.com"
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-slate-800/80 border border-white/10 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-indigo-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-[12px] font-semibold hover:bg-indigo-500/30 disabled:opacity-40 transition-colors shrink-0"
              >
                <FontAwesomeIcon
                  icon={busy ? faSpinner : existingMatch ? faPen : faPlus}
                  className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`}
                />
                {existingMatch ? 'Save' : 'Add'}
              </button>
            </div>

            {/* Provider type */}
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 shrink-0">Type</label>
              <select
                value={provider}
                onChange={(e) => onProviderChange(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-white/10 text-[12px] text-gray-200 focus:border-indigo-500/50 focus:outline-none"
              >
                {PROVIDER_SPECS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* RSS: optional private toggle */}
            {provider === 'rss' && (
              <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showCreds}
                  onChange={(e) => setShowCreds(e.target.checked)}
                  className="accent-indigo-500"
                />
                <FontAwesomeIcon icon={faLock} className="w-2.5 h-2.5 text-amber-400/80" />
                Private source (needs login / API key)
              </label>
            )}

            {/* Dynamic credential fields for the selected provider */}
            {showFields && (
              <div className="space-y-2 rounded-lg border border-white/10 bg-slate-800/40 p-2.5">
                {spec.fields.map((f) => (
                  <div key={f.key}>
                    <input
                      value={config[f.key] ?? ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      type={f.secret ? 'password' : 'text'}
                      autoComplete="off"
                      placeholder={`${f.label}${f.required ? ' (required)' : f.placeholder ? ` (${f.placeholder})` : ''}`}
                      className="w-full px-2.5 py-1.5 rounded-md bg-slate-800/80 border border-white/10 text-[12px] text-gray-200 placeholder:text-gray-600 focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
                ))}
                {editingAuthSource && (
                  <p className="text-[10px] text-amber-300/80">
                    Editing {editingAuthSource.domain} — leave fields blank to keep the current token.
                  </p>
                )}
                {spec.note && <p className="text-[10px] text-gray-600">{spec.note}</p>}
                <p className="text-[10px] text-gray-600">Stored only in your database, never shown again.</p>
              </div>
            )}

            {error && <p className="text-[11px] text-red-400">{error}</p>}
          </form>

          <p className="mt-3 text-[10px] text-gray-600">
            Public domains are used as filters on live news search. Private feeds &amp; X are best-effort.
          </p>
        </div>
      </div>
    </div>
  );
}

const DOT: Record<Sentiment, string> = {
  bullish: 'bg-emerald-400',
  bearish: 'bg-red-400',
  neutral: 'bg-slate-500',
};

export default function NewsPanel({ symbol }: { symbol: string | null }) {
  const [result, setResult] = useState<NewsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [showSources, setShowSources] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [mode, setMode] = useState<NewsMode>('casual');

  // Restore the saved search mode once mounted (client-only).
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(MODE_KEY) : null;
    if (saved === 'strict' || saved === 'casual') setMode(saved);
  }, []);

  const changeMode = useCallback((next: NewsMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!symbol) {
      setResult(null);
      return;
    }
    setLoading(true);
    try {
      const res = await getStockNews(symbol, mode);
      setResult(res);
      setPage(0);
    } finally {
      setLoading(false);
    }
  }, [symbol, mode]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  // A stable quip per symbol so it doesn't flicker on re-render.
  const quip = useMemo(() => {
    const seed = (symbol ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return EMPTY_QUIPS[seed % EMPTY_QUIPS.length];
  }, [symbol]);

  const items = result?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [items, page],
  );

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/60 shadow-xl overflow-hidden">
      {showSources && <SourceModal onClose={() => setShowSources(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <FontAwesomeIcon icon={faNewspaper} className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-bold text-gray-100">News &amp; Market Mood</span>
          {symbol && <span className="text-sm font-semibold text-gray-400 truncate">· {symbol}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Strict vs casual search toggle */}
          <div className="inline-flex items-center rounded-lg border border-white/10 bg-slate-800/60 p-0.5" role="group">
            <button
              onClick={() => changeMode('strict')}
              className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors ${
                mode === 'strict' ? 'bg-indigo-500/25 text-indigo-200' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Match the ticker symbol only (precise)"
            >
              Strict
            </button>
            <button
              onClick={() => changeMode('casual')}
              className={`px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors ${
                mode === 'casual' ? 'bg-indigo-500/25 text-indigo-200' : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Also search by company name when symbol news is thin"
            >
              Casual
            </button>
          </div>
          <button
            onClick={() => setShowSources(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
            title="Configure sources"
          >
            <FontAwesomeIcon icon={faGear} className="w-3 h-3" />
            Sources
          </button>
          <button
            onClick={() => setNonce((n) => n + 1)}
            disabled={loading || !symbol}
            className="w-8 h-8 grid place-items-center rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
            title="Refresh news"
          >
            <FontAwesomeIcon icon={loading ? faSpinner : faRotate} className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {result?.note && (
          <div className="flex items-start gap-2 mb-3 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90">
            <FontAwesomeIcon icon={faCircleInfo} className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{result.note}</span>
          </div>
        )}
        {!symbol ? (
          <p className="text-sm text-gray-500 py-6 text-center">Select a stock to see its latest news and mood.</p>
        ) : loading && !result ? (
          <div className="flex items-center justify-center py-8 text-gray-500 text-sm gap-2">
            <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin" /> Fetching latest news…
          </div>
        ) : result?.error ? (
          <p className="text-sm text-red-400/80 py-6 text-center">Couldn&apos;t load news: {result.error}</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div className="w-12 h-12 grid place-items-center rounded-full bg-slate-800/70 text-amber-300/80">
              <FontAwesomeIcon icon={faMugHot} className="w-5 h-5" />
            </div>
            <p className="text-sm text-gray-400 max-w-xs">{quip}</p>
            <button
              onClick={() => setShowSources(true)}
              className="text-[11px] font-semibold text-indigo-300 hover:text-indigo-200"
            >
              + Add more sources
            </button>
          </div>
        ) : (
          <>
            {result && (
              <div className="pb-3 mb-3 border-b border-white/5">
                <MoodGauge result={result} />
                <p className="mt-2 text-[10px] text-gray-600">
                  Mood is derived from recent headline sentiment (last few days, auto-widened when news is sparse) —
                  informational only, not investment advice.
                </p>
              </div>
            )}

            <ul className="space-y-1.5">
              {pageItems.map((it, idx) => (
                <li key={`${it.url}-${idx}`}>
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[it.sentiment]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-gray-200 group-hover:text-white leading-snug">
                        {it.title}
                      </span>
                      <span className="block mt-0.5 text-[10.5px] text-gray-500">
                        {it.source} · {relTime(it.publishedAt)}
                      </span>
                    </span>
                    <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="w-2.5 h-2.5 text-gray-600 group-hover:text-gray-400 mt-1 shrink-0"
                    />
                  </a>
                </li>
              ))}
            </ul>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-white/5">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  <FontAwesomeIcon icon={faChevronLeft} className="w-2.5 h-2.5" /> Prev
                </button>
                <span className="text-[11px] text-gray-500 tabular-nums">
                  {page + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  Next <FontAwesomeIcon icon={faChevronRight} className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
