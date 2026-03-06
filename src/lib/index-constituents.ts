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
import { getInstrumentKeys } from './instrument-service';

// ============================================================================
// Configuration
// ============================================================================

const CACHE_DIR = path.join(os.tmpdir(), 'alpha_cache', 'index_constituents');
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days — constituents rebalance quarterly/semi-annually

/**
 * Index definitions with their CSV download URLs and Upstox index instrument keys
 */
export type IndexCategory = 'broad' | 'momentum' | 'sectoral';

export const INDEX_CONFIG: Record<string, { csvUrl: string; upstoxKey: string; shortName: string; category: IndexCategory }> = {
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
    csvUrl: 'https://www.niftyindices.com/IndexConstituent/ind_niftymicrocap250list.csv',
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

    return await response.text();
  } catch (error) {
    console.error(`[IndexConstituents] CSV fetch error for ${url}:`, error);
    return null;
  }
}

/**
 * Get constituent symbols for an index.
 * Uses multi-layer caching: memory → disk → fetch from niftyindices.com
 */
export async function getIndexConstituents(indexName: string): Promise<string[]> {
  const result = await getIndexConstituentData(indexName);
  return result.symbols;
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
