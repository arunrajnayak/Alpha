/**
 * Upstox Instrument Service
 * 
 * Manages the mapping of trading symbols to Upstox Instrument Keys.
 * Uses file-based caching with 7-day TTL (new listings are rare).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { InstrumentData } from './types';

// ============================================================================
// Configuration
// ============================================================================

const NSE_INSTRUMENT_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const CACHE_DIR = '/tmp/upstox-cache';
const NSE_CACHE_FILE = path.join(CACHE_DIR, 'nse_instruments.json');
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days (new listings are rare)

// ============================================================================
// In-Memory Cache
// ============================================================================

let instrumentMap: Map<string, InstrumentData> | null = null;

// ============================================================================
// Index Key Constants
// ============================================================================

/**
 * Index instrument keys - verified from Upstox instrument master
 */
export const INDEX_KEYS: Record<string, string> = {
  // Nifty 50 variations
  'NIFTY 50': 'NSE_INDEX|Nifty 50',
  'NIFTY50': 'NSE_INDEX|Nifty 50',
  'Nifty 50': 'NSE_INDEX|Nifty 50',
  '^NSEI': 'NSE_INDEX|Nifty 50',

  // Nifty Bank
  'NIFTY BANK': 'NSE_INDEX|Nifty Bank',
  'Nifty Bank': 'NSE_INDEX|Nifty Bank',

  // Nifty IT
  'NIFTY IT': 'NSE_INDEX|Nifty IT',
  'Nifty IT': 'NSE_INDEX|Nifty IT',

  // Nifty Next 50
  'NIFTY NEXT 50': 'NSE_INDEX|Nifty Next 50',
  'Nifty Next 50': 'NSE_INDEX|Nifty Next 50',

  // Nifty Midcap 100
  'NIFTY MIDCAP 100': 'NSE_INDEX|NIFTY MIDCAP 100',
  'NIFTY_MIDCAP100': 'NSE_INDEX|NIFTY MIDCAP 100',
  'Nifty Midcap 100': 'NSE_INDEX|NIFTY MIDCAP 100',

  // Nifty Smallcap 250
  'NIFTY SMALLCAP 250': 'NSE_INDEX|NIFTY SMLCAP 250',
  'NIFTY_SMALLCAP250': 'NSE_INDEX|NIFTY SMLCAP 250',
  'NIFTY SMLCAP 250': 'NSE_INDEX|NIFTY SMLCAP 250',
  'Nifty Smallcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',
  'Nifty Smlcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',

  // Nifty Microcap 250
  'NIFTY MICROCAP 250': 'NSE_INDEX|NIFTY MICROCAP250',
  'NIFTY_MICROCAP250': 'NSE_INDEX|NIFTY MICROCAP250',
  'NIFTY MICROCAP250': 'NSE_INDEX|NIFTY MICROCAP250',
  'Nifty Microcap 250': 'NSE_INDEX|NIFTY MICROCAP250',

  // Nifty 500 Momentum 50
  'NIFTY500 MOMENTUM 50': 'NSE_INDEX|Nifty500Momentm50',
  'NIFTY500_MOMENTUM50': 'NSE_INDEX|Nifty500Momentm50',
  'Nifty 500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50',
  'Nifty500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50',
  'Nifty500Momentm50': 'NSE_INDEX|Nifty500Momentm50',
};

// ============================================================================
// Instrument Master Management
// ============================================================================

/**
 * Ensure instrument master is loaded and up-to-date
 * Downloads from Upstox CDN if cache is stale (> 7 days)
 */
export async function ensureInstrumentMaster(): Promise<void> {
  // Already loaded in memory
  if (instrumentMap) return;

  try {
    // Ensure cache directory exists
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Check if cache file exists and is fresh
    let needsUpdate = true;
    try {
      const stats = await fs.stat(NSE_CACHE_FILE);
      const age = Date.now() - stats.mtimeMs;
      needsUpdate = age > CACHE_MAX_AGE;
      
      if (!needsUpdate) {
        console.log(`[Instruments] Using cached instrument master (${Math.round(age / (24 * 60 * 60 * 1000))} days old)`);
      }
    } catch {
      // File doesn't exist
      needsUpdate = true;
    }

    if (needsUpdate) {
      console.log('[Instruments] Downloading fresh NSE instrument master...');
      await downloadInstruments();
    }

    // Load into memory
    await loadInstruments();
  } catch (error) {
    console.error('[Instruments] Failed to ensure instrument master:', error);
    throw error;
  }
}

/**
 * Download and extract instrument master from Upstox CDN
 */
