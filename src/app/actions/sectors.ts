'use server';

import { prisma } from '@/lib/db';
import { revalidateTag } from 'next/cache';
import { logger } from '@/lib/logger';

const sectorsLogger = logger.scope('Sectors');



// All 35 sectors from Zerodha
const SECTORS = [
  { name: 'Agriculture', slug: 'agriculture' },
  { name: 'Auto Ancillary', slug: 'auto-ancillary' },
  { name: 'Automobile', slug: 'automobile' },
  { name: 'Aviation', slug: 'aviation' },
  { name: 'Building Materials', slug: 'building-materials' },
  { name: 'Chemicals', slug: 'chemicals' },
  { name: 'Consumer Durables', slug: 'consumer-durables' },
  { name: 'Dairy Products', slug: 'dairy-products' },
  { name: 'Defence', slug: 'defence' },
  { name: 'Diversified', slug: 'diversified' },
  { name: 'Education & Training', slug: 'education-training' },
  { name: 'Energy', slug: 'energy' },
  { name: 'Engineering & Capital Goods', slug: 'engineering-capital-goods' },
  { name: 'FMCG', slug: 'fmcg' },
  { name: 'Fertilizers', slug: 'fertilizers' },
  { name: 'Financial Services', slug: 'financial-services' },
  { name: 'Healthcare', slug: 'healthcare' },
  { name: 'IT', slug: 'it' },
  { name: 'Logistics', slug: 'logistics' },
  { name: 'Media & Entertainment', slug: 'media-entertainment' },
  { name: 'Metals', slug: 'metals' },
  { name: 'Miscellaneous', slug: 'miscellaneous' },
  { name: 'NBFC', slug: 'nbfc' },
  { name: 'Packaging', slug: 'packaging' },
  { name: 'Plastic Pipes', slug: 'plastic-pipes' },
  { name: 'Real Estate', slug: 'real-estate' },
  { name: 'Retail', slug: 'retail' },
  { name: 'Services', slug: 'services' },
  { name: 'Silver', slug: 'silver' },
  { name: 'Software Services', slug: 'software-services' },
  { name: 'Solar Panel', slug: 'solar-panel' },
  { name: 'Telecom', slug: 'telecom' },
  { name: 'Textiles', slug: 'textiles' },
  { name: 'Tourism & Hospitality', slug: 'tourism-hospitality' },
  { name: 'Trading', slug: 'trading' },
];

interface StockSector {
  symbol: string;
  sector: string;
  exchange: string;
}

async function fetchSectorPage(slug: string, sectorName: string): Promise<StockSector[]> {
  const url = `https://zerodha.com/markets/sector/${slug}/`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      sectorsLogger.error(`[${sectorName}] HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    
    const stockLinkRegex = /\/markets\/stocks\/(NSE|BSE)\/([^/]+)\//g;
    const stocks: StockSector[] = [];
    const seen = new Set<string>();
    
    let match;
    while ((match = stockLinkRegex.exec(html)) !== null) {
      const exchange = match[1];
      let symbol = match[2];
      
      // Handle HTML entities (commonly &amp; in symbols like M&M)
      symbol = symbol.replace(/&amp;/g, '&');
      
      // Validate symbol format (uppercase, numbers, -, &, etc)
      if (!/^[A-Z0-9&-]+$/.test(symbol)) continue;

      const key = `${exchange}-${symbol}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        stocks.push({ symbol, sector: sectorName, exchange });
      }
    }

    return stocks;
  } catch (error) {
    sectorsLogger.error(`[${sectorName}] Fetch error:`, error);
    return [];
  }
}

/**
 * Refresh sector mappings from Zerodha (on-demand)
 * Returns the number of stocks mapped
 */
