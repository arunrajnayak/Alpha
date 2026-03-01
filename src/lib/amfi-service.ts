/**
 * AMFI Market Cap Classification Service
 * 
 * AMFI (Association of Mutual Funds in India) publishes market cap classifications
 * every 6 months. This service downloads and parses the Excel data to classify
 * stocks based on their ranking.
 * 
 * Classification rules:
 * - Large Cap: Top 100 companies by market cap (rank 1-100)
 * - Mid Cap: Companies ranked 101-250
 * - Small Cap: Companies ranked 251-500
 * - Micro Cap: Companies ranked 501 and above
 * 
 * Data source: https://www.amfiindia.com/research-information/other-data/categorization-of-stocks
 */

import * as XLSX from 'xlsx';
import { prisma, chunkArray } from '@/lib/db';

export type AMFICategory = 'Large' | 'Mid' | 'Small' | 'Micro';

// Import MarketCapCategory type from finance for type safety
export type MarketCapCategory = 'Large' | 'Mid' | 'Small' | 'Micro';

/**
 * Map AMFI category to MarketCapCategory
 * AMFI only has Large/Mid/Small, we treat unlisted stocks as 'Micro'
 * Centralized here to avoid duplication across files
 */
export function mapAMFIToMarketCapCategory(amfiCategory: AMFICategory): MarketCapCategory {
    switch (amfiCategory) {
        case 'Large': return 'Large';
        case 'Mid': return 'Mid';
        case 'Small': return 'Small';
        default: return 'Micro';
    }
}

export interface AMFIStockClassification {
    rank: number;
    companyName: string;
    symbol: string;
    isin: string;
    category: AMFICategory;
    avgMarketCap: number; // in Crores
}

/**
 * Returns a function that resolves symbols based on a pre-fetched mapping list.
 * Handles mapping chains (e.g., A -> B -> C will resolve A to C).
 */
export function getSymbolResolver(mappings: { oldSymbol: string, newSymbol: string }[]) {
    const mappingMap = new Map<string, string>();
    for (const m of mappings) {
        mappingMap.set(m.oldSymbol.toUpperCase().trim(), m.newSymbol.toUpperCase().trim());
    }

    return (symbol: string) => {
        let current = symbol.toUpperCase().trim();
        const visited = new Set<string>();
        // Follow the mapping chain until no more mappings or a cycle is detected
        while (mappingMap.has(current) && !visited.has(current)) {
            visited.add(current);
            const next = mappingMap.get(current);
            if (!next) break;
            current = next;
        }
        return current;
    };
}

export interface AMFIPeriod {
    year: number;
    halfYear: 'H1' | 'H2'; // H1 = Jan-Jun, H2 = Jul-Dec
}

// AMFI Excel URL patterns
// Format: https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalizationoflistedcompaniesduringthesixmonthsended{DD}{MMM}{YYYY}.xlsx
// Example: AverageMarketCapitalizationoflistedcompaniesduringthesixmonthsended31Dec2024.xlsx

const AMFI_BASE_URL = 'https://www.amfiindia.com/Themes/Theme1/downloads/';

/**
 * Generate possible AMFI Excel download URLs for a given period
 * AMFI uses different naming conventions for different periods.
 */
export function getAMFIPossibleUrls(period: AMFIPeriod): string[] {
    const { year, halfYear } = period;
    const month = halfYear === 'H1' ? 'Jun' : 'Dec';
    const day = halfYear === 'H1' ? '30' : '31';
    
    return [
        // Pattern 1: Long descriptive name (often used for recent/current files)
        `${AMFI_BASE_URL}AverageMarketCapitalizationoflistedcompaniesduringthesixmonthsended${day}${month}${year}.xlsx`,
        // Pattern 2: Short name (common for older or specific files)
        `${AMFI_BASE_URL}AverageMarketCapitalization${day}${month}${year}.xlsx`
    ];
}

/**
 * Legacy wrapper for backward compatibility
 */
export function getAMFIDownloadUrl(period: AMFIPeriod): string {
    return getAMFIPossibleUrls(period)[0];
}

/**
 * Get the current AMFI period based on date
 * AMFI releases data after each half-year ends
 */
