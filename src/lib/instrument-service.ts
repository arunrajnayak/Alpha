/**
 * Instrument Service
 * Manages the mapping of trading symbols (e.g. RELIANCE) to Upstox Instrument Keys (e.g. NSE_EQ|INE002A01018).
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';

const NSE_INSTRUMENT_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const BSE_INSTRUMENT_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz';
const CACHE_DIR = path.join(os.tmpdir(), 'alpha_cache');
const NSE_CACHE_FILE = path.join(CACHE_DIR, 'nse_instruments.json');
const BSE_CACHE_FILE = path.join(CACHE_DIR, 'bse_instruments.json');

// Mutex to prevent concurrent downloads causing race conditions
let downloadLock: Promise<void> | null = null;

interface UpstoxInstrument {
    instrument_key: string;
    exchange_token: string;
    tradingsymbol: string;
    trading_symbol?: string; // Alternative field name
    name: string;
    isin?: string;
    last_price: number;
    strike_price: number;
    tick_size: number;
    lot_size: number;
    instrument_type: string;
    freeze_quantity: number;
    exchange: string;
    segment?: string;
    short_name?: string;
}

interface InstrumentData {
    key: string;
    isin?: string;
    name: string;
    exchange: string;
}

// In-memory caches
let nseInstrumentMap: Map<string, InstrumentData> | null = null; // Symbol -> InstrumentData
let bseInstrumentMap: Map<string, InstrumentData> | null = null;
let isinToKeyMap: Map<string, string> | null = null; // ISIN -> InstrumentKey
let keyToSymbolMap: Map<string, string> | null = null; // InstrumentKey -> Symbol

// Index instrument keys (hardcoded for reliability)
// These are the EXACT keys from Upstox instrument master - case sensitive!
// Verified from: https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
export const INDEX_INSTRUMENT_KEYS: Record<string, string> = {
    // Nifty 50 variants
    'NIFTY 50': 'NSE_INDEX|Nifty 50',
    'NIFTY50': 'NSE_INDEX|Nifty 50',
    'Nifty 50': 'NSE_INDEX|Nifty 50',
    '^NSEI': 'NSE_INDEX|Nifty 50', // Yahoo-style symbol
    
    // Nifty Bank
    'NIFTY BANK': 'NSE_INDEX|Nifty Bank',
    'Nifty Bank': 'NSE_INDEX|Nifty Bank',
    
    // Nifty IT
    'NIFTY IT': 'NSE_INDEX|Nifty IT',
    'Nifty IT': 'NSE_INDEX|Nifty IT',
    
    // Nifty Next 50
    'NIFTY NEXT 50': 'NSE_INDEX|Nifty Next 50',
    'Nifty Next 50': 'NSE_INDEX|Nifty Next 50',
    
    // Nifty Midcap 100 - UPPERCASE in Upstox
    'NIFTY MIDCAP 100': 'NSE_INDEX|NIFTY MIDCAP 100',
    'NIFTY_MIDCAP100': 'NSE_INDEX|NIFTY MIDCAP 100',
    'Nifty Midcap 100': 'NSE_INDEX|NIFTY MIDCAP 100',
    
    // Nifty Smallcap 250 - UPPERCASE, SMLCAP not SMALLCAP
    'NIFTY SMALLCAP 250': 'NSE_INDEX|NIFTY SMLCAP 250',
    'NIFTY_SMALLCAP250': 'NSE_INDEX|NIFTY SMLCAP 250',
    'NIFTY SMLCAP 250': 'NSE_INDEX|NIFTY SMLCAP 250',
    'Nifty Smallcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',
    'Nifty Smlcap 250': 'NSE_INDEX|NIFTY SMLCAP 250',
    
    // Nifty Microcap 250 - UPPERCASE, no space before 250
    'NIFTY MICROCAP 250': 'NSE_INDEX|NIFTY MICROCAP250',
    'NIFTY_MICROCAP250': 'NSE_INDEX|NIFTY MICROCAP250',
    'NIFTY MICROCAP250': 'NSE_INDEX|NIFTY MICROCAP250',
    'Nifty Microcap 250': 'NSE_INDEX|NIFTY MICROCAP250',
    
    // Nifty 500 Momentum 50 - No spaces, Momentm (truncated)
    'NIFTY500 MOMENTUM 50': 'NSE_INDEX|Nifty500Momentm50',
    'NIFTY500_MOMENTUM50': 'NSE_INDEX|Nifty500Momentm50',
    'Nifty 500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50',
    'Nifty500 Momentum 50': 'NSE_INDEX|Nifty500Momentm50',
    'Nifty500Momentm50': 'NSE_INDEX|Nifty500Momentm50',
};

/**
 * Ensure instrument master files are downloaded and loaded
 * Uses a mutex to prevent concurrent downloads causing race conditions
 */
