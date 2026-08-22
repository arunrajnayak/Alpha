'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listNewsSources,
  addNewsSource,
  removeNewsSource,
  type NewsSourceInfo,
  type NewsSourceAuthInput,
} from '@/app/actions/news';

/**
 * DB-backed list of news source domains for the Radar news panel.
 * Seeded server-side with sensible defaults on first use. Supports optional
 * private sources with credentials (credentials never round-trip to the client).
 */
export function useNewsSources() {
  const [sources, setSources] = useState<NewsSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listNewsSources()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        /* keep whatever we have */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback(
    async (input: string, auth?: NewsSourceAuthInput): Promise<{ ok: boolean; error?: string }> => {
      const res = await addNewsSource(input, auth).catch(() => null);
      if (!res) return { ok: false, error: 'Could not save source.' };
      setSources(res.sources);
      if (res.error) return { ok: false, error: res.error };
      return { ok: true };
    },
    [],
  );

  const remove = useCallback(async (domain: string) => {
    setSources((prev) => prev.filter((s) => s.domain !== domain)); // optimistic
    const list = await removeNewsSource(domain).catch(() => null);
    if (list) setSources(list);
  }, []);

  return { sources, loading, add, remove };
}
