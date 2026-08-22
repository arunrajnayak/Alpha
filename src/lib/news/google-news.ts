/**
 * Google News RSS fetcher for the Radar news panel.
 *
 * SECURITY: we only ever fetch a single fixed host (news.google.com). The
 * user-configured public "sources" are domain strings used solely as Google
 * `site:` query filters — they are never fetched directly, so there is no SSRF
 * surface here. (Private authenticated feeds are handled separately in
 * `private-feed.ts` with their own guards.)
 */

import { parseRssItems, NEWS_UA, type RawNewsItem } from './rss';

export type { RawNewsItem };

const GOOGLE_NEWS_ENDPOINT = 'https://news.google.com/rss/search';

/**
 * Build a Google News search query for a symbol restricted to the given
 * source domains and to recent items only (so results naturally "reset" daily).
 */
export function buildQuery(symbol: string, domains: string[], windowDays = 2): string {
  const base = `${symbol} (share OR stock OR NSE OR results)`;
  const sites = domains.length ? ` (${domains.map((d) => `site:${d}`).join(' OR ')})` : '';
  return `${base}${sites} when:${Math.max(1, windowDays)}d`;
}

export async function fetchGoogleNews(query: string, limit = 40): Promise<RawNewsItem[]> {
  const url = `${GOOGLE_NEWS_ENDPOINT}?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': NEWS_UA, Accept: 'application/rss+xml, application/xml, text/xml' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`News fetch failed (${res.status})`);
  const xml = await res.text();
  return parseRssItems(xml, 'News', limit);
}