export async function ensureInstrumentMaster(includeBSE: boolean = false) {
    // If a download is already in progress, wait for it to complete
    if (downloadLock) {
        await downloadLock;
        // After waiting, check if we still need to load (another caller may have loaded it)
        if (nseInstrumentMap && (!includeBSE || bseInstrumentMap)) {
            return;
        }
    }

    // Check if already loaded in memory (fast path - no async needed)
    if (nseInstrumentMap && (!includeBSE || bseInstrumentMap)) {
        return;
    }

    // Acquire lock for download/load operations
    let releaseLock: () => void;
    downloadLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    try {
        // 1. Ensure Cache Directory
        try {
            await fs.access(CACHE_DIR);
        } catch {
            await fs.mkdir(CACHE_DIR, { recursive: true });
        }

        // 2. Check if NSE file exists and is fresh (< 24 hours old)
        let nseNeedsUpdate = true;
        try {
            const stats = await fs.stat(NSE_CACHE_FILE);
            const age = Date.now() - stats.mtimeMs;
            if (age < 24 * 60 * 60 * 1000) {
                nseNeedsUpdate = false;
            }
        } catch {
            // File doesn't exist
        }

        if (nseNeedsUpdate) {
            console.log('[InstrumentService] Downloading fresh NSE instrument master...');
            await downloadAndExtractInstruments(NSE_INSTRUMENT_URL, NSE_CACHE_FILE);
        }

        // 3. Load NSE into memory if not loaded
        if (!nseInstrumentMap) {
            await loadInstruments('NSE');
        }

        // 4. Optionally load BSE
        if (includeBSE && !bseInstrumentMap) {
            let bseNeedsUpdate = true;
            try {
                const stats = await fs.stat(BSE_CACHE_FILE);
                const age = Date.now() - stats.mtimeMs;
                if (age < 24 * 60 * 60 * 1000) {
                    bseNeedsUpdate = false;
                }
            } catch {
                // File doesn't exist
            }

            if (bseNeedsUpdate) {
                console.log('[InstrumentService] Downloading fresh BSE instrument master...');
                await downloadAndExtractInstruments(BSE_INSTRUMENT_URL, BSE_CACHE_FILE);
            }

            await loadInstruments('BSE');
        }
    } finally {
        // Release lock
        downloadLock = null;
        releaseLock!();
    }
}

