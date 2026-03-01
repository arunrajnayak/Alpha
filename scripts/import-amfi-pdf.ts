import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });

/**
 * Creates a symbol resolver function that maps old symbols to new symbols.
 * Handles mapping chains (e.g., A -> B -> C will resolve A to C).
 */
function createSymbolResolver(mappings: { oldSymbol: string, newSymbol: string }[]): (symbol: string) => string {
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

async function extractTextItemsFromPDF(pdfPath: string): Promise<Array<{ str?: string }>> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await getDocument({ data }).promise;
  
  const allItems: Array<{ str?: string }> = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    allItems.push(...textContent.items as Array<{ str?: string }>);
  }
  
  return allItems;
}

type AMFICategory = 'Large' | 'Mid' | 'Small' | 'Micro';

interface AMFIClassification {
  rank: number;
  companyName: string;
  symbol: string;
  isin: string;
  category: AMFICategory;
  avgMarketCap: number;
}

function getCategoryFromRank(rank: number): AMFICategory {
  if (rank <= 100) return 'Large';
  if (rank <= 250) return 'Mid';
  if (rank <= 500) return 'Small';
  return 'Micro';
}

function parsePDFTextItems(items: Array<{ str?: string }>): AMFIClassification[] {
  const classifications: AMFIClassification[] = [];
  
  // Filter out empty items and get just the strings
  const textItems = items
    .map(item => (item.str || '').trim())
    .filter(s => s.length > 0);
  
  let i = 0;
  
  while (i < textItems.length) {
    const item = textItems[i];
    
    // Look for pattern: "rank CompanyName" (e.g., "1 Reliance Industries Ltd")
    const rankMatch = item.match(/^(\d+)\s+(.+)/);
    
    if (rankMatch) {
      const rank = parseInt(rankMatch[1], 10);
      
      // Valid ranks are 1-6000 (covers all stocks in AMFI list)
      if (rank >= 1 && rank <= 6000) {
        const companyName = rankMatch[2].trim();
        
        // Next items should be: ISIN, BSE Symbol, BSE MCap, NSE Symbol, NSE MCap, Avg MCap, Category
        // Look ahead for ISIN (starts with INE)
        let isin = '';
        let symbol = '';
        let avgMarketCap = 0;
        let category: AMFICategory = getCategoryFromRank(rank);
        
        // Search next 10 items for the data
        for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
          const nextItem = textItems[j];
          
          // ISIN
          if (nextItem.startsWith('INE') && nextItem.length >= 12) {
            isin = nextItem;
          }
          // Symbol (uppercase letters/numbers, no commas - market cap format)
          // Symbols can start with numbers like 3MINDIA, 360ONE, 5PAISA
          else if (/^[A-Z0-9][A-Z0-9&\-]+$/.test(nextItem) && !nextItem.includes(',') && nextItem.length <= 20 && !/^\d+$/.test(nextItem)) {
            if (!symbol) {
              symbol = nextItem; // First symbol is BSE
            } else if (symbol !== nextItem) {
              // Second different symbol is NSE - prefer NSE
              symbol = nextItem;
            }
          }
          // Market cap number (format: XX,XX,XXX.XX)
          else if (/^[\d,]+\.\d+$/.test(nextItem)) {
            avgMarketCap = parseFloat(nextItem.replace(/,/g, ''));
          }
          // Category - use as end marker but derive category from rank
          else if (nextItem === 'Large Cap' || nextItem === 'Mid Cap' || nextItem === 'Small Cap') {
            // Use rank-based classification instead of PDF label
            // This ensures ranks 501+ are classified as Micro
            category = getCategoryFromRank(rank);
            break; // End of this record
          }
          // Check for next rank (means we've gone too far)
          else if (/^\d+\s+[A-Z]/.test(nextItem)) {
            break;
          }
        }
        
        if (symbol && companyName && isin) {
          classifications.push({
            rank,
            companyName,
            symbol: symbol.toUpperCase(),
            isin,
            category,
            avgMarketCap
          });
        }
      }
    }
    
    i++;
  }
  
  // Sort by rank
  classifications.sort((a, b) => a.rank - b.rank);
  
  // Remove duplicates by symbol (keep first/lowest rank occurrence)
  const seenSymbols = new Set<string>();
  const unique: AMFIClassification[] = [];
  for (const c of classifications) {
    if (!seenSymbols.has(c.symbol)) {
      seenSymbols.add(c.symbol);
      unique.push(c);
    }
  }
  
  return unique;
}

