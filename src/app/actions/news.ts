'use server';

/**
 * Server actions for the Radar news + market-mood panel.
 *
 * News is fetched live (Google News RSS for public domains + best-effort
 * authenticated feeds for private sources) and never persisted. A tiny
 * in-memory cache keyed by symbol + IST date keeps repeat selections fast and
 * naturally "resets" once the day rolls over. Source config IS persisted
 * (RadarNewsSource) so it syncs across devices; credentials are stored in the
 * user's own DB and never returned to the client.
 */

import { prisma } from '@/lib/db';
import { buildQuery, fetchGoogleNews } from '@/lib/news/google-news';
import { fetchPrivateFeed } from '@/lib/news/private-feed';
import type { RawNewsItem } from '@/lib/news/rss';
import { scoreHeadline, aggregateMood, type Sentiment } from '@/lib/news/sentiment';
import { getInstrumentData } from '@/lib/instrument-service';
import { providerById, providerForDomain, DEFAULT_PROVIDER } from '@/lib/news/providers';
import { fetchXNews } from '@/lib/news/x-provider';

/**
 * Search breadth for a symbol's news.
 *  - `strict`: match the ticker symbol only (precise, less noise).
 *  - `casual`: if symbol news is thin, also search by the company name.
 */
export type NewsMode = 'strict' | 'casual';

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: Sentiment;
}

export interface NewsResult {
  symbol: string;
  items: NewsItem[];
  mood: Sentiment;
  score: number; // -100..100
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  fetchedAt: string;
  error?: string;
  /** Non-fatal notices (e.g. an X API billing/tier issue). */
  note?: string;
}

/** Client-safe view of a source (never exposes secret values). */
export interface NewsSourceInfo {
  domain: string;
  isPrivate: boolean;
  provider: string;
  hasAuth: boolean;
}

export interface NewsSourceAuthInput {
  isPrivate?: boolean;
  provider?: string;
  /** Provider-specific credentials (bearerToken, token, user, pass, …). */
  config?: Record<string, string>;
}

// Adaptive lookback. We fetch a broad pool (up to MAX_WINDOW_DAYS) once, then
// pick the *tightest* window that still yields a useful number of headlines:
//  - lots of news  → clamp to ~3 recent days (fresh & relevant)
//  - hardly any    → widen progressively, up to 30 days
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 30;
const WINDOW_TIERS_DAYS = [3, 7, 15, 30];
const DESIRED_COUNT = 6; // smallest window that reaches this "wins"

// India-equity defaults seeded on first use. X/Twitter is intentionally NOT a
// default — it needs API credentials, so users add it themselves.
const DEFAULT_SOURCES = [
  'moneycontrol.com',
  'economictimes.indiatimes.com',
  'livemint.com',
  'business-standard.com',
  'marketsmojo.com',
  'ndtvprofit.com',
  'thehindubusinessline.com',
  'timesofindia.indiatimes.com',
  'cnbctv18.com',
];

// ---------------------------------------------------------------------------
// Source domains (persisted, allow-list validated)
// ---------------------------------------------------------------------------
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/;

/** Normalise user input to a bare domain (or null if it isn't a valid domain). */
export async function normalizeDomain(input: string): Promise<string | null> {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  if (!d || d.length > 253 || !DOMAIN_RE.test(d)) return null;
  return d;
}

async function ensureSeeded(): Promise<void> {
  const count = await prisma.radarNewsSource.count();
  if (count === 0) {
    for (const domain of DEFAULT_SOURCES) {
      await prisma.radarNewsSource.upsert({ where: { domain }, update: {}, create: { domain } });
    }
  }
}

/** Full source records (server-internal — includes credentials). */
async function getSourceRecords() {
  await ensureSeeded();
  return prisma.radarNewsSource.findMany({ orderBy: { createdAt: 'asc' } });
}