export function getCurrentAMFIPeriod(date: Date = new Date()): AMFIPeriod {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11
    
    // If we're in Jan-Jun, use previous year's H2 data (Jul-Dec)
    // If we're in Jul-Dec, use current year's H1 data (Jan-Jun)
    if (month < 6) {
        return { year: year - 1, halfYear: 'H2' };
    } else {
        return { year, halfYear: 'H1' };
    }
}

/**
 * Determine market cap category based on rank
 */
function getCategoryFromRank(rank: number): AMFICategory {
    if (rank <= 100) return 'Large';
    if (rank <= 250) return 'Mid';
    if (rank <= 500) return 'Small';
    return 'Micro';
}

/**
 * Parse AMFI Excel file and extract stock classifications
 * 
 * AMFI Excel format (as of Dec 2024):
 * - Row 0: Title row (e.g., "Average Market Capitalization of listed companies...")
 * - Row 1: Headers (Sr. No., Company name, ISIN, BSE Symbol, etc.)
 * - Row 2+: Data rows
 * 
 * Headers in real file:
 * - "Sr. No." - Rank by market cap
 * - "Company name" - Company name (note: lowercase 'n')
 * - "ISIN" - ISIN code
 * - "NSE Symbol" - NSE trading symbol
 * - "Average of All Exchanges (Rs. Cr.)" - Average market cap
 * - "Categorization as per SEBI Circular dated Oct 6, 2017" - Category ("Large Cap", "Mid Cap", "Small Cap")
 */
export async function parseAMFIExcel(buffer: ArrayBuffer): Promise<AMFIStockClassification[]> {
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    // AMFI Excel typically has one sheet with the data
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to array format first to skip title row
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { 
        header: 1,
        defval: '',
        raw: false 
    });
    
    if (rawRows.length < 3) {
        console.error('[AMFI] Excel file too short, expected at least 3 rows');
        return [];
    }
    
    // Skip title row (row 0), headers are in row 1
    const headerRow = rawRows[1] as string[];
    const dataRows = rawRows.slice(2);
    
    console.log('[AMFI] Header row:', JSON.stringify(headerRow));
    
    // Create column index map
    const colIndex = new Map<string, number>();
    headerRow.forEach((header, idx) => {
        if (header) colIndex.set(String(header).trim(), idx);
    });
    
    // Helper to get cell value
    const getCell = (row: unknown[], ...possibleHeaders: string[]): string => {
        for (const header of possibleHeaders) {
            const idx = colIndex.get(header);
            if (idx !== undefined && row[idx] !== undefined && row[idx] !== null) {
                return String(row[idx]).trim();
            }
        }
        return '';
    };
    
    const classifications: AMFIStockClassification[] = [];
    
    for (const row of dataRows) {
        const rowArr = row as unknown[];
        
        // Get rank
        const rankStr = getCell(rowArr, 'Sr. No.', 'Rank', 'Sr.No.', 'S.No.', 'S. No.');
        const rank = parseInt(rankStr, 10);
        
        if (isNaN(rank) || rank <= 0) continue;
        
        // Extract company name (note: lowercase 'n' in real file)
        const companyName = getCell(rowArr, 'Company name', 'Company Name', 'Name of the Company', 'Company');
        if (!companyName) continue;
        
        // Extract NSE symbol (preferred), fallback to BSE symbol
        let symbol = getCell(rowArr, 'NSE Symbol', 'NSE Code').toUpperCase();
        
        // Treat "-" as empty (means not listed on that exchange)
        if (symbol === '-') symbol = '';
        
        // If no NSE symbol, try BSE symbol
        if (!symbol) {
            symbol = getCell(rowArr, 'BSE Symbol', 'BSE Code', 'Symbol', 'Scrip Code').toUpperCase();
            if (symbol === '-') symbol = '';
        }
        
        // Extract ISIN
        const isin = getCell(rowArr, 'ISIN', 'ISIN Code', 'ISIN No.').toUpperCase();
        
        // Extract average market cap
        const mcapStr = getCell(rowArr, 
            'Average of All Exchanges (Rs. Cr.)',
            'Average Market Cap (Rs. Cr.)', 
            'Average Market Cap', 
            'Avg. Market Cap',
            'Market Cap',
            'Avg Market Cap (Rs. Cr.)'
        );
        const avgMarketCap = parseFloat(mcapStr.replace(/,/g, '')) || 0;
        
        // Extract SEBI category from file (preferred) or calculate from rank
        const sebiCategory = getCell(rowArr, 
            'Categorization as per SEBI Circular dated Oct 6, 2017',
            'Categorization'
        );
        
        let category: AMFICategory;
        // Stocks ranked above 500 are always Micro Cap (not in SEBI definition)
        if (rank > 500) {
            category = 'Micro';
        } else if (sebiCategory.toLowerCase().includes('large')) {
            category = 'Large';
        } else if (sebiCategory.toLowerCase().includes('mid')) {
            category = 'Mid';
        } else if (sebiCategory.toLowerCase().includes('small')) {
            category = 'Small';
        } else {
            // Fallback to rank-based categorization
            category = getCategoryFromRank(rank);
        }
        
        classifications.push({
            rank,
            companyName,
            symbol,
            isin,
            category,
            avgMarketCap
        });
    }
    
    // Sort by rank to ensure correct ordering
    classifications.sort((a, b) => a.rank - b.rank);
    
    console.log(`[AMFI] Parsed ${classifications.length} stock classifications`);
    console.log(`[AMFI] Large Cap (1-100): ${classifications.filter(c => c.category === 'Large').length}`);
    console.log(`[AMFI] Mid Cap (101-250): ${classifications.filter(c => c.category === 'Mid').length}`);
    console.log(`[AMFI] Small Cap (251-500): ${classifications.filter(c => c.category === 'Small').length}`);
    console.log(`[AMFI] Micro Cap (501+): ${classifications.filter(c => c.category === 'Micro').length}`);
    
    return classifications;
}

