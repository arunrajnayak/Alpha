/**
 * Index Constituents Service
 * 
 * Fetches index constituent lists from niftyindices.com CSVs,
 * caches them locally, and maps symbols to Upstox instrument keys.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parse } from 'csv-parse/sync';
import { extractText } from 'unpdf';
import { getInstrumentKeys } from './instrument-service';
import totalMarketRebalancesData from './data/total-market-rebalances.json';
import { prisma } from '@/lib/db';
import { todayISTYmd } from '@/lib/tz';

export interface TotalMarketRebalance {
  effectiveDate: string;
  circularDate: string;
  url: string;
  excluded: string[];
  included: string[];
}

const totalMarketRebalances: TotalMarketRebalance[] = (
  totalMarketRebalancesData as TotalMarketRebalance[]
).slice().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));


// ============================================================================
// Configuration
// ============================================================================

const CACHE_DIR = path.join(os.tmpdir(), 'alpha_cache', 'index_constituents');
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days — constituents rebalance quarterly/semi-annually

/**
 * Index definitions with their CSV download URLs and Upstox index instrument keys
 */
export type IndexCategory = 'broad' | 'momentum' | 'sectoral';

export const INDEX_CONFIG: Record<string, { csvUrl?: string; upstoxKey: string; shortName: string; category: IndexCategory }> = {
  'NIFTY 50': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv',
    upstoxKey: 'NSE_INDEX|Nifty 50',
    shortName: 'Nifty 50',
    category: 'broad',
  },
  'NIFTY Next 50': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftynext50list.csv',
    upstoxKey: 'NSE_INDEX|Nifty Next 50',
    shortName: 'Next 50',
    category: 'broad',
  },
  'NIFTY Midcap 100': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY MIDCAP 100',
    shortName: 'Midcap 100',
    category: 'broad',
  },
  'NIFTY Midcap 150': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY MID SELECT',
    shortName: 'Midcap 150',
    category: 'broad',
  },
  'NIFTY Smallcap 250': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY SMLCAP 250',
    shortName: 'Smallcap 250',
    category: 'broad',
  },
  'NIFTY Microcap 250': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY MICROCAP250',
    shortName: 'Microcap 250',
    category: 'broad',
  },
  'NIFTY 500': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY 500',
    shortName: 'Nifty 500',
    category: 'broad',
  },
  'NIFTY Total Market': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv',
    upstoxKey: 'NSE_INDEX|NIFTY TOTAL MKT',
    shortName: 'Total Market',
    category: 'broad',
  },
  'NIFTY 200 Momentum 30': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_nifty200momentum30_list.csv',
    upstoxKey: 'NSE_INDEX|Nifty200Momentm30',
    shortName: 'Mom 200/30',
    category: 'momentum',
  },
  'NIFTY Midcap150 Momentum 50': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymidcap150momentum50_list.csv',
    upstoxKey: 'NSE_INDEX|NiftyM150Momntm50',
    shortName: 'MidMom 50',
    category: 'momentum',
  },
  'NIFTY500 Momentum 50': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_nifty500momentum50_list.csv',
    upstoxKey: 'NSE_INDEX|Nifty500Momentm50',
    shortName: 'Mom 500/50',
    category: 'momentum',
  },
  // Sectoral Indices
  'NIFTY Bank': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftybanklist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Bank',
    shortName: 'Bank',
    category: 'sectoral',
  },
  'NIFTY Financial Services': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyfinancelist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Fin Service',
    shortName: 'Financial',
    category: 'sectoral',
  },
  'NIFTY Private Bank': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyprivatebanklist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Pvt Bank',
    shortName: 'Pvt Bank',
    category: 'sectoral',
  },
  'NIFTY PSU Bank': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftypsubanklist.csv',
    upstoxKey: 'NSE_INDEX|Nifty PSU Bank',
    shortName: 'PSU Bank',
    category: 'sectoral',
  },
  'NIFTY IT': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyitlist.csv',
    upstoxKey: 'NSE_INDEX|Nifty IT',
    shortName: 'IT',
    category: 'sectoral',
  },
  'NIFTY Auto': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyautolist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Auto',
    shortName: 'Auto',
    category: 'sectoral',
  },
  'NIFTY FMCG': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyfmcglist.csv',
    upstoxKey: 'NSE_INDEX|Nifty FMCG',
    shortName: 'FMCG',
    category: 'sectoral',
  },
  'NIFTY Pharma': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftypharmalist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Pharma',
    shortName: 'Pharma',
    category: 'sectoral',
  },
  'NIFTY Healthcare': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyhealthcarelist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Healthcare',
    shortName: 'Healthcare',
    category: 'sectoral',
  },
  'NIFTY Metal': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymetallist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Metal',
    shortName: 'Metal',
    category: 'sectoral',
  },
  'NIFTY Energy': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyenergylist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Energy',
    shortName: 'Energy',
    category: 'sectoral',
  },
  'NIFTY Oil & Gas': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyoilgaslist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Oil and Gas',
    shortName: 'Oil & Gas',
    category: 'sectoral',
  },
  'NIFTY Realty': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyrealtylist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Realty',
    shortName: 'Realty',
    category: 'sectoral',
  },
  'NIFTY Media': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymedialist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Media',
    shortName: 'Media',
    category: 'sectoral',
  },
  'NIFTY Telecom': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftytelecomlist.csv',
    upstoxKey: 'NSE_INDEX|NIFTY TELECOM',
    shortName: 'Telecom',
    category: 'sectoral',
  },
  'NIFTY Consumer Durables': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyconsdurableslist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Cons Durable',
    shortName: 'Cons Durables',
    category: 'sectoral',
  },
  'NIFTY Infrastructure': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftyinfrastructurelist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Infra',
    shortName: 'Infra',
    category: 'sectoral',
  },
  'NIFTY Commodities': {
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftycommoditieslist.csv',
    upstoxKey: 'NSE_INDEX|Nifty Commodities',
    shortName: 'Commodities',
    category: 'sectoral',
  },
  'NIFTY CPSE': { upstoxKey: 'NSE_INDEX|Nifty CPSE', shortName: 'CPSE', category: 'sectoral', csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftycpselist.csv' },
  'NIFTY Railways PSU': { upstoxKey: 'NSE_INDEX|Nifty RailwaysPSU', shortName: 'Railways PSU', category: 'sectoral' },
  'NIFTY Chemicals': { upstoxKey: 'NSE_INDEX|Nifty Chemicals', shortName: 'Chemicals', category: 'sectoral' },
  'NIFTY Capital Mkt': { upstoxKey: 'NSE_INDEX|Nifty Capital Mkt', shortName: 'Capital Mkt', category: 'sectoral' },
  'NIFTY Ind Tourism': { upstoxKey: 'NSE_INDEX|Nifty Ind Tourism', shortName: 'Ind Tourism', category: 'sectoral' },
  'NIFTY Ind Defence': { upstoxKey: 'NSE_INDEX|Nifty Ind Defence', shortName: 'Ind Defence', category: 'sectoral' },
};