async function downloadAndExtractInstruments(url: string, cacheFile: string) {
    // Use unique temp files to avoid conflicts with any stale files
    const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const gzPath = `${cacheFile}.${uniqueId}.gz`;
    const tempPath = `${cacheFile}.${uniqueId}.tmp`;
    
    try {
        // Download to temp gz file
        const response = await fetch(url);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download instrument master from ${url}`);
        }
        
        const fileStream = createWriteStream(gzPath);
        // @ts-expect-error - native fetch body is readable stream
        await pipeline(response.body, fileStream);

        // Extract to temp json file (atomic: write to temp, then rename)
        const gunzip = createGunzip();
        const source = createReadStream(gzPath);
        const destination = createWriteStream(tempPath);
        
        await pipeline(source, gunzip, destination);
        
        // Atomic rename to final destination
        await fs.rename(tempPath, cacheFile);
    } finally {
        // Cleanup temp files (ignore errors if they don't exist)
        try { await fs.unlink(gzPath); } catch { /* ignore */ }
        try { await fs.unlink(tempPath); } catch { /* ignore */ }
    }
}

async function loadInstruments(exchange: 'NSE' | 'BSE') {
    const cacheFile = exchange === 'NSE' ? NSE_CACHE_FILE : BSE_CACHE_FILE;
    const map = new Map<string, InstrumentData>();
    
    console.log(`[InstrumentService] Loading ${exchange} instruments into memory...`);
    
    try {
        const data = await fs.readFile(cacheFile, 'utf-8');
        const instruments: UpstoxInstrument[] = JSON.parse(data);
        
        // Initialize reverse lookup maps if not done
        if (!isinToKeyMap) isinToKeyMap = new Map();
        if (!keyToSymbolMap) keyToSymbolMap = new Map();
        
        for (const instr of instruments) {
            const rawSymbol = instr.tradingsymbol || instr.trading_symbol;
            if (!rawSymbol) continue;
            
            // Uppercase symbol for consistent lookup (enables O(1) case-insensitive search)
            const symbol = rawSymbol.toUpperCase();
            
            // Only include EQUITY and INDEX types
            const type = instr.instrument_type?.toUpperCase();
            if (type !== 'EQ' && type !== 'EQUITY' && type !== 'INDEX') continue;
            
            const instrData: InstrumentData = {
                key: instr.instrument_key,
                isin: instr.isin,
                name: instr.name || instr.short_name || symbol,
                exchange,
            };
            
            map.set(symbol, instrData);
            
            // Build reverse lookup maps
            if (instr.isin) {
                isinToKeyMap.set(instr.isin, instr.instrument_key);
            }
            keyToSymbolMap.set(instr.instrument_key, symbol);
        }
        
        if (exchange === 'NSE') {
            nseInstrumentMap = map;
        } else {
            bseInstrumentMap = map;
        }
        
        console.log(`[InstrumentService] Loaded ${map.size} ${exchange} instruments.`);
    } catch (error) {
        console.error(`[InstrumentService] Failed to load ${exchange} instruments:`, error);
        // Do NOT assign global map, allowing retry on next call
    }
}

/**
 * Get instrument key for a single symbol
 */
export async function getInstrumentKey(symbol: string): Promise<string | undefined> {
    await ensureInstrumentMaster();
    
    // Check index keys first
    const indexKey = INDEX_INSTRUMENT_KEYS[symbol] || INDEX_INSTRUMENT_KEYS[symbol.toUpperCase()];
    if (indexKey) return indexKey;
    
    // Clean symbol (remove exchange suffixes) and uppercase
    // Note: Map keys are already uppercase from loadInstruments(), so direct lookup is case-insensitive
    const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
    
    // Try NSE first (O(1) lookup - map keys are uppercase)
    let data = nseInstrumentMap?.get(cleanSymbol);
    if (data) return data.key;
    
    // Try BSE fallback
    if (bseInstrumentMap) {
        data = bseInstrumentMap.get(cleanSymbol);
        if (data) return data.key;
    }
    
    return undefined;
}

/**
 * Get instrument keys for multiple symbols (batch lookup)
 * Optimized: performs lookups synchronously after ensuring master is loaded
 */
export async function getInstrumentKeys(symbols: string[]): Promise<Map<string, string>> {
    await ensureInstrumentMaster();
    
    const result = new Map<string, string>();
    
    // Perform lookups synchronously since data is already in memory
    for (const symbol of symbols) {
        // Check index keys first
        const indexKey = INDEX_INSTRUMENT_KEYS[symbol] || INDEX_INSTRUMENT_KEYS[symbol.toUpperCase()];
        if (indexKey) {
            result.set(symbol, indexKey);
            continue;
        }
        
        // Clean symbol (remove exchange suffixes)
        const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
        
        // Try NSE first (direct lookup - O(1))
        let data = nseInstrumentMap?.get(cleanSymbol);
        if (data) {
            result.set(symbol, data.key);
            continue;
        }
        
        // Try BSE fallback
        if (bseInstrumentMap) {
            data = bseInstrumentMap.get(cleanSymbol);
            if (data) {
                result.set(symbol, data.key);
            }
        }
    }
    
    return result;
}

/**
 * Get instrument key by ISIN
 */
export async function getInstrumentKeyByISIN(isin: string): Promise<string | undefined> {
    await ensureInstrumentMaster();
    return isinToKeyMap?.get(isin);
}

/**
 * Get trading symbol from instrument key
 */
export async function getSymbolFromKey(key: string): Promise<string | undefined> {
    await ensureInstrumentMaster();
    return keyToSymbolMap?.get(key);
}

/**
 * Get full instrument data for a symbol
 */
export async function getInstrumentData(symbol: string): Promise<InstrumentData | undefined> {
    await ensureInstrumentMaster();
    
    const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
    
    // Try NSE first
    let data = nseInstrumentMap?.get(cleanSymbol);
    if (data) return data;
    
    // Case-insensitive search
    if (nseInstrumentMap) {
        for (const [sym, instrData] of nseInstrumentMap.entries()) {
            if (sym.toUpperCase() === cleanSymbol) {
                return instrData;
            }
        }
    }
    
    // Try BSE
    if (bseInstrumentMap) {
        data = bseInstrumentMap.get(cleanSymbol);
        if (data) return data;
    }
    
    return undefined;
}

/**
 * Check if a symbol exists in the instrument master
 */
export async function isValidSymbol(symbol: string): Promise<boolean> {
    const key = await getInstrumentKey(symbol);
    return key !== undefined;
}

/**
 * Get all loaded symbols (for debugging)
 */
export async function getAllSymbols(): Promise<string[]> {
    await ensureInstrumentMaster();
    return Array.from(nseInstrumentMap?.keys() || []);
}

/**
 * Force refresh of instrument master
 */
export async function refreshInstrumentMaster(): Promise<void> {
    // Clear caches
    nseInstrumentMap = null;
    bseInstrumentMap = null;
    isinToKeyMap = null;
    keyToSymbolMap = null;
    
    // Delete cache files
    try {
        await fs.unlink(NSE_CACHE_FILE);
    } catch { /* ignore */ }
    try {
        await fs.unlink(BSE_CACHE_FILE);
    } catch { /* ignore */ }
    
    // Re-download and load
    await ensureInstrumentMaster(true);
}