/**
 * Download AMFI Excel file for a given period
 * Tries multiple possible URL patterns as AMFI categorization filenames vary.
 */
export async function downloadAMFIData(period: AMFIPeriod): Promise<ArrayBuffer> {
    const urls = getAMFIPossibleUrls(period);
    let lastError: Error | null = null;
    
    for (const url of urls) {
        try {
            console.log(`[AMFI] Attempting download from: ${url}`);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
                }
            });
            
            if (response.ok) {
                console.log(`[AMFI] Download successful from: ${url}`);
                return await response.arrayBuffer();
            }
            
            console.warn(`[AMFI] Download failed from ${url}: ${response.status} ${response.statusText}`);
            lastError = new Error(`Failed to download AMFI data: ${response.status} ${response.statusText}`);
        } catch (error) {
            console.error(`[AMFI] Fetch error for ${url}:`, error);
            lastError = error as Error;
        }
    }
    
    throw lastError || new Error(`Failed to download AMFI data for period ${period.year}_${period.halfYear}`);
}

/**
 * Sync AMFI classifications to database
 * Uses a delete-then-insert approach for better performance with 5000+ records
 */
export async function syncAMFIClassifications(
    classifications: AMFIStockClassification[],
    period: AMFIPeriod
): Promise<{ created: number; updated: number }> {
    const periodStr = `${period.year}_${period.halfYear}`;
    
    // Filter out entries without symbol
    const validClassifications = classifications.filter(c => c.symbol);
    const skippedNoSymbol = classifications.length - validClassifications.length;
    
    console.log(`[AMFI] Total parsed: ${classifications.length}, with symbol: ${validClassifications.length}, skipped (no symbol): ${skippedNoSymbol}`);
    console.log(`[AMFI] Syncing ${validClassifications.length} valid classifications for period ${periodStr}`);
    
    // Delete existing data for this period first, then bulk insert
    const existingCount = await prisma.aMFIClassification.count({
        where: { period: periodStr }
    });
    
    // Delete old data
    await prisma.aMFIClassification.deleteMany({
        where: { period: periodStr }
    });
    
    // Deduplicate by symbol (keep the one with lowest rank / highest market cap)
    const symbolMap = new Map<string, AMFIStockClassification>();
    for (const c of validClassifications) {
        const existing = symbolMap.get(c.symbol);
        if (!existing || c.rank < existing.rank) {
            symbolMap.set(c.symbol, c);
        }
    }
    const dedupedClassifications = Array.from(symbolMap.values());
    
    if (dedupedClassifications.length !== validClassifications.length) {
        console.log(`[AMFI] Deduplicated: ${validClassifications.length} -> ${dedupedClassifications.length} (removed ${validClassifications.length - dedupedClassifications.length} duplicates)`);
    }
    
    // Prepare data for bulk insert
    const insertData = dedupedClassifications.map(c => ({
        period: periodStr,
        rank: c.rank,
        companyName: c.companyName,
        symbol: c.symbol,
        isin: c.isin,
        category: c.category,
        avgMarketCap: c.avgMarketCap
    }));
    
    // Bulk insert in batches of 500 to avoid issues
    const BATCH_SIZE = 500;
    let insertedCount = 0;
    
    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
        const batch = insertData.slice(i, i + BATCH_SIZE);
        await prisma.aMFIClassification.createMany({
            data: batch
        });
        insertedCount += batch.length;
        console.log(`[AMFI] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}, total: ${insertedCount}/${insertData.length}`);
    }
    
    console.log(`[AMFI] Sync complete: ${insertedCount} created (replaced ${existingCount} existing)`);
    return { created: insertedCount, updated: existingCount > 0 ? existingCount : 0 };
}

