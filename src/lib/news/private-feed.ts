/**
 * Best-effort fetcher for private / authenticated news feeds.
 *
 * For a user-configured private source we try a few conventional feed paths
 * (/feed, /rss, …) over HTTPS, attaching the provided credentials. This is
 * intentionally conservative: if a site has no discoverable feed it simply
 * yields nothing (the public news search still covers the rest).
 *
 * SECURITY (SSRF): only HTTPS to the exact configured public hostname is
 * allowed. Loopback, link-local, and RFC-1918 / private hostnames and IP
 * literals are rejected. Credentials are sent only to that host.
 */

import { parseRssItems, NEWS_UA, type RawNewsItem } from './rss';

export interface SourceAuth {
  token?: string | null;
  user?: string | null;
  pass?: string | null;
}

const FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/feeds/posts/default', '/atom.xml'];

// Reject obvious private / internal hosts and any IP literal.
const BLOCKED_HOST =
  /^(?:localhost|.*\.local|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?)$/i;
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isSafeHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (BLOCKED_HOST.test(host)) return false;
  if (IP_LITERAL.test(host)) return false; // force DNS names only
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(host);
}

function authHeader(auth: SourceAuth): Record<string, string> {
  if (auth.token) return { Authorization: `Bearer ${auth.token}` };
  if (auth.user) {
    const basic = Buffer.from(`${auth.user}:${auth.pass ?? ''}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }
  return {};
}

export async function fetchPrivateFeed(domain: string, auth: SourceAuth): Promise<RawNewsItem[]> {
  if (!isSafeHost(domain)) return [];

  const headers: Record<string, string> = {
    'User-Agent': NEWS_UA,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    ...authHeader(auth),
  };

  for (const path of FEED_PATHS) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        headers,
        redirect: 'error', // don't follow redirects to other hosts
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (!/xml|rss|atom/i.test(ct)) continue;
      const xml = await res.text();
      const items = parseRssItems(xml, domain, 40).map((i) => ({ ...i, source: domain }));
      if (items.length) return items;
    } catch {
      /* try the next candidate path */
    }
  }
  return [];
}