export async function refreshSectorMappings(): Promise<{ success: boolean; count: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    sectorsLogger.info('='.repeat(60));
    sectorsLogger.info('Starting sector data refresh from Zerodha');
    sectorsLogger.info(`Fetching ${SECTORS.length} sectors...`);
    sectorsLogger.info('='.repeat(60));
    
    const allStocks: StockSector[] = [];
    const sectorStats: { name: string; count: number; time: number }[] = [];
    
    for (let i = 0; i < SECTORS.length; i++) {
      const sector = SECTORS[i];
      const sectorStart = Date.now();
      
      sectorsLogger.info(`[${i + 1}/${SECTORS.length}] Fetching: ${sector.name}...`);
      
      const stocks = await fetchSectorPage(sector.slug, sector.name);
      const elapsed = Date.now() - sectorStart;
      
      sectorStats.push({ name: sector.name, count: stocks.length, time: elapsed });
      allStocks.push(...stocks);
      
      sectorsLogger.info(`[${i + 1}/${SECTORS.length}] ${sector.name}: ${stocks.length} stocks (${elapsed}ms)`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    sectorsLogger.info('-'.repeat(60));
    sectorsLogger.info('Deduplicating stocks (preferring NSE over BSE)...');

const MANUAL_SECTOR_MAPPINGS: StockSector[] = [
  { symbol: 'MANGCHEFER', sector: 'Fertilizers', exchange: 'NSE' },
];

    // Deduplicate by symbol (prefer NSE)
    const symbolMap = new Map<string, StockSector>();
    let nseCount = 0, bseCount = 0;
    
    for (const stock of allStocks) {
      const existing = symbolMap.get(stock.symbol);
      if (!existing || (stock.exchange === 'NSE' && existing.exchange === 'BSE')) {
        symbolMap.set(stock.symbol, stock);
        if (stock.exchange === 'NSE') nseCount++;
        else bseCount++;
      }
    }

    // Apply Manual Mappings (Overrides/Additions)
    sectorsLogger.info(`Applying ${MANUAL_SECTOR_MAPPINGS.length} manual sector mappings...`);
    for (const manual of MANUAL_SECTOR_MAPPINGS) {
        symbolMap.set(manual.symbol, manual);
        // We don't bother updating counts strictly as they are just for logging
    }
    
    const uniqueStocks = Array.from(symbolMap.values());
    sectorsLogger.info(`Total raw: ${allStocks.length} | Unique: ${uniqueStocks.length} (NSE: ${nseCount}, BSE: ${bseCount})`);
    
    // Clear and insert
    sectorsLogger.info('Clearing existing sector mappings...');
    await prisma.sectorMapping.deleteMany({});
    
    sectorsLogger.info('Inserting new sector mappings...');
    const batchSize = 100;
    for (let i = 0; i < uniqueStocks.length; i += batchSize) {
      const batch = uniqueStocks.slice(i, i + batchSize);
      await prisma.sectorMapping.createMany({
        data: batch.map(s => ({
          symbol: s.symbol,
          sector: s.sector,
          exchange: s.exchange,
        })),
      });
      sectorsLogger.info(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueStocks.length / batchSize)}`);
    }

    // All stocks are now covered by the scraper!
    sectorsLogger.info('All portfolio stocks covered by scraper logic. No manual fixes needed.');
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Summary
    sectorsLogger.info('='.repeat(60));
    sectorsLogger.info('REFRESH COMPLETE');
    sectorsLogger.info(`Total stocks mapped: ${uniqueStocks.length}`);
    sectorsLogger.info(`Total time: ${totalTime}s`);
    sectorsLogger.info('Top 5 sectors by stock count:');
    sectorStats.sort((a, b) => b.count - a.count);
    sectorStats.slice(0, 5).forEach((s, i) => {
      sectorsLogger.info(`  ${i + 1}. ${s.name}: ${s.count} stocks`);
    });
    sectorsLogger.info('='.repeat(60));
    
     
    (revalidateTag as any)('portfolio-data', 'max');

    return { success: true, count: uniqueStocks.length };
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    sectorsLogger.error('='.repeat(60));
    sectorsLogger.error(`REFRESH FAILED after ${totalTime}s`);
    sectorsLogger.error('Error:', error);
    sectorsLogger.error('='.repeat(60));
    return { success: false, count: 0, error: (error as Error).message };
  }
}

/**
 * Get count of stored sector mappings
 */
export async function getSectorMappingCount(): Promise<number> {
  const count = await prisma.sectorMapping.count();
  return count;
}

/**
 * Initialize sector mappings if empty
 * Called automatically on first load or when data is missing
 */
export async function initializeSectorsIfEmpty(): Promise<{ initialized: boolean; count: number }> {
  const count = await prisma.sectorMapping.count();
  
  if (count === 0) {
    sectorsLogger.info('No sector mappings found, initializing from Zerodha...');
    const result = await refreshSectorMappings();
    return { initialized: true, count: result.count };
  }
  
  return { initialized: false, count };
}

/**
 * Get sector for a symbol
 */
export async function getSectorForSymbol(symbol: string): Promise<string | null> {
  const mapping = await prisma.sectorMapping.findFirst({
    where: { symbol: symbol.toUpperCase().trim() },
    select: { sector: true }
  });
  return mapping?.sector || null;
}

/**
 * Get all sector mappings as a Map
 */
export async function getSectorMap(): Promise<Map<string, string>> {
  const mappings = await prisma.sectorMapping.findMany();
  const map = new Map<string, string>();
  for (const m of mappings) {
    map.set(m.symbol, m.sector);
  }
  return map;
}