/**
 * Get market cap category for a single symbol
 * Falls back to 'Small' if not found (conservative assumption)
 * Optionally takes a reference date to use the correct historical period
 */
export async function getAMFICategory(symbol: string, referenceDate?: Date): Promise<AMFICategory> {
    const normalizedSymbol = symbol.toUpperCase().trim();
    
    // Determine target period
    const targetPeriod = getCurrentAMFIPeriod(referenceDate);
    const targetPeriodStr = `${targetPeriod.year}_${targetPeriod.halfYear}`;

    // 1. Try exact match for the target period
    let classification = await prisma.aMFIClassification.findFirst({
        where: { symbol: normalizedSymbol, period: targetPeriodStr },
    });
    
    // If not found in target period, try latest available
    if (!classification) {
        classification = await prisma.aMFIClassification.findFirst({
            where: { symbol: normalizedSymbol },
            orderBy: { period: 'desc' }
        });
    }
    
    if (classification) {
        return classification.category as AMFICategory;
    }
    
    // 2. Try mapped symbols
    const mapping = await prisma.symbolMapping.findFirst({
        where: {
            OR: [
                { oldSymbol: normalizedSymbol },
                { newSymbol: normalizedSymbol }
            ]
        }
    });

    if (mapping) {
        const otherSymbol = mapping.oldSymbol === normalizedSymbol ? mapping.newSymbol : mapping.oldSymbol;
        
        // Try mapped in target period
        let mappedClassification = await prisma.aMFIClassification.findFirst({
            where: { symbol: otherSymbol, period: targetPeriodStr },
        });

        // Fallback to latest mapped
        if (!mappedClassification) {
            mappedClassification = await prisma.aMFIClassification.findFirst({
                where: { symbol: otherSymbol },
                orderBy: { period: 'desc' }
            });
        }

        if (mappedClassification) {
            return mappedClassification.category as AMFICategory;
        }
    }
    
    // If not found by symbol or mapping, this is likely a small cap or unlisted stock
    return 'Small';
}

/**
 * Get market cap categories for multiple symbols in batch
 * Handles symbol normalization for portfolio symbols
 * 
 * @param symbols - Array of stock symbols to look up
 * @param referenceDate - Optional date to determine which AMFI period to use.
 *                        If not provided, uses the latest available period.
 */
