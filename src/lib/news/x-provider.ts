/**
 * X (Twitter) API v2 recent-search adapter for the Radar news panel.
 *
 * Uses App-only Bearer Token auth to search recent tweets mentioning the
 * symbol (cashtag/hashtag) or company name, mapping them into news items.
 *
 * NOTE: the /2/tweets/search/recent endpoint requires an X API tier that
 * permits read/search (the free "read" tier is very limited). Any auth/tier
 * error is swallowed and yields no items — the rest of the news still loads.
 */

import type { RawNewsItem } from './rss';

export interface XCreds {
  bearerToken?: string;
  [key: string]: string | undefined;
}

/** Items plus an optional human-readable note (e.g. an API/billing error). */
export interface XFetchResult {
  items: RawNewsItem[];
  error?: string;
}

const X_SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';

interface XUser {
  id: string;
  username?: string;
  name?: string;
}

/** Map an X API error response to a short, user-friendly note. */
function describeXError(status: number, body: unknown): string {
  const detail =
    body && typeof body === 'object'
      ? ((body as { detail?: string; title?: string }).detail ?? (body as { title?: string }).title)
      : undefined;
  if (status === 402) return 'X API: credits depleted — add credits or upgrade your X API plan.';
  if (status === 401) return 'X API: unauthorized — check the Bearer Token.';
  if (status === 403) return 'X API: forbidden — your plan may not allow tweet search.';
  if (status === 429) return 'X API: rate limited — try again later.';
  return `X API error ${status}${detail ? `: ${detail}` : ''}`;
}

export async function fetchXNews(
  symbol: string,
  company: string,
  creds: XCreds,
  limit = 20,
): Promise<XFetchResult> {
  if (!creds.bearerToken) return { items: [] };

  const terms = [`$${symbol}`, `#${symbol}`];
  if (company && company.toUpperCase() !== symbol.toUpperCase()) terms.push(`"${company}"`);
  const query = `(${terms.join(' OR ')}) lang:en -is:retweet`;

  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(50, Math.max(10, limit))),
    'tweet.fields': 'created_at',
    expansions: 'author_id',
    'user.fields': 'username,name',
  });

  try {
    const res = await fetch(`${X_SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${creds.bearerToken}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        /* non-JSON error body */
      }
      return { items: [], error: describeXError(res.status, body) };
    }

    const json = (await res.json()) as {
      data?: Array<{ id: string; text: string; created_at?: string; author_id?: string }>;
      includes?: { users?: XUser[] };
    };

    const users = new Map<string, XUser>((json.includes?.users ?? []).map((u) => [u.id, u]));

    const items = (json.data ?? []).map((t) => {
      const u = t.author_id ? users.get(t.author_id) : undefined;
      const handle = u?.username ?? 'i';
      return {
        title: t.text.replace(/\s+/g, ' ').trim(),
        url: `https://x.com/${handle}/status/${t.id}`,
        source: u?.username ? `@${u.username}` : 'X',
        publishedAt: t.created_at && !Number.isNaN(Date.parse(t.created_at)) ? t.created_at : new Date().toISOString(),
      } as RawNewsItem;
    });
    return { items };
  } catch {
    return { items: [], error: 'X API: request failed (network/timeout).' };
  }
}
