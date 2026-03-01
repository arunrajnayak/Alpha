/**
 * Script to sync AMFI market cap classification data
 * 
 * Usage:
 *   npx tsx scripts/sync-amfi.ts                    # Sync current period
 *   npx tsx scripts/sync-amfi.ts 2024 H2            # Sync specific period
 *   npx tsx scripts/sync-amfi.ts --status           # Check current status
 *   npx tsx scripts/sync-amfi.ts --file path.xlsx   # Sync from local file
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Prisma with production database
const prisma = new PrismaClient();

type AMFICategory = 'Large' | 'Mid' | 'Small' | 'Micro';

interface AMFIStockClassification {
    rank: number;
    companyName: string;
    symbol: string;
    isin: string;
    category: AMFICategory;
    avgMarketCap: number;
}

interface AMFIPeriod {
    year: number;
    halfYear: 'H1' | 'H2';
}

const AMFI_BASE_URL = 'https://www.amfiindia.com/Themes/Theme1/downloads/';

function getAMFIDownloadUrl(period: AMFIPeriod): string {
    const { year, halfYear } = period;
    const month = halfYear === 'H1' ? 'Jun' : 'Dec';
    const day = halfYear === 'H1' ? '30' : '31';
    
    return `${AMFI_BASE_URL}AverageMarketCapitalizationoflistedcompaniesduringthesixmonthsended${day}${month}${year}.xlsx`;
}

function getCurrentAMFIPeriod(date: Date = new Date()): AMFIPeriod {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    if (month < 6) {
        return { year: year - 1, halfYear: 'H2' };
    } else {
        return { year, halfYear: 'H1' };
    }
}

function getCategoryFromRank(rank: number): AMFICategory {
    if (rank <= 100) return 'Large';
    if (rank <= 250) return 'Mid';
    if (rank <= 500) return 'Small';
    return 'Micro';
}

async function parseAMFIExcel(buffer: ArrayBuffer): Promise<AMFIStockClassification[]> {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { 
        defval: '',
        raw: false 
    });
    
    const classifications: AMFIStockClassification[] = [];
    
    for (const row of rawData) {
        const rankValue = row['Sr. No.'] || row['Rank'] || row['Sr.No.'] || row['S.No.'] || row['S. No.'];
        const rank = parseInt(String(rankValue), 10);
        
        if (isNaN(rank) || rank <= 0) continue;
        
        const companyName = String(
            row['Company Name'] || 
            row['Name of the Company'] || 
            row['Company'] || 
            ''
        ).trim();
        
        if (!companyName) continue;
        
        const symbol = String(
            row['Symbol'] || 
            row['NSE Symbol'] || 
            row['Scrip Code'] ||
            row['NSE Code'] ||
            ''
        ).trim().toUpperCase();
        
        const isin = String(
            row['ISIN'] || 
            row['ISIN Code'] || 
            row['ISIN No.'] ||
            ''
        ).trim().toUpperCase();
        
        const mcapValue = row['Average Market Cap (Rs. Cr.)'] || 
                         row['Average Market Cap'] || 
                         row['Avg. Market Cap'] ||
                         row['Market Cap'] ||
                         row['Avg Market Cap (Rs. Cr.)'] ||
                         0;
        const avgMarketCap = parseFloat(String(mcapValue).replace(/,/g, '')) || 0;
        
        classifications.push({
            rank,
            companyName,
            symbol,
            isin,
            category: getCategoryFromRank(rank),
            avgMarketCap
        });
    }
    
    classifications.sort((a, b) => a.rank - b.rank);
    
    return classifications;
}

async function downloadAMFIData(period: AMFIPeriod): Promise<ArrayBuffer> {
    const url = getAMFIDownloadUrl(period);
    console.log(`Downloading from: ${url}`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }
    
    return response.arrayBuffer();
}

async function syncToDatabase(
    classifications: AMFIStockClassification[],
    period: AMFIPeriod
): Promise<{ created: number; updated: number }> {
    const periodStr = `${period.year}_${period.halfYear}`;
    let created = 0;
    let updated = 0;
    
    console.log(`\nSyncing ${classifications.length} classifications to database...`);
    
    for (const classification of classifications) {
        if (!classification.symbol && !classification.isin) continue;
        
        const existing = await prisma.aMFIClassification.findFirst({
            where: {
                period: periodStr,
                symbol: classification.symbol
            }
        });
        
        if (existing) {
            await prisma.aMFIClassification.update({
                where: { id: existing.id },
                data: {
                    rank: classification.rank,
                    companyName: classification.companyName,
                    symbol: classification.symbol || existing.symbol,
                    isin: classification.isin || existing.isin,
                    category: classification.category,
                    avgMarketCap: classification.avgMarketCap
                }
            });
            updated++;
        } else {
            await prisma.aMFIClassification.create({
                data: {
                    period: periodStr,
                    rank: classification.rank,
                    companyName: classification.companyName,
                    symbol: classification.symbol,
                    isin: classification.isin,
                    category: classification.category,
                    avgMarketCap: classification.avgMarketCap
                }
            });
            created++;
        }
        
        // Progress indicator
        if ((created + updated) % 100 === 0) {
            process.stdout.write(`\rProcessed ${created + updated} / ${classifications.length}`);
        }
    }
    
    console.log(`\n\nSync complete: ${created} created, ${updated} updated`);
    return { created, updated };
}

async function showStatus() {
    const periods = await prisma.aMFIClassification.groupBy({
        by: ['period'],
        _count: { id: true }
    });
    
    console.log('\n=== AMFI Classification Status ===\n');
    
    if (periods.length === 0) {
        console.log('No AMFI data in database.');
    } else {
        console.log('Available periods:');
        for (const p of periods) {
            const categoryBreakdown = await prisma.aMFIClassification.groupBy({
                by: ['category'],
                where: { period: p.period },
                _count: { id: true }
            });
            
            const breakdown = categoryBreakdown
                .map(c => `${c.category}: ${c._count.id}`)
                .join(', ');
            
            console.log(`  ${p.period}: ${p._count.id} stocks (${breakdown})`);
        }
    }
    
    const currentPeriod = getCurrentAMFIPeriod();
    console.log(`\nCurrent applicable period: ${currentPeriod.year}_${currentPeriod.halfYear}`);
}

async function main() {
    const args = process.argv.slice(2);
    
    try {
        // Check for status flag
        if (args.includes('--status')) {
            await showStatus();
            return;
        }
        
        // Check for file flag
        const fileIndex = args.indexOf('--file');
        if (fileIndex !== -1 && args[fileIndex + 1]) {
            const filePath = args[fileIndex + 1];
            console.log(`Reading from local file: ${filePath}`);
            
            const absolutePath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(process.cwd(), filePath);
            
            const buffer = fs.readFileSync(absolutePath);
            const classifications = await parseAMFIExcel(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
            
            console.log(`\nParsed ${classifications.length} classifications:`);
            console.log(`  Large Cap (1-100): ${classifications.filter(c => c.category === 'Large').length}`);
            console.log(`  Mid Cap (101-250): ${classifications.filter(c => c.category === 'Mid').length}`);
            console.log(`  Small Cap (251-500): ${classifications.filter(c => c.category === 'Small').length}`);
            console.log(`  Micro Cap (501+): ${classifications.filter(c => c.category === 'Micro').length}`);
            
            // Determine period from filename or ask
            let period: AMFIPeriod;
            const match = filePath.match(/(\d{4})/);
            if (match) {
                const year = parseInt(match[1], 10);
                const isH1 = filePath.toLowerCase().includes('jun');
                period = { year, halfYear: isH1 ? 'H1' : 'H2' };
            } else {
                period = getCurrentAMFIPeriod();
            }
            
            console.log(`\nUsing period: ${period.year}_${period.halfYear}`);
            
            await syncToDatabase(classifications, period);
            return;
        }
        
        // Parse year and halfYear from args
        let period: AMFIPeriod;
        
        if (args.length >= 2) {
            const year = parseInt(args[0], 10);
            const halfYear = args[1].toUpperCase() as 'H1' | 'H2';
            
            if (isNaN(year) || (halfYear !== 'H1' && halfYear !== 'H2')) {
                console.error('Invalid arguments. Usage: npx tsx scripts/sync-amfi.ts [year] [H1|H2]');
                process.exit(1);
            }
            
            period = { year, halfYear };
        } else {
            period = getCurrentAMFIPeriod();
        }
        
        console.log(`\n=== AMFI Market Cap Classification Sync ===`);
        console.log(`Period: ${period.year}_${period.halfYear}`);
        
        // Download data
        const buffer = await downloadAMFIData(period);
        console.log(`Downloaded ${(buffer.byteLength / 1024).toFixed(1)} KB`);
        
        // Parse Excel
        const classifications = await parseAMFIExcel(buffer);
        
        console.log(`\nParsed ${classifications.length} classifications:`);
        console.log(`  Large Cap (1-100): ${classifications.filter(c => c.category === 'Large').length}`);
        console.log(`  Mid Cap (101-250): ${classifications.filter(c => c.category === 'Mid').length}`);
        console.log(`  Small Cap (251-500): ${classifications.filter(c => c.category === 'Small').length}`);
        console.log(`  Micro Cap (501+): ${classifications.filter(c => c.category === 'Micro').length}`);
        
        // Show sample data
        console.log('\nSample data (first 5):');
        for (const c of classifications.slice(0, 5)) {
            console.log(`  ${c.rank}. ${c.symbol || 'N/A'} - ${c.companyName} (${c.category}, ₹${c.avgMarketCap.toLocaleString()} Cr)`);
        }
        
        // Sync to database
        await syncToDatabase(classifications, period);
        
    } catch (error) {
        console.error('\nError:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