export async function getAMFICategoriesBatch(
    symbols: string[], 
    referenceDate?: Date
): Promise<Map<string, AMFICategory>> {
    const result = new Map<string, AMFICategory>();
    
    if (symbols.length === 0) return result;
    
    // Create mapping: original symbol -> AMFI lookup symbol (stripped, uppercase)
    const originalToLookup = new Map<string, string>();
    const lookupSymbolsSet = new Set<string>();
    
    for (const s of symbols) {
        // Strip exchange suffixes and convert to uppercase for AMFI lookup
        const lookup = s.replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
        originalToLookup.set(s, lookup);
        lookupSymbolsSet.add(lookup);
    }
    
    const lookupSymbols = Array.from(lookupSymbolsSet);
    
    // Pre-fetch symbol mappings for all lookup symbols (batched to avoid SQLite expression tree limit)
    const symbolChunks = chunkArray(lookupSymbols);
    const mappingsArrays = await Promise.all(
        symbolChunks.map(chunk =>
            prisma.symbolMapping.findMany({
                where: {
                    OR: [
                        { oldSymbol: { in: chunk } },
                        { newSymbol: { in: chunk } }
                    ]
                }
            })
        )
    );
    const mappings = mappingsArrays.flat();

    // Expand lookup symbols with mapped counterparts
    const expandedLookupSymbols = new Set(lookupSymbols);
    const lookupToMapped = new Map<string, string[]>();

    for (const m of mappings) {
        const oldSym = m.oldSymbol.toUpperCase();
        const newSym = m.newSymbol.toUpperCase();
        
        expandedLookupSymbols.add(oldSym);
        expandedLookupSymbols.add(newSym);

        if (lookupSymbolsSet.has(oldSym)) {
            if (!lookupToMapped.has(oldSym)) lookupToMapped.set(oldSym, []);
            lookupToMapped.get(oldSym)!.push(newSym);
        }
        if (lookupSymbolsSet.has(newSym)) {
            if (!lookupToMapped.has(newSym)) lookupToMapped.set(newSym, []);
            lookupToMapped.get(newSym)!.push(oldSym);
        }
    }
    
    // Determine which AMFI period to use
    let targetPeriodStr: string;
    
    if (referenceDate) {
        // Use the period appropriate for the reference date
        const targetPeriod = getCurrentAMFIPeriod(referenceDate);
        targetPeriodStr = `${targetPeriod.year}_${targetPeriod.halfYear}`;
    } else {
        // Fall back to latest available period
        const latestPeriod = await prisma.aMFIClassification.findFirst({
            orderBy: { period: 'desc' },
            select: { period: true }
        });
        
        if (!latestPeriod) {
            // No AMFI data, return all as Micro (unknown stocks are assumed micro cap)
            console.warn('[AMFI] No AMFI data found in database - all stocks will be classified as Micro');
            for (const symbol of symbols) {
                result.set(symbol, 'Micro');
            }
            return result;
        }
        targetPeriodStr = latestPeriod.period;
    }
    
    // Check if the target period exists in the database
    const periodExists = await prisma.aMFIClassification.findFirst({
        where: { period: targetPeriodStr },
        select: { period: true }
    });
    
    // If target period doesn't exist, try to find the closest available period
    let actualPeriodStr = targetPeriodStr;
    if (!periodExists) {
        const availablePeriods = await prisma.aMFIClassification.findMany({
            distinct: ['period'],
            select: { period: true },
            orderBy: { period: 'desc' }
        });
        
        if (availablePeriods.length === 0) {
            console.warn('[AMFI] No AMFI data found in database - all stocks will be classified as Micro');
            for (const symbol of symbols) {
                result.set(symbol, 'Micro');
            }
            return result;
        }
        
        // Use the latest available period as fallback
        actualPeriodStr = availablePeriods[0].period;
        console.warn(`[AMFI] Period ${targetPeriodStr} not found, falling back to ${actualPeriodStr}`);
    }
    
    // Fetch classifications for all expanded symbols (batched to avoid SQLite expression tree limit)
    const expandedSymbolsArray = Array.from(expandedLookupSymbols);
    const expandedChunks = chunkArray(expandedSymbolsArray);
    const classificationsArrays = await Promise.all(
        expandedChunks.map(chunk =>
            prisma.aMFIClassification.findMany({
                where: {
                    period: actualPeriodStr,
                    symbol: { in: chunk }
                }
            })
        )
    );
    const classifications = classificationsArrays.flat();
    
    // Create lookup map: AMFI symbol -> category
    const amfiMap = new Map<string, AMFICategory>();
    for (const c of classifications) {
        amfiMap.set(c.symbol.toUpperCase(), c.category as AMFICategory);
    }
    
    // Track unmatched symbols for debugging
    const unmatchedSymbols: string[] = [];
    
    // Map back to original symbols
    for (const [originalSymbol, lookupSymbol] of originalToLookup.entries()) {
        // 1. Try direct match
        let category = amfiMap.get(lookupSymbol);
        
        // 2. Try mapped symbols if not found
        if (!category) {
            const mappedSymbols = lookupToMapped.get(lookupSymbol) || [];
            for (const ms of mappedSymbols) {
                category = amfiMap.get(ms);
                if (category) break;
            }
        }

        // Default to 'Micro' for stocks not in AMFI data
        // Rationale: AMFI only lists top 500 stocks by market cap (Large: 1-100, Mid: 101-250, Small: 251-500)
        // Any stock not in the list is by definition smaller than rank 500, hence Micro cap
        if (!category) {
            unmatchedSymbols.push(originalSymbol);
        }
        result.set(originalSymbol, category || 'Micro');
    }
    
    // Debug logging
    console.log(`[AMFI] Batch lookup (period: ${actualPeriodStr}): ${classifications.length} matches found for ${symbols.length} symbols`);
    if (unmatchedSymbols.length > 0) {
        console.log(`[AMFI] Unmatched symbols (defaulting to Micro): ${unmatchedSymbols.join(', ')}`);
    }
    
    return result;
}