// In-memory cache
const memoryCache = new Map<string, { symbols: string[]; weights: Record<string, number>; timestamp: number }>();

// Browser-like headers for niftyindices.com
const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the cache file path for an index
 */
function getCacheFilePath(indexName: string): string {
  const safeFileName = indexName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return path.join(CACHE_DIR, `${safeFileName}.json`);
}

/**
 * Parse CSV content to extract trading symbols and weights.
 * niftyindices.com CSVs typically have "Symbol" and "Weight(%)" columns.
 */
function parseCSV(csvContent: string): { symbols: string[]; weights: Record<string, number> } {
  try {
    // Remove BOM if present
    const clean = csvContent.replace(/^\uFEFF/, '').trim();
    
    const records = parse(clean, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    const symbols: string[] = [];
    const weights: Record<string, number> = {};

    for (const record of records as Record<string, string>[]) {
      // Try common column names for symbol
      const symbol = record['Symbol'] || record['symbol'] || record['SYMBOL'] || record['Trading Symbol'];
      if (symbol && typeof symbol === 'string' && symbol.trim()) {
        const sym = symbol.trim().toUpperCase();
        symbols.push(sym);
        
        // Try to parse weight
        const weightStr = record['Weight(%)'] || record['Weightage(%)'] || record['Weight'] || record['weight'];
        if (weightStr) {
          const w = parseFloat(weightStr);
          if (!isNaN(w) && w > 0) {
            weights[sym] = w;
          }
        }
      }
    }

    return { symbols, weights };
  } catch (error) {
    console.error('[IndexConstituents] CSV parse error:', error);
    return { symbols: [], weights: {} };
  }
}

/**
 * Fetch CSV from niftyindices.com with browser-like headers
 */
async function fetchCSV(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
    });

    if (!response.ok) {
      console.error(`[IndexConstituents] CSV fetch failed: ${response.status} for ${url}`);
      return null;
    }

    const text = await response.text();

    // Detect HTML responses (e.g. 404 pages served as 200)
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      console.error(`[IndexConstituents] CSV URL returned HTML instead of CSV: ${url}`);
      return null;
    }

    return text;
  } catch (error) {
    console.error(`[IndexConstituents] CSV fetch error for ${url}:`, error);
    return null;
  }
}