async function downloadInstruments(): Promise<void> {
  const response = await fetch(NSE_INSTRUMENT_URL);
  
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download instruments: ${response.status}`);
  }

  // Download gzipped file
  const gzPath = `${NSE_CACHE_FILE}.gz`;
  const fileStream = createWriteStream(gzPath);
  
  // @ts-expect-error - Node.js stream compatibility
  await pipeline(response.body, fileStream);

  // Decompress using zlib
  const { createGunzip } = await import('zlib');
  const { createReadStream } = await import('fs');
  
  const gunzip = createGunzip();
  const readStream = createReadStream(gzPath);
  const writeStream = createWriteStream(NSE_CACHE_FILE);
  
  await pipeline(readStream, gunzip, writeStream);

  // Clean up gzip file
  await fs.unlink(gzPath);
  
  console.log('[Instruments] Downloaded and extracted instrument master');
}

/**
 * Load instruments from cache file into memory
 */
async function loadInstruments(): Promise<void> {
  const data = await fs.readFile(NSE_CACHE_FILE, 'utf-8');
  const instruments: InstrumentData[] = JSON.parse(data);

  const map = new Map<string, InstrumentData>();

  for (const inst of instruments) {
    // Only include equity instruments
    if (inst.instrument_type === 'EQ' || inst.instrument_type === 'INDEX') {
      // Key by uppercase trading symbol for case-insensitive lookup
      const symbol = inst.trading_symbol.toUpperCase();
      map.set(symbol, inst);

      // Also key by ISIN if available
      if (inst.isin) {
        map.set(inst.isin, inst);
      }
    }
  }

  instrumentMap = map;
  console.log(`[Instruments] Loaded ${map.size} instruments into memory`);
}

// ============================================================================
// Symbol Lookup Functions
// ============================================================================

/**
 * Get instrument key for a symbol
 * @param symbol Trading symbol (e.g., RELIANCE)
 * @returns Instrument key (e.g., NSE_EQ|INE002A01018) or undefined
 */
export async function getInstrumentKey(symbol: string): Promise<string | undefined> {
  // Check index keys first
  const indexKey = INDEX_KEYS[symbol];
  if (indexKey) return indexKey;

  // Ensure master is loaded
  await ensureInstrumentMaster();

  // Clean symbol (remove exchange suffixes, uppercase)
  const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();

  // Direct lookup (O(1))
  const data = instrumentMap?.get(cleanSymbol);
  if (data) return data.instrument_key;

  return undefined;
}

/**
 * Get instrument keys for multiple symbols
 * @param symbols Array of trading symbols
 * @returns Map of symbol -> instrument key
 */
export async function getInstrumentKeys(symbols: string[]): Promise<Map<string, string>> {
  await ensureInstrumentMaster();

  const result = new Map<string, string>();

  for (const symbol of symbols) {
    // Check index keys first
    const indexKey = INDEX_KEYS[symbol];
    if (indexKey) {
      result.set(symbol, indexKey);
      continue;
    }

    // Clean symbol
    const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();

    // Direct lookup
    const data = instrumentMap?.get(cleanSymbol);
    if (data) {
      result.set(symbol, data.instrument_key);
    }
  }

  return result;
}

/**
 * Get instrument key by ISIN
 * @param isin ISIN code (e.g., INE002A01018)
 */
export async function getInstrumentKeyByISIN(isin: string): Promise<string | undefined> {
  await ensureInstrumentMaster();

  const data = instrumentMap?.get(isin.toUpperCase());
  return data?.instrument_key;
}

/**
 * Check if a symbol is valid
 */
export async function isValidSymbol(symbol: string): Promise<boolean> {
  const key = await getInstrumentKey(symbol);
  return key !== undefined;
}

/**
 * Get symbol from instrument key
 * @param instrumentKey e.g., NSE_EQ|INE002A01018
 * @returns Trading symbol or undefined
 */
export async function getSymbolFromKey(instrumentKey: string): Promise<string | undefined> {
  await ensureInstrumentMaster();

  // Check if it's an index key (reverse lookup)
  for (const [symbol, key] of Object.entries(INDEX_KEYS)) {
    if (key === instrumentKey) return symbol;
  }

  // Search through instrument map
  if (instrumentMap) {
    for (const [, data] of instrumentMap.entries()) {
      if (data.instrument_key === instrumentKey) {
        return data.trading_symbol;
      }
    }
  }

  return undefined;
}

/**
 * Get instrument data for a symbol
 */
export async function getInstrumentData(symbol: string): Promise<InstrumentData | undefined> {
  await ensureInstrumentMaster();
  
  const cleanSymbol = symbol.replace(/\.NS$/i, '').toUpperCase();
  return instrumentMap?.get(cleanSymbol);
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear the in-memory instrument cache
 * Next call to getInstrumentKey will reload from file
 */
export function clearInstrumentCache(): void {
  instrumentMap = null;
}

/**
 * Force refresh of instrument master
 * Deletes cache file and redownloads
 */
export async function refreshInstrumentMaster(): Promise<void> {
  instrumentMap = null;
  
  try {
    await fs.unlink(NSE_CACHE_FILE);
  } catch {
    // File doesn't exist, that's fine
  }

  await ensureInstrumentMaster();
}

/**
 * Get all loaded symbols (for debugging)
 */
export async function getAllSymbols(): Promise<string[]> {
  await ensureInstrumentMaster();
  return Array.from(instrumentMap?.keys() || []);
}
