'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWatchlist, addWatchlistSymbol, removeWatchlistSymbol } from '@/app/actions/charts';

/**
 * DB-backed personal watchlist for the Radar page (cross-device persistence).
 *
 * localStorage is used only as an instant-paint cache + offline fallback; the
 * database (RadarWatchlist) is the source of truth. Holdings are merged in by
 * the caller — this hook stores only the user's *custom* symbols.
 */

const STORAGE_KEY = 'radar.watchlist';

function readCache(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

function writeCache(next: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Paint instantly from cache, then reconcile with the DB (source of truth).
  useEffect(() => {
    const cached = readCache();
    if (cached.length) setSymbols(cached);
    setHydrated(true);

    let cancelled = false;
    getWatchlist()
      .then(async (db) => {
        if (cancelled) return;
        // One-time migration: push any local-only symbols into the DB so the
        // pre-existing localStorage watchlist isn't lost on the switch to DB.
        const localOnly = cached.filter((s) => !db.includes(s));
        let latest = db;
        for (const s of localOnly) {
          latest = await addWatchlistSymbol(s);
          if (cancelled) return;
        }
        setSymbols(latest);
        writeCache(latest);
      })
      .catch(() => {
        /* keep the cached list on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback((symbol: string): boolean => {
    const clean = normalize(symbol);
    if (!clean) return false;
    let added = false;
    setSymbols((prev) => {
      if (prev.includes(clean)) return prev;
      added = true;
      const next = [...prev, clean];
      writeCache(next);
      return next;
    });
    // Persist to the DB and reconcile with the authoritative ordering.
    addWatchlistSymbol(clean)
      .then((list) => {
        setSymbols(list);
        writeCache(list);
      })
      .catch(() => {
        /* DB unavailable — keep the optimistic state, don't wipe */
      });
    return added;
  }, []);

  const remove = useCallback((symbol: string) => {
    const clean = normalize(symbol);
    setSymbols((prev) => {
      const next = prev.filter((s) => s !== clean);
      writeCache(next);
      return next;
    });
    removeWatchlistSymbol(clean)
      .then((list) => {
        setSymbols(list);
        writeCache(list);
      })
      .catch(() => {
        /* DB unavailable — keep the optimistic state, don't wipe */
      });
  }, []);

  const has = useCallback((symbol: string) => symbols.includes(normalize(symbol)), [symbols]);

  return { symbols, add, remove, has, hydrated };
}