/**
 * Get all AMFI classifications for a period
 */
export async function getAMFIClassifications(period?: AMFIPeriod): Promise<AMFIStockClassification[]> {
    let periodStr: string | undefined;
    
    if (period) {
        periodStr = `${period.year}_${period.halfYear}`;
    } else {
        // Get latest period
        const latest = await prisma.aMFIClassification.findFirst({
            orderBy: { period: 'desc' },
            select: { period: true }
        });
        periodStr = latest?.period;
    }
    
    if (!periodStr) return [];
    
    const classifications = await prisma.aMFIClassification.findMany({
        where: { period: periodStr },
        orderBy: { rank: 'asc' }
    });
    
    return classifications.map(c => ({
        rank: c.rank,
        companyName: c.companyName,
        symbol: c.symbol,
        isin: c.isin,
        category: c.category as AMFICategory,
        avgMarketCap: c.avgMarketCap
    }));
}

/**
 * Check if AMFI data exists for a period
 */
export async function hasAMFIData(period?: AMFIPeriod): Promise<boolean> {
    if (period) {
        const periodStr = `${period.year}_${period.halfYear}`;
        const count = await prisma.aMFIClassification.count({
            where: { period: periodStr }
        });
        return count > 0;
    }
    
    const count = await prisma.aMFIClassification.count();
    return count > 0;
}

/**
 * Get available AMFI periods in database
 */
export async function getAvailableAMFIPeriods(): Promise<string[]> {
    const periods = await prisma.aMFIClassification.findMany({
        distinct: ['period'],
        select: { period: true },
        orderBy: { period: 'desc' }
    });
    
    return periods.map(p => p.period);
}

/**
 * Full sync: Download and store AMFI data for a period
 */
export async function fullAMFISync(period?: AMFIPeriod): Promise<{
    period: string;
    created: number;
    updated: number;
    total: number;
}> {
    const targetPeriod = period || getCurrentAMFIPeriod();
    const periodStr = `${targetPeriod.year}_${targetPeriod.halfYear}`;
    
    console.log(`[AMFI] Starting full sync for period: ${periodStr}`);
    
    // Download Excel
    const buffer = await downloadAMFIData(targetPeriod);
    
    // Parse Excel
    const classifications = await parseAMFIExcel(buffer);
    
    if (classifications.length === 0) {
        throw new Error('No classifications parsed from AMFI Excel');
    }
    
    // Sync to database
    const { created, updated } = await syncAMFIClassifications(classifications, targetPeriod);
    
    return {
        period: periodStr,
        created,
        updated,
        total: classifications.length
    };
}