/** Parse a source row's stored credentials into a key→value map. */
function parseConfig(row: { authConfig: string | null; authToken: string | null; authUser: string | null; authPass: string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  if (row.authConfig) {
    try {
      const parsed = JSON.parse(row.authConfig);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v) out[k] = v;
        }
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
  // Legacy single-credential columns as a fallback.
  if (!out.token && row.authToken) out.token = row.authToken;
  if (!out.user && row.authUser) out.user = row.authUser;
  if (!out.pass && row.authPass) out.pass = row.authPass;
  return out;
}

/** Client-facing list (no secrets). */
export async function listNewsSources(): Promise<NewsSourceInfo[]> {
  const rows = await getSourceRecords();
  return rows.map((r) => ({
    domain: r.domain,
    isPrivate: r.isPrivate,
    provider: r.provider || DEFAULT_PROVIDER,
    hasAuth: Object.keys(parseConfig(r)).length > 0,
  }));
}

export async function addNewsSource(
  input: string,
  auth?: NewsSourceAuthInput,
): Promise<{ sources: NewsSourceInfo[]; added: string | null; error?: string }> {
  const domain = await normalizeDomain(input);
  if (!domain) {
    return { sources: await listNewsSources(), added: null, error: 'Enter a valid public domain (e.g. moneycontrol.com).' };
  }

  const provider = auth?.provider || providerForDomain(domain);
  const spec = providerById(provider);

  // Keep only known, non-empty credential fields for this provider.
  const config: Record<string, string> = {};
  for (const field of spec.fields) {
    const v = auth?.config?.[field.key]?.trim();
    if (v) config[field.key] = v;
  }
  const hasNewAuth = Object.keys(config).length > 0;

  // If editing an existing same-provider source and no new credentials were
  // supplied, keep the stored ones (so users can tweak without re-typing tokens).
  const existing = await prisma.radarNewsSource.findUnique({ where: { domain } }).catch(() => null);
  const keepExisting =
    !hasNewAuth && !!existing && (existing.provider || DEFAULT_PROVIDER) === provider && !!existing.authConfig;

  // Required-field validation (e.g. X needs a Bearer Token) — skipped when we're
  // keeping already-stored credentials.
  if (!keepExisting) {
    const missing = spec.fields.filter((f) => f.required && !config[f.key]);
    if (missing.length) {
      return {
        sources: await listNewsSources(),
        added: null,
        error: `${spec.label} needs: ${missing.map((f) => f.label).join(', ')}.`,
      };
    }
  }

  const authConfig = hasNewAuth ? JSON.stringify(config) : keepExisting ? existing!.authConfig : null;
  const isPrivate = Boolean(auth?.isPrivate || authConfig || provider !== DEFAULT_PROVIDER);

  try {
    await prisma.radarNewsSource.upsert({
      where: { domain },
      update: { isPrivate, provider, authConfig, authToken: null, authUser: null, authPass: null },
      create: { domain, isPrivate, provider, authConfig },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { sources: await listNewsSources().catch(() => []), added: null, error: `Save failed: ${detail}` };
  }
  return { sources: await listNewsSources(), added: domain };
}

export async function removeNewsSource(input: string): Promise<NewsSourceInfo[]> {
  const domain = await normalizeDomain(input);
  if (domain) {
    await prisma.radarNewsSource.deleteMany({ where: { domain } });
  }
  return listNewsSources();
}

// ---------------------------------------------------------------------------
// News fetch + mood (live, cached per symbol per IST day)
// ---------------------------------------------------------------------------
interface CacheEntry {
  ts: number;
  result: NewsResult;
}
const newsCache = new Map<string, CacheEntry>();
const NEWS_TTL_MS = 10 * 60_000; // 10 minutes

function istDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function cleanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
}

/**
 * Turn a raw instrument name into a search-friendly company name.
 * Strips corporate suffixes ("Limited", "Ltd", "& Co", …) so the phrase search
 * matches how outlets actually refer to the company.
 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/\b(limited|ltd|private|pvt|corporation|corp|company|co)\b\.?/gi, '')
    .replace(/[.,]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a headline relevance test.
 *  - strict: the title must contain the ticker symbol as a distinct token.
 *  - casual: the title may contain the symbol OR the company name.
 */
function makeMatcher(symbol: string, company: string, mode: NewsMode): (title: string) => boolean {
  // Symbol as a whole token (non-alphanumeric boundaries), e.g. \bIRB\b.
  const symRe = new RegExp(`(^|[^a-z0-9])${escapeRegExp(symbol)}([^a-z0-9]|$)`, 'i');

  const nameNeedles: string[] = [];
  if (mode === 'casual' && company) {
    const words = company.split(/\s+/).filter(Boolean);
    if (words.length) {
      // First 1–2 words are usually how outlets name the company, plus the
      // full cleaned name for exact mentions.
      nameNeedles.push(words.slice(0, 2).join(' ').toLowerCase());
      nameNeedles.push(company.toLowerCase());
    }
  }
  const uniqueNeedles = [...new Set(nameNeedles)].filter((n) => n.length >= 3);

  return (title: string) => {
    if (symRe.test(title)) return true;
    if (uniqueNeedles.length) {
      const t = title.toLowerCase();
      return uniqueNeedles.some((n) => t.includes(n));
    }
    return false;
  };
}

/** De-dupe by title within the 30-day hard cap, newest first. */
function buildPool(items: RawNewsItem[], now: number): RawNewsItem[] {
  const hardCutoff = now - MAX_WINDOW_DAYS * DAY_MS;
  const seen = new Set<string>();
  const pool: RawNewsItem[] = [];
  for (const item of items) {
    const when = Date.parse(item.publishedAt);
    if (!Number.isNaN(when) && when < hardCutoff) continue;
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pool.push(item);
  }
  pool.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return pool;
}

function pruneCache(today: string) {
  for (const [key, entry] of newsCache) {
    const staleDay = !key.endsWith(`|${today}`);
    if (staleDay || Date.now() - entry.ts > NEWS_TTL_MS) newsCache.delete(key);
  }
}

/**
 * Choose the tightest lookback window that still yields enough headlines.
 * `ages` are item ages in ms (any order). Returns the cutoff age in ms.
 */
function pickWindowMs(ages: number[]): number {
  for (const days of WINDOW_TIERS_DAYS) {
    const cutoff = days * DAY_MS;
    const within = ages.filter((a) => a <= cutoff).length;
    if (within >= DESIRED_COUNT) return cutoff;
  }
  // Sparse everywhere — take the widest allowed window.
  return MAX_WINDOW_DAYS * DAY_MS;
}

function emptyResult(symbol: string, error?: string): NewsResult {
  return {
    symbol,
    items: [],
    mood: 'neutral',
    score: 0,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    fetchedAt: new Date().toISOString(),
    error,
  };
}

export async function getStockNews(symbol: string, mode: NewsMode = 'casual'): Promise<NewsResult> {
  const clean = cleanSymbol(symbol);
  const today = istDate();
  if (!clean) return emptyResult(clean);

  pruneCache(today);
  const cacheKey = `${clean}|${mode}|${today}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < NEWS_TTL_MS) return cached.result;

  try {
    const records = await getSourceRecords();
    const publicDomains = records
      .filter((r) => (r.provider || DEFAULT_PROVIDER) === 'rss' && !r.isPrivate)
      .map((r) => r.domain);
    const privateRss = records.filter((r) => (r.provider || DEFAULT_PROVIDER) === 'rss' && r.isPrivate);
    const xSources = records.filter((r) => r.provider === 'x');

    // Company name is needed for casual mode and for X search.
    let company = '';
    if (mode === 'casual' || xSources.length > 0) {
      const instr = await getInstrumentData(clean).catch(() => undefined);
      company = instr?.name ? cleanCompanyName(instr.name) : '';
      if (company.toUpperCase() === clean) company = '';
    }

    // Public: Google News query for the symbol across all public domains.
    const symbolItemsP = fetchGoogleNews(buildQuery(clean, publicDomains, MAX_WINDOW_DAYS), 60).catch(
      () => [] as RawNewsItem[],
    );

    // Casual mode: parallel name search so headlines that mention the company
    // (but not the ticker) are also caught.
    const nameItemsP: Promise<RawNewsItem[]> =
      mode === 'casual' && company
        ? fetchGoogleNews(buildQuery(`"${company}"`, publicDomains, MAX_WINDOW_DAYS), 60).catch(
            () => [] as RawNewsItem[],
          )
        : Promise.resolve([]);

    // Private RSS: best-effort authenticated feed per source.
    const privateItemsP = Promise.all(
      privateRss.map((r) => {
        const c = parseConfig(r);
        return fetchPrivateFeed(r.domain, { token: c.token, user: c.user, pass: c.pass }).catch(
          () => [] as RawNewsItem[],
        );
      }),
    );

    // X (Twitter) API sources.
    const xItemsP = Promise.all(
      xSources.map((r) => fetchXNews(clean, company, parseConfig(r)).catch(() => ({ items: [] as RawNewsItem[] }))),
    );

    const [symbolItems, nameItems, privateGroups, xResults] = await Promise.all([
      symbolItemsP,
      nameItemsP,
      privateItemsP,
      xItemsP,
    ]);
    const now = Date.now();

    const xItems = xResults.flatMap((r) => r.items);
    const xNote = [...new Set(xResults.map((r) => r.error).filter(Boolean))].join(' · ') || undefined;

    // Keep only headlines that actually reference the symbol (strict) or the
    // symbol/company name (casual). This is what makes the two modes differ.
    const matches = makeMatcher(clean, company, mode);
    const relevant = [...symbolItems, ...nameItems, ...privateGroups.flat(), ...xItems].filter((it) =>
      matches(it.title),
    );
    const pool = buildPool(relevant, now);

    // Adaptive window: tight when news is plentiful, wider when it's sparse.
    const ages = pool.map((it) => {
      const when = Date.parse(it.publishedAt);
      return Number.isNaN(when) ? 0 : now - when;
    });
    const windowMs = pickWindowMs(ages);
    const deduped = pool.filter((_, i) => ages[i] <= windowMs);

    const items: NewsItem[] = deduped.map((it) => ({ ...it, sentiment: scoreHeadline(it.title).sentiment }));
    const mood = aggregateMood(items.map((i) => i.title));

    const result: NewsResult = {
      symbol: clean,
      items,
      mood: mood.mood,
      score: mood.score,
      bullishCount: mood.bullishCount,
      bearishCount: mood.bearishCount,
      neutralCount: mood.neutralCount,
      fetchedAt: new Date().toISOString(),
      note: xNote,
    };

    newsCache.set(cacheKey, { ts: Date.now(), result });
    return result;
  } catch (err) {
    return emptyResult(clean, err instanceof Error ? err.message : 'Failed to fetch news');
  }
}