async function main() {
  const pdfPath = process.argv[2] || '/Users/arunrajnayak/Downloads/AverageMarketCapitalization30Jun2024.pdf';
  const period = process.argv[3] || '2024_H1';
  
  console.log(`\n=== AMFI PDF Import ===`);
  console.log(`PDF Path: ${pdfPath}`);
  console.log(`Target Period: ${period}`);
  
  // Read PDF and extract text items using pdfjs-dist
  console.log(`\nExtracting text from PDF...`);
  const textItems = await extractTextItemsFromPDF(pdfPath);
  console.log(`Extracted ${textItems.length} text items from PDF`);
  
  console.log(`\nParsing PDF content...`);
  const classifications = parsePDFTextItems(textItems);
  
  console.log(`\nParsed ${classifications.length} classifications:`);
  console.log(`  Large Cap (1-100): ${classifications.filter(c => c.category === 'Large').length}`);
  console.log(`  Mid Cap (101-250): ${classifications.filter(c => c.category === 'Mid').length}`);
  console.log(`  Small Cap (251-500): ${classifications.filter(c => c.category === 'Small').length}`);
  console.log(`  Micro Cap (501+): ${classifications.filter(c => c.category === 'Micro').length}`);
  
  // Show sample data
  console.log('\nSample data (first 10):');
  for (const c of classifications.slice(0, 10)) {
    console.log(`  ${c.rank}. ${c.symbol} - ${c.companyName} (${c.category}, ₹${c.avgMarketCap.toLocaleString()} Cr)`);
  }
  
  console.log('\nSample data (around rank 100-105):');
  for (const c of classifications.filter(c => c.rank >= 100 && c.rank <= 105)) {
    console.log(`  ${c.rank}. ${c.symbol} - ${c.companyName} (${c.category}, ₹${c.avgMarketCap.toLocaleString()} Cr)`);
  }
  
  console.log('\nSample data (around rank 250-255):');
  for (const c of classifications.filter(c => c.rank >= 250 && c.rank <= 255)) {
    console.log(`  ${c.rank}. ${c.symbol} - ${c.companyName} (${c.category}, ₹${c.avgMarketCap.toLocaleString()} Cr)`);
  }
  
  console.log('\nSample data (around rank 500-505):');
  for (const c of classifications.filter(c => c.rank >= 500 && c.rank <= 505)) {
    console.log(`  ${c.rank}. ${c.symbol} - ${c.companyName} (${c.category}, ₹${c.avgMarketCap.toLocaleString()} Cr)`);
  }
  
  // Connect to database (needed for symbol mappings even in dry-run)
  console.log('\nConnecting to database...');
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  
  const prisma = new PrismaClient({ adapter });
  
  try {
    // Fetch symbol mappings to resolve renamed symbols
    console.log('\nFetching symbol mappings...');
    const symbolMappings = await prisma.symbolMapping.findMany();
    console.log(`Found ${symbolMappings.length} symbol mappings`);
    
    // Create resolver function
    const resolveSymbol = createSymbolResolver(symbolMappings);
    
    // Apply symbol mappings to classifications
    let remappedCount = 0;
    const remappedExamples: string[] = [];
    
    for (const c of classifications) {
      const resolvedSymbol = resolveSymbol(c.symbol);
      if (resolvedSymbol !== c.symbol) {
        if (remappedExamples.length < 10) {
          remappedExamples.push(`${c.symbol} → ${resolvedSymbol}`);
        }
        c.symbol = resolvedSymbol;
        remappedCount++;
      }
    }
    
    if (remappedCount > 0) {
      console.log(`\n🔄 Remapped ${remappedCount} symbols using symbol mappings:`);
      for (const ex of remappedExamples) {
        console.log(`   ${ex}`);
      }
      if (remappedCount > 10) {
        console.log(`   ... and ${remappedCount - 10} more`);
      }
    }
    
    // Re-deduplicate after remapping (in case two old symbols map to the same new symbol)
    const symbolMap = new Map<string, typeof classifications[0]>();
    for (const c of classifications) {
      const existing = symbolMap.get(c.symbol);
      // Keep the one with lower rank (higher market cap)
      if (!existing || c.rank < existing.rank) {
        symbolMap.set(c.symbol, c);
      }
    }
    
    const deduplicatedClassifications = Array.from(symbolMap.values());
    if (deduplicatedClassifications.length !== classifications.length) {
      console.log(`\n📊 After remapping deduplication: ${classifications.length} → ${deduplicatedClassifications.length} (removed ${classifications.length - deduplicatedClassifications.length} duplicates)`);
    }
    
    // Replace classifications array with deduplicated version
    classifications.length = 0;
    classifications.push(...deduplicatedClassifications);
    
    // Ask for confirmation before syncing
    if (process.argv.includes('--dry-run')) {
      console.log('\n[DRY RUN] Skipping database sync.');
      await prisma.$disconnect();
      return;
    }
    
    // Check existing data for this period
    const existingCount = await prisma.aMFIClassification.count({
      where: { period }
    });
    
    if (existingCount > 0) {
      console.log(`\n⚠️  Found ${existingCount} existing records for period ${period}`);
      console.log('Deleting existing records...');
      await prisma.aMFIClassification.deleteMany({
        where: { period }
      });
      console.log('Deleted existing records.');
    }
    
    // Insert new classifications using upsert to handle duplicates
    console.log(`\nInserting ${classifications.length} classifications...`);
    
    let processed = 0;
    for (const c of classifications) {
      await prisma.aMFIClassification.upsert({
        where: {
          period_symbol: {
            period,
            symbol: c.symbol
          }
        },
        create: {
          period,
          rank: c.rank,
          companyName: c.companyName,
          symbol: c.symbol,
          isin: c.isin,
          category: c.category,
          avgMarketCap: c.avgMarketCap
        },
        update: {
          rank: c.rank,
          companyName: c.companyName,
          isin: c.isin,
          category: c.category,
          avgMarketCap: c.avgMarketCap
        }
      });
      
      processed++;
      
      if (processed % 100 === 0) {
        process.stdout.write(`\rProcessed ${processed} / ${classifications.length}`);
      }
    }
    
    console.log(`\n\n✓ Successfully processed ${processed} classifications for period ${period}`);
    
    // Verify import
    const finalCount = await prisma.aMFIClassification.count({
      where: { period }
    });
    console.log(`\nVerification: ${finalCount} records in database for period ${period}`);
    
    // Count by category
    const largeCapCount = classifications.filter(c => c.category === 'Large').length;
    const midCapCount = classifications.filter(c => c.category === 'Mid').length;
    const smallCapCount = classifications.filter(c => c.category === 'Small').length;
    const microCapCount = classifications.filter(c => c.category === 'Micro').length;
    
    // Record import history
    const sourceFile = pdfPath.split('/').pop() || pdfPath;
    await prisma.aMFIImportHistory.create({
      data: {
        period,
        sourceFile,
        stockCount: finalCount,
        largeCapCount,
        midCapCount,
        smallCapCount,
        microCapCount
      }
    });
    console.log(`\n📝 Import history recorded for period ${period}`);
    
    // Show all available periods
    const periods = await prisma.aMFIClassification.groupBy({
      by: ['period'],
      _count: { symbol: true },
      orderBy: { period: 'asc' }
    });
    
    console.log('\nAll AMFI periods in database:');
    for (const p of periods) {
      console.log(`  ${p.period}: ${p._count.symbol} stocks`);
    }
    
    // Show import history
    const history = await prisma.aMFIImportHistory.findMany({
      orderBy: { importedAt: 'desc' },
      take: 5
    });
    
    console.log('\nRecent import history:');
    for (const h of history) {
      console.log(`  ${h.period}: ${h.stockCount} stocks from ${h.sourceFile} (${h.importedAt.toISOString().split('T')[0]})`);
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