// In-memory cache for historical total market constituent sets by epoch key
const historicalTotalMarketCache = new Map<string, Set<string>>();

/**
 * Load Total Market rebalances from AppConfig (if available in database),
 * falling back to the bundled total-market-rebalances.json.
 */
export async function loadTotalMarketRebalances(): Promise<TotalMarketRebalance[]> {
  try {
    const configRow = await prisma.appConfig.findUnique({
      where: { key: 'TOTAL_MARKET_REBALANCES' },
    });
    if (configRow?.value) {
      const parsed = JSON.parse(configRow.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as TotalMarketRebalance[]).slice().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
      }
    }
  } catch {
    // If DB is temporarily unreachable or table not ready, fallback to bundled JSON
  }
  return (totalMarketRebalancesData as TotalMarketRebalance[]).slice().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

/**
 * Get the Total Market rebalance epoch key for a given date.
 * Returns the effective date of the latest rebalance that has taken effect on or before asOfDate.
 */
export function getTotalMarketRebalanceEpochKey(asOfDate: Date, rebalances: TotalMarketRebalance[] = totalMarketRebalances): string {
  const asOfDateStr = new Date(asOfDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  for (const r of rebalances) {
    if (asOfDateStr >= r.effectiveDate) {
      return r.effectiveDate;
    }
  }
  return 'pre_2024';
}

/**
 * Get Nifty Total Market constituents as of a specific date.
 * If asOfDate is omitted, returns the current constituent set.
 * Otherwise, unwinds historical rebalances (exclusions & inclusions from NSE circulars)
 * backwards from current constituents to construct the exact constituent set for that historical date.
 */
export async function getTotalMarketConstituents(asOfDate?: Date): Promise<Set<string>> {
  const currentSymbols = await getIndexConstituents('NIFTY Total Market');
  if (!asOfDate) {
    return new Set(currentSymbols.map((s) => s.toUpperCase()));
  }

  const rebalances = await loadTotalMarketRebalances();
  const asOfDateStr = new Date(asOfDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const epochKey = getTotalMarketRebalanceEpochKey(asOfDate, rebalances);

  const cached = historicalTotalMarketCache.get(epochKey);
  if (cached) {
    return cached;
  }

  // Start with current constituents
  const constituentSet = new Set(currentSymbols.map((s) => s.toUpperCase()));

  // Unwind each rebalance that took effect after asOfDate (sorted descending)
  for (const r of rebalances) {
    if (asOfDateStr < r.effectiveDate) {
      // Rebalance happened after asOfDate:
      // Remove stocks that were included in this rebalance
      for (const inc of r.included) {
        constituentSet.delete(inc.toUpperCase());
      }
      // Add back stocks that were excluded in this rebalance
      for (const exc of r.excluded) {
        constituentSet.add(exc.toUpperCase());
      }
    }
  }

  historicalTotalMarketCache.set(epochKey, constituentSet);
  return constituentSet;
}

/**
 * Get constituent symbols for an index.
 * Uses multi-layer caching: memory → disk → fetch from niftyindices.com.
 * When indexName is 'NIFTY Total Market' and asOfDate is supplied, resolves point-in-time constituents.
 */
export async function getIndexConstituents(indexName: string, asOfDate?: Date): Promise<string[]> {
  if (indexName === 'NIFTY Total Market' && asOfDate) {
    const set = await getTotalMarketConstituents(asOfDate);
    return Array.from(set);
  }
  const result = await getIndexConstituentData(indexName);
  return result.symbols;
}

export interface TotalMarketSyncResult {
  status: 'up_to_date' | 'rebalanced' | 'initialized';
  totalConstituents: number;
  newRebalance?: TotalMarketRebalance;
  message: string;
}

const NSE_API_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  'Referer': 'https://www.nseindia.com/resources/exchange-communication-press-releases',
  'Accept': '*/*',
};

const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseWefDate(body: string): string | null {
  const match = body.match(/w\.e\.f\.\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return null;
  const [, monthStr, dayStr, yearStr] = match;
  const month = MONTH_MAP[monthStr.toLowerCase()];
  if (!month) return null;
  const day = dayStr.padStart(2, '0');
  return `${yearStr}-${month}-${day}`;
}

/**
 * Extract exclusions and inclusions for Nifty Total Market from an official NSE press release PDF.
 */
export async function parseNseCircularPdf(pdfUrl: string): Promise<{ excluded: string[]; included: string[] }> {
  const res = await fetch(pdfUrl, {
    headers: {
      ...NSE_API_HEADERS,
      'Referer': 'https://www.nseindia.com/',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download NSE circular PDF (${res.status} ${res.statusText}): ${pdfUrl}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const { text } = await extractText(new Uint8Array(arrayBuffer));
  const pages = Array.isArray(text) ? text : [text];
  const allLines = pages.flatMap((p) => p.split('\n').map((l) => l.trim()));

  let inTm = false;
  let mode: 'excluded' | 'included' | null = null;
  const excluded: string[] = [];
  const included: string[] = [];

  for (const line of allLines) {
    if (/(?:[a-z]|\d+)\)\s*Nifty Total Market/i.test(line)) {
      inTm = true;
      continue;
    }
    if (inTm && /^(?:[a-z]|\d+)\)\s*Nifty/i.test(line)) {
      break;
    }
    if (inTm) {
      if (line.toLowerCase().includes('following companies are being excluded')) {
        mode = 'excluded';
        continue;
      } else if (line.toLowerCase().includes('following companies are being included')) {
        mode = 'included';
        continue;
      }

      const m = line.match(/^\d+\s+(.+?)\s+([A-Z0-9&\-_]+)\*?$/);
      if (m) {
        const sym = m[2].replace(/\*+$/, '').trim().toUpperCase();
        if (!['SYMBOL', 'NSE', 'ISIN'].includes(sym)) {
          if (mode === 'excluded') excluded.push(sym);
          else if (mode === 'included') included.push(sym);
        }
      }
    }
  }

  return {
    excluded: Array.from(new Set(excluded)).sort(),
    included: Array.from(new Set(included)).sort(),
  };
}

/**
 * Query the official NSE Press Release CMS API to find and parse any newly announced
 * semi-annual rebalance circulars for Nifty Total Market.
 */
export async function fetchRecentNseCircularRebalances(
  knownEffectiveDates: Set<string>
): Promise<TotalMarketRebalance[]> {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = now.getMonth() < 3 ? [currentYear - 1, currentYear] : [currentYear];
    const windows: Array<{ from: string; to: string }> = [];

    for (const y of years) {
      windows.push({ from: `01-02-${y}`, to: `28-02-${y}` });
      windows.push({ from: `01-08-${y}`, to: `31-08-${y}` });
    }

    const newRebalances: TotalMarketRebalance[] = [];

    for (const { from, to } of windows) {
      const url = `https://www.nseindia.com/api/press-release-cms20?fromDate=${from}&toDate=${to}`;
      const res = await fetch(url, { headers: NSE_API_HEADERS });
      if (!res.ok) continue;

      const items = (await res.json()) as Array<{
        content?: {
          field_date?: string;
          body?: string;
          field_file_attachement?: { url?: string };
        };
      }>;

      for (const item of items) {
        const body = item.content?.body || '';
        if (body.toLowerCase().includes('replacements in indices') && body.toLowerCase().includes('w.e.f.')) {
          const pdfUrl = item.content?.field_file_attachement?.url;
          const circDate = item.content?.field_date || '';
          const effIso = parseWefDate(body);

          if (!effIso || !pdfUrl || knownEffectiveDates.has(effIso)) {
            continue;
          }

          console.log(`[IndexConstituents] Discovered new NSE rebalance circular: ${effIso} (${circDate}) -> ${pdfUrl}`);
          const { excluded, included } = await parseNseCircularPdf(pdfUrl);
          if (excluded.length > 0 || included.length > 0) {
            newRebalances.push({
              effectiveDate: effIso,
              circularDate: circDate,
              url: pdfUrl,
              excluded,
              included,
            });
            knownEffectiveDates.add(effIso);
          }
        }
      }
    }

    return newRebalances;
  } catch (err) {
    console.warn('[IndexConstituents] Warning: Failed to query NSE Press Release API:', err);
    return [];
  }
}

/**
 * Automatically synchronize Nifty Total Market constituents.
 * 1. Checks official NSE press release circulars for newly announced semi-annual rebalances (using unpdf).
 * 2. Checks niftyindices.com live CSV to keep the current constituent set updated.
 * 3. Records changes into AppConfig in Turso and clears point-in-time constituent caches.
 */
export async function syncTotalMarketConstituents(): Promise<TotalMarketSyncResult> {
  const existingRebalances = await loadTotalMarketRebalances();
  const knownDates = new Set(existingRebalances.map((r) => r.effectiveDate));
  
  // 1. Proactively query NSE Press Release CMS for newly announced circulars
  let circularRebalancesFound: TotalMarketRebalance[] = [];
  try {
    circularRebalancesFound = await fetchRecentNseCircularRebalances(knownDates);
  } catch (err) {
    console.warn('[IndexConstituents] NSE circular check failed (non-fatal):', err);
  }

  let updatedRebalances = [...existingRebalances];
  if (circularRebalancesFound.length > 0) {
    updatedRebalances = [...circularRebalancesFound, ...updatedRebalances];
    updatedRebalances.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

    await prisma.appConfig.upsert({
      where: { key: 'TOTAL_MARKET_REBALANCES' },
      create: {
        key: 'TOTAL_MARKET_REBALANCES',
        value: JSON.stringify(updatedRebalances),
      },
      update: {
        value: JSON.stringify(updatedRebalances),
      },
    });

    historicalTotalMarketCache.clear();
  }

  // 2. Fetch current constituent list from niftyindices.com
  const freshSymbols = await refreshIndexConstituents('NIFTY Total Market');
  if (freshSymbols.length === 0) {
    throw new Error('Failed to fetch NIFTY Total Market constituents from niftyindices.com');
  }

  const freshSet = new Set(freshSymbols.map((s) => s.toUpperCase()));

  // 3. Load stored state from AppConfig
  const storedConfig = await prisma.appConfig.findUnique({
    where: { key: 'TOTAL_MARKET_CURRENT_SYMBOLS' },
  });

  if (!storedConfig?.value) {
    // Seed initial state in database
    await prisma.appConfig.upsert({
      where: { key: 'TOTAL_MARKET_CURRENT_SYMBOLS' },
      create: {
        key: 'TOTAL_MARKET_CURRENT_SYMBOLS',
        value: JSON.stringify(Array.from(freshSet).sort()),
      },
      update: {
        value: JSON.stringify(Array.from(freshSet).sort()),
      },
    });

    if (updatedRebalances.length > 0) {
      await prisma.appConfig.upsert({
        where: { key: 'TOTAL_MARKET_REBALANCES' },
        create: {
          key: 'TOTAL_MARKET_REBALANCES',
          value: JSON.stringify(updatedRebalances),
        },
        update: {
          value: JSON.stringify(updatedRebalances),
        },
      });
    }

    return {
      status: 'initialized',
      totalConstituents: freshSymbols.length,
      message: `Initialized Nifty Total Market with ${freshSymbols.length} constituents`,
    };
  }

  const storedSymbolsArray: string[] = JSON.parse(storedConfig.value);
  const storedSet = new Set(storedSymbolsArray.map((s) => s.toUpperCase()));

  // 4. Detect CSV changes against stored snapshot
  const included = Array.from(freshSet).filter((s) => !storedSet.has(s)).sort();
  const excluded = Array.from(storedSet).filter((s) => !freshSet.has(s)).sort();

  // If CSV changed and we did NOT discover an NSE circular for today's date, record the CSV diff
  if (included.length > 0 || excluded.length > 0) {
    const todayYmd = todayISTYmd();
    const csvRebalance: TotalMarketRebalance = {
      effectiveDate: todayYmd,
      circularDate: todayYmd,
      url: 'https://www.niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv',
      excluded,
      included,
    };

    if (!updatedRebalances.some((r) => r.effectiveDate === todayYmd)) {
      updatedRebalances = [csvRebalance, ...updatedRebalances];
      updatedRebalances.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

      await prisma.appConfig.upsert({
        where: { key: 'TOTAL_MARKET_REBALANCES' },
        create: {
          key: 'TOTAL_MARKET_REBALANCES',
          value: JSON.stringify(updatedRebalances),
        },
        update: {
          value: JSON.stringify(updatedRebalances),
        },
      });
    }

    await prisma.appConfig.upsert({
      where: { key: 'TOTAL_MARKET_CURRENT_SYMBOLS' },
      create: {
        key: 'TOTAL_MARKET_CURRENT_SYMBOLS',
        value: JSON.stringify(Array.from(freshSet).sort()),
      },
      update: {
        value: JSON.stringify(Array.from(freshSet).sort()),
      },
    });

    historicalTotalMarketCache.clear();

    return {
      status: 'rebalanced',
      totalConstituents: freshSymbols.length,
      newRebalance: circularRebalancesFound[0] || csvRebalance,
      message: `Rebalance detected! Added ${included.length} stocks, removed ${excluded.length} stocks.`,
    };
  }

  // If a circular was found even if CSV hasn't flipped yet
  if (circularRebalancesFound.length > 0) {
    return {
      status: 'rebalanced',
      totalConstituents: freshSymbols.length,
      newRebalance: circularRebalancesFound[0],
      message: `New NSE rebalance circular discovered (${circularRebalancesFound[0].effectiveDate}) with ${circularRebalancesFound[0].included.length} inclusions and ${circularRebalancesFound[0].excluded.length} exclusions.`,
    };
  }

  return {
    status: 'up_to_date',
    totalConstituents: freshSymbols.length,
    message: `Nifty Total Market is up to date (${freshSymbols.length} constituents, 0 changes)`,
  };
}


/**
 * Get constituent symbols AND weights for an index.
 */
export async function getIndexConstituentData(indexName: string): Promise<{ symbols: string[]; weights: Record<string, number> }> {
  const config = INDEX_CONFIG[indexName];
  if (!config) {
    console.error(`[IndexConstituents] Unknown index: ${indexName}`);
    return { symbols: [], weights: {} };
  }

  // 1. Check memory cache
  const memCached = memoryCache.get(indexName);
  if (memCached && (Date.now() - memCached.timestamp) < CACHE_TTL) {
    return { symbols: memCached.symbols, weights: memCached.weights };
  }

  // 2. Check disk cache
  const cacheFile = getCacheFilePath(indexName);
  try {
    const stat = await fs.stat(cacheFile);
    if ((Date.now() - stat.mtimeMs) < CACHE_TTL) {
      const data = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
      if (data.symbols && data.symbols.length > 0) {
        const weights = data.weights || {};
        memoryCache.set(indexName, { symbols: data.symbols, weights, timestamp: Date.now() });
        console.log(`[IndexConstituents] Loaded ${data.symbols.length} constituents for ${indexName} from disk cache`);
        return { symbols: data.symbols, weights };
      }
    }
  } catch {
    // Cache miss
  }

  // 3. Fetch from niftyindices.com
  if (!config.csvUrl) return { symbols: [], weights: {} };
  
  console.log(`[IndexConstituents] Fetching constituents for ${indexName} from ${config.csvUrl}`);
  const csvContent = await fetchCSV(config.csvUrl);
  
  if (csvContent) {
    const { symbols, weights } = parseCSV(csvContent);
    if (symbols.length > 0) {
      // Save to disk cache
      try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify({ symbols, weights, fetchedAt: new Date().toISOString() }));
      } catch (err) {
        console.error('[IndexConstituents] Failed to write cache:', err);
      }
      
      // Save to memory cache
      memoryCache.set(indexName, { symbols, weights, timestamp: Date.now() });
      console.log(`[IndexConstituents] Fetched ${symbols.length} constituents for ${indexName} (${Object.keys(weights).length} with weights)`);
      return { symbols, weights };
    }
  }

  // 4. Try stale disk cache as last resort
  try {
    const data = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
    if (data.symbols && data.symbols.length > 0) {
      const weights = data.weights || {};
      console.log(`[IndexConstituents] Using stale cache for ${indexName}: ${data.symbols.length} symbols`);
      memoryCache.set(indexName, { symbols: data.symbols, weights, timestamp: Date.now() });
      return { symbols: data.symbols, weights };
    }
  } catch {
    // No cache available at all
  }

  console.error(`[IndexConstituents] No data available for ${indexName}`);
  return { symbols: [], weights: {} };
}

/**
 * Get constituent symbols mapped to Upstox instrument keys for an index
 */
export async function getIndexConstituentKeys(indexName: string): Promise<Map<string, string>> {
  const symbols = await getIndexConstituents(indexName);
  if (symbols.length === 0) return new Map();
  
  return getInstrumentKeys(symbols);
}

/**
 * Get all available index names
 */
export function getAvailableIndices(): string[] {
  return Object.keys(INDEX_CONFIG);
}

/**
 * Force refresh constituents for an index (clears cache)
 */
export async function refreshIndexConstituents(indexName: string): Promise<string[]> {
  memoryCache.delete(indexName);
  const cacheFile = getCacheFilePath(indexName);
  try {
    await fs.unlink(cacheFile);
  } catch { /* ignore */ }
  return getIndexConstituents(indexName);
}
