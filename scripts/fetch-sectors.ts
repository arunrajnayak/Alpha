/**
 * Fetch sector mappings from Zerodha sector pages
 * Run with: npx tsx scripts/fetch-sectors.ts
 */

import { prisma } from '../src/lib/db';

// All 34 sectors from Zerodha
const SECTORS = [
  { name: 'Agriculture', slug: 'agriculture' },
  { name: 'Auto Ancillary', slug: 'auto-ancillary' },
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
      console.error(`[${sectorName}] HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    
    // Extract stock links: /markets/stocks/NSE/SYMBOL/ or /markets/stocks/BSE/SYMBOL/
    const stockLinkRegex = /\/markets\/stocks\/(NSE|BSE)\/([A-Z0-9&-]+)\//g;
    const stocks: StockSector[] = [];
    const seen = new Set<string>();
    
    let match;
    while ((match = stockLinkRegex.exec(html)) !== null) {
      const exchange = match[1];
      const symbol = match[2];
      const key = `${exchange}-${symbol}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        stocks.push({ symbol, sector: sectorName, exchange });
      }
    }

    return stocks;
  } catch (error) {
    console.error(`[${sectorName}] Fetch error:`, error);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting sector mapping fetch from Zerodha...\n');
  
  const allStocks: StockSector[] = [];
  
  for (const sector of SECTORS) {
    process.stdout.write(`📊 Fetching ${sector.name}... `);
    const stocks = await fetchSectorPage(sector.slug, sector.name);
    console.log(`${stocks.length} stocks`);
    allStocks.push(...stocks);
    
    // Rate limiting - be polite to Zerodha servers
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n📈 Total stocks found: ${allStocks.length}`);
  
  // Deduplicate by symbol (prefer NSE over BSE)
  const symbolMap = new Map<string, StockSector>();
  for (const stock of allStocks) {
    const existing = symbolMap.get(stock.symbol);
    if (!existing || (stock.exchange === 'NSE' && existing.exchange === 'BSE')) {
      symbolMap.set(stock.symbol, stock);
    }
  }
  
  const uniqueStocks = Array.from(symbolMap.values());
  console.log(`📊 Unique symbols: ${uniqueStocks.length}\n`);
  
  // Clear existing mappings and insert new ones
  console.log('🗑️  Clearing existing sector mappings...');
  await prisma.sectorMapping.deleteMany({});
  
  console.log('💾 Inserting new sector mappings...');
  const batchSize = 100;
  let inserted = 0;
  
  for (let i = 0; i < uniqueStocks.length; i += batchSize) {
    const batch = uniqueStocks.slice(i, i + batchSize);
    await prisma.sectorMapping.createMany({
      data: batch.map(s => ({
        symbol: s.symbol,
        sector: s.sector,
        exchange: s.exchange,
      })),
    });
    inserted += batch.length;
    process.stdout.write(`\r   Inserted ${inserted}/${uniqueStocks.length}`);
  }
  
  console.log('\n\n✅ Sector mapping complete!');
  
  // Print summary by sector
  const sectorCounts = await prisma.sectorMapping.groupBy({
    by: ['sector'],
    _count: { symbol: true },
    orderBy: { _count: { symbol: 'desc' } },
  });
  
  console.log('\n📊 Sector Summary:');
  console.log('─'.repeat(40));
  for (const { sector, _count } of sectorCounts) {
    console.log(`  ${sector.padEnd(28)} ${_count.symbol} stocks`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
