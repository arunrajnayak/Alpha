#!/usr/bin/env npx tsx
/**
 * Database Restore Script
 * 
 * IMPORTANT: This script restores data to the PRODUCTION Turso database.
 * It requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables.
 * 
 * Usage:
 *   # Verify backup integrity (safe, read-only)
 *   npx tsx scripts/restore-backup.ts --verify-only backups/pre-upstox-migration.json
 *   
 *   # Restore from backup (DESTRUCTIVE - clears existing data!)
 *   source .env.vercel.local
 *   npx tsx scripts/restore-backup.ts --restore backups/pre-upstox-migration.json
 */

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import fs from 'fs/promises';
import readline from 'readline';

// Parse command line arguments
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const restore = args.includes('--restore');
const backupPath = args.find(arg => arg.endsWith('.json'));

if (!backupPath) {
    console.error('❌ ERROR: Please provide a backup file path');
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/restore-backup.ts --verify-only <backup.json>');
    console.error('  npx tsx scripts/restore-backup.ts --restore <backup.json>');
    console.error('');
    process.exit(1);
}

if (!verifyOnly && !restore) {
    console.error('❌ ERROR: Please specify --verify-only or --restore');
    process.exit(1);
}

interface BackupData {
    metadata: {
        timestamp: string;
        tursoUrl: string;
        version: string;
    };
    counts: Record<string, number>;
    data: {
        transactions: unknown[];
        importBatches: unknown[];
        // Note: cashflows table was removed from schema - legacy backups may still have this field
        stockHistory: unknown[];
        dailySnapshots: unknown[];
        weeklySnapshots: unknown[];
        monthlySnapshots: unknown[];
        indexHistory: unknown[];
        symbolMappings: unknown[];
        // marketCapDefinitions: unknown[];
        sectorMappings: unknown[];
        appConfigs: unknown[];
        jobs: unknown[];
    };
}

async function askConfirmation(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes');
        });
    });
}

async function verifyBackup(backupData: BackupData): Promise<boolean> {
    console.log('🔍 Verifying backup file...');
    console.log('');
    console.log(`   📅 Backup timestamp: ${backupData.metadata.timestamp}`);
    console.log(`   🔗 Source database: ${backupData.metadata.tursoUrl}`);
    console.log(`   📦 Version: ${backupData.metadata.version}`);
    console.log('');

    // Verify counts match data
    let valid = true;
    const issues: string[] = [];

    console.log('   Verifying data integrity...');
    console.log('');
    console.log('   Table                    | Expected | Actual   | Status');
    console.log('   -------------------------|----------|----------|--------');

    const tableMap: Record<string, keyof BackupData['data']> = {
        transactions: 'transactions',
        importBatches: 'importBatches',
        // Note: cashflows table was removed from schema
        stockHistory: 'stockHistory',
        dailySnapshots: 'dailySnapshots',
        weeklySnapshots: 'weeklySnapshots',
        monthlySnapshots: 'monthlySnapshots',
        indexHistory: 'indexHistory',
        symbolMappings: 'symbolMappings',
        // marketCapDefinitions: 'marketCapDefinitions',
        sectorMappings: 'sectorMappings',
        appConfigs: 'appConfigs',
        jobs: 'jobs',
    };

    for (const [countKey, dataKey] of Object.entries(tableMap)) {
        const expected = backupData.counts[countKey] || 0;
        const actual = Array.isArray(backupData.data[dataKey]) ? backupData.data[dataKey].length : 0;
        const match = expected === actual;

        if (!match) {
            valid = false;
            issues.push(`${countKey}: expected ${expected}, got ${actual}`);
        }

        const status = match ? '✅' : '❌';
        console.log(`   ${countKey.padEnd(24)} | ${String(expected).padEnd(8)} | ${String(actual).padEnd(8)} | ${status}`);
    }

    console.log('');

    if (valid) {
        console.log('✅ Backup file is valid!');
    } else {
        console.log('❌ Backup file has integrity issues:');
        for (const issue of issues) {
            console.log(`   - ${issue}`);
        }
    }

    return valid;
}

async function restoreBackup(backupData: BackupData) {
    // Validate environment
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoAuth = process.env.TURSO_AUTH_TOKEN;

    if (!tursoUrl || !tursoAuth) {
        console.error('❌ ERROR: Missing production database credentials!');
        console.error('');
        console.error('Please set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
        console.error('  source .env.vercel.local');
        console.error('');
        process.exit(1);
    }

    // Mask URL for display
    function maskUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname.slice(0, 8)}...${parsed.hostname.slice(-10)}`;
        } catch {
            return url.slice(0, 20) + '...';
        }
    }

    console.log('');
    console.log('⚠️  WARNING: This will DELETE ALL EXISTING DATA and restore from backup!');
    console.log('');
    console.log(`   Target database: ${maskUrl(tursoUrl)}`);
    console.log(`   Backup source: ${backupData.metadata.tursoUrl}`);
    console.log(`   Backup date: ${backupData.metadata.timestamp}`);
    console.log('');

    const confirmed = await askConfirmation('Type "yes" to proceed with restore: ');

    if (!confirmed) {
        console.log('❌ Restore cancelled.');
        process.exit(0);
    }

    console.log('');
    console.log('🔌 Connecting to database...');

    const adapter = new PrismaLibSql({
        url: tursoUrl,
        authToken: tursoAuth,
    });

    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Connected');
        console.log('');

        // Delete existing data in reverse dependency order
        console.log('🗑️  Clearing existing data...');

        await prisma.transaction.deleteMany();
        console.log('   - Transactions cleared');

        await prisma.importBatch.deleteMany();
        console.log('   - Import batches cleared');

        // Note: Cashflow table was removed from schema

        await prisma.stockHistory.deleteMany();
        console.log('   - Stock history cleared');

        await prisma.dailyPortfolioSnapshot.deleteMany();
        console.log('   - Daily snapshots cleared');

        await prisma.weeklyPortfolioSnapshot.deleteMany();
        console.log('   - Weekly snapshots cleared');

        await prisma.monthlyPortfolioSnapshot.deleteMany();
        console.log('   - Monthly snapshots cleared');

        await prisma.indexHistory.deleteMany();
        console.log('   - Index history cleared');

        await prisma.symbolMapping.deleteMany();
        console.log('   - Symbol mappings cleared');

        // await prisma.marketCapDefinition.deleteMany();
        console.log('   - Market cap definitions cleared -- (None to clear, table removed)');

        await prisma.sectorMapping.deleteMany();
        console.log('   - Sector mappings cleared');

        await prisma.appConfig.deleteMany();
        console.log('   - App configs cleared');

        await prisma.job.deleteMany();
        console.log('   - Jobs cleared');

        console.log('');
        console.log('📥 Restoring data...');

        // Restore in dependency order (parents first)
        
        // Import batches first (parent of transactions)
        if (backupData.data.importBatches.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const batch of backupData.data.importBatches as any[]) {
                await prisma.importBatch.create({
                    data: {
                        id: batch.id,
                        filename: batch.filename,
                        timestamp: new Date(batch.timestamp),
                        count: batch.count,
                        startDate: batch.startDate ? new Date(batch.startDate) : null,
                        endDate: batch.endDate ? new Date(batch.endDate) : null,
                    },
                });
            }
            console.log(`   - Import batches: ${backupData.data.importBatches.length} restored`);
        }

        // Transactions
        if (backupData.data.transactions.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const tx of backupData.data.transactions as any[]) {
                await prisma.transaction.create({
                    data: {
                        id: tx.id,
                        date: new Date(tx.date),
                        symbol: tx.symbol,
                        type: tx.type,
                        quantity: tx.quantity,
                        price: tx.price,
                        orderId: tx.orderId,
                        createdAt: new Date(tx.createdAt),
                        splitRatio: tx.splitRatio,
                        newSymbol: tx.newSymbol,
                        description: tx.description,
                        importBatchId: tx.importBatchId,
                    },
                });
            }
            console.log(`   - Transactions: ${backupData.data.transactions.length} restored`);
        }

        // Note: Cashflow table was removed from schema - skip restore of legacy cashflows data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((backupData.data as any).cashflows?.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            console.log(`   - Cashflows: Skipped (table removed from schema) - ${(backupData.data as any).cashflows.length} records in backup`);
        }

        // Stock history (batch insert for performance)
        if (backupData.data.stockHistory.length > 0) {
            const batchSize = 500;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const records = backupData.data.stockHistory as any[];
            for (let i = 0; i < records.length; i += batchSize) {
                const batch = records.slice(i, i + batchSize);
                await prisma.stockHistory.createMany({
                    data: batch.map(sh => ({
                        id: sh.id,
                        date: new Date(sh.date),
                        symbol: sh.symbol,
                        close: sh.close,
                    })),
                });
            }
            console.log(`   - Stock history: ${backupData.data.stockHistory.length} restored`);
        }

        // Daily snapshots
        if (backupData.data.dailySnapshots.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const snap of backupData.data.dailySnapshots as any[]) {
                await prisma.dailyPortfolioSnapshot.create({
                    data: {
                        id: snap.id,
                        date: new Date(snap.date),
                        totalEquity: snap.totalEquity,
                        investedCapital: snap.investedCapital,
                        portfolioNAV: snap.portfolioNAV,
                        niftyNAV: snap.niftyNAV,
                        units: snap.units,
                        cashflow: snap.cashflow,
                        dailyPnL: snap.dailyPnL,
                        dailyReturn: snap.dailyReturn,
                        drawdown: snap.drawdown,
                        navMA200: snap.navMA200,
                        nifty500Momentum50NAV: snap.nifty500Momentum50NAV,
                        niftyMicrocap250NAV: snap.niftyMicrocap250NAV,
                        niftyMidcap100NAV: snap.niftyMidcap100NAV,
                        niftySmallcap250NAV: snap.niftySmallcap250NAV,
                    },
                });
            }
            console.log(`   - Daily snapshots: ${backupData.data.dailySnapshots.length} restored`);
        }

        // Weekly snapshots
        if (backupData.data.weeklySnapshots.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const snap of backupData.data.weeklySnapshots as any[]) {
                await prisma.weeklyPortfolioSnapshot.create({
                    data: {
                        id: snap.id,
                        date: new Date(snap.date),
                        totalEquity: snap.totalEquity,
                        nav: snap.nav,
                        weeklyReturn: snap.weeklyReturn,
                        largeCapPercent: snap.largeCapPercent,
                        midCapPercent: snap.midCapPercent,
                        smallCapPercent: snap.smallCapPercent,
                        microCapPercent: snap.microCapPercent,
                        marketCap: snap.marketCap,
                        xirr: snap.xirr,
                        pnl: snap.pnl,
                        winPercent: snap.winPercent,
                        lossPercent: snap.lossPercent,
                        avgHoldingPeriod: snap.avgHoldingPeriod,
                        avgWinnerGain: snap.avgWinnerGain,
                        avgLoserLoss: snap.avgLoserLoss,
                        sectorAllocation: snap.sectorAllocation,
                    },
                });
            }
            console.log(`   - Weekly snapshots: ${backupData.data.weeklySnapshots.length} restored`);
        }

        // Monthly snapshots
        if (backupData.data.monthlySnapshots.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const snap of backupData.data.monthlySnapshots as any[]) {
                await prisma.monthlyPortfolioSnapshot.create({
                    data: {
                        id: snap.id,
                        date: new Date(snap.date),
                        totalEquity: snap.totalEquity,
                        nav: snap.nav,
                        monthlyReturn: snap.monthlyReturn,
                        largeCapPercent: snap.largeCapPercent,
                        midCapPercent: snap.midCapPercent,
                        smallCapPercent: snap.smallCapPercent,
                        microCapPercent: snap.microCapPercent,
                        marketCap: snap.marketCap,
                        xirr: snap.xirr,
                        pnl: snap.pnl,
                        winPercent: snap.winPercent,
                        lossPercent: snap.lossPercent,
                        avgHoldingPeriod: snap.avgHoldingPeriod,
                        avgWinnerGain: snap.avgWinnerGain,
                        avgLoserLoss: snap.avgLoserLoss,
                        exitCount: snap.exitCount,
                        avgExitsPerMonth: snap.avgExitsPerMonth,
                        sectorAllocation: snap.sectorAllocation,
                    },
                });
            }
            console.log(`   - Monthly snapshots: ${backupData.data.monthlySnapshots.length} restored`);
        }

        // Index history (batch insert)
        if (backupData.data.indexHistory.length > 0) {
            const batchSize = 500;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const records = backupData.data.indexHistory as any[];
            for (let i = 0; i < records.length; i += batchSize) {
                const batch = records.slice(i, i + batchSize);
                await prisma.indexHistory.createMany({
                    data: batch.map(ih => ({
                        date: new Date(ih.date),
                        symbol: ih.symbol,
                        close: ih.close,
                    })),
                });
            }
            console.log(`   - Index history: ${backupData.data.indexHistory.length} restored`);
        }

        // Symbol mappings
        if (backupData.data.symbolMappings.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const sm of backupData.data.symbolMappings as any[]) {
                await prisma.symbolMapping.create({
                    data: {
                        id: sm.id,
                        oldSymbol: sm.oldSymbol,
                        newSymbol: sm.newSymbol,
                        createdAt: new Date(sm.createdAt),
                    },
                });
            }
            console.log(`   - Symbol mappings: ${backupData.data.symbolMappings.length} restored`);
        }

        // Market cap definitions
        // (Skipped, table removed)
        /*
        if (backupData.data.marketCapDefinitions.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const mcd of backupData.data.marketCapDefinitions as any[]) {
                await prisma.marketCapDefinition.create({
                    data: {
                        id: mcd.id,
                        year: mcd.year,
                        period: mcd.period,
                        largeCapThreshold: mcd.largeCapThreshold,
                        midCapThreshold: mcd.midCapThreshold,
                        smallCapThreshold: mcd.smallCapThreshold,
                        microCapThreshold: mcd.microCapThreshold,
                    },
                });
            }
            console.log(`   - Market cap definitions: ${backupData.data.marketCapDefinitions.length} restored`);
        }
        */

        // Sector mappings
        if (backupData.data.sectorMappings.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const sm of backupData.data.sectorMappings as any[]) {
                await prisma.sectorMapping.create({
                    data: {
                        id: sm.id,
                        symbol: sm.symbol,
                        sector: sm.sector,
                        exchange: sm.exchange,
                        updatedAt: new Date(sm.updatedAt),
                    },
                });
            }
            console.log(`   - Sector mappings: ${backupData.data.sectorMappings.length} restored`);
        }

        // App configs
        if (backupData.data.appConfigs.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const ac of backupData.data.appConfigs as any[]) {
                await prisma.appConfig.create({
                    data: {
                        key: ac.key,
                        value: ac.value,
                        updatedAt: new Date(ac.updatedAt),
                    },
                });
            }
            console.log(`   - App configs: ${backupData.data.appConfigs.length} restored`);
        }

        // Jobs
        if (backupData.data.jobs.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const job of backupData.data.jobs as any[]) {
                await prisma.job.create({
                    data: {
                        id: job.id,
                        type: job.type,
                        status: job.status,
                        progress: job.progress,
                        message: job.message,
                        result: job.result,
                        error: job.error,
                        createdAt: new Date(job.createdAt),
                        updatedAt: new Date(job.updatedAt),
                    },
                });
            }
            console.log(`   - Jobs: ${backupData.data.jobs.length} restored`);
        }

        console.log('');
        console.log('✅ Restore completed successfully!');
        console.log('');

        // Verify counts
        console.log('🔍 Verifying restored data...');
        const finalCounts: Record<string, number> = {
            transactions: await prisma.transaction.count(),
            importBatches: await prisma.importBatch.count(),
            // Note: Cashflow table was removed from schema
            stockHistory: await prisma.stockHistory.count(),
            dailySnapshots: await prisma.dailyPortfolioSnapshot.count(),
            weeklySnapshots: await prisma.weeklyPortfolioSnapshot.count(),
            monthlySnapshots: await prisma.monthlyPortfolioSnapshot.count(),
            indexHistory: await prisma.indexHistory.count(),
            symbolMappings: await prisma.symbolMapping.count(),
            // marketCapDefinitions: await prisma.marketCapDefinition.count(),
            sectorMappings: await prisma.sectorMapping.count(),
            appConfigs: await prisma.appConfig.count(),
            jobs: await prisma.job.count(),
        };

        let allMatch = true;
        for (const [table, expected] of Object.entries(backupData.counts)) {
            const actual = finalCounts[table] || 0;
            if (expected !== actual) {
                console.log(`   ❌ ${table}: expected ${expected}, got ${actual}`);
                allMatch = false;
            }
        }

        if (allMatch) {
            console.log('   ✅ All row counts match!');
        }

    } catch (error) {
        console.error('❌ Restore failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

async function main() {
    // Read backup file
    console.log(`📂 Reading backup file: ${backupPath}`);
    
    let backupData: BackupData;
    try {
        const content = await fs.readFile(backupPath!, 'utf-8'); // Non-null assertion safe: validated at script start
        backupData = JSON.parse(content);
    } catch (error) {
        console.error(`❌ Failed to read backup file: ${error}`);
        process.exit(1);
    }

    if (verifyOnly) {
        const valid = await verifyBackup(backupData);
        process.exit(valid ? 0 : 1);
    }

    if (restore) {
        // Verify first
        const valid = await verifyBackup(backupData);
        if (!valid) {
            console.log('');
            console.log('❌ Cannot restore from invalid backup file.');
            process.exit(1);
        }

        await restoreBackup(backupData);
    }
}

main();
