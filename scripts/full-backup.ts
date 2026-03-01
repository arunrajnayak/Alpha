#!/usr/bin/env npx tsx
/**
 * Full Database Backup Script
 * 
 * IMPORTANT: This script backs up the PRODUCTION Turso database.
 * It requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables.
 * 
 * Usage:
 *   # Load prod credentials first
 *   source .env.vercel.local
 *   
 *   # Run backup
 *   npx tsx scripts/full-backup.ts --output backups/pre-upstox-migration.json
 */

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import fs from 'fs/promises';
import path from 'path';
import { format } from 'date-fns';

// Parse command line arguments
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;

// Validate environment
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuth = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoAuth) {
    console.error('❌ ERROR: Missing production database credentials!');
    console.error('');
    console.error('This script MUST connect to the production Turso database.');
    console.error('Please set the following environment variables:');
    console.error('  - TURSO_DATABASE_URL');
    console.error('  - TURSO_AUTH_TOKEN');
    console.error('');
    console.error('You can load them from .env.vercel.local:');
    console.error('  source .env.vercel.local');
    console.error('');
    process.exit(1);
}

// Mask URL for display (show only domain)
function maskUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname.slice(0, 8)}...${parsed.hostname.slice(-10)}`;
    } catch {
        return url.slice(0, 20) + '...';
    }
}

console.log('🔌 Connecting to PRODUCTION database...');
console.log(`   URL: ${maskUrl(tursoUrl)}`);

// Create Prisma client with Turso adapter
const adapter = new PrismaLibSql({
    url: tursoUrl,
    authToken: tursoAuth,
});

const prisma = new PrismaClient({ adapter });

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
        // Note: cashflows table was removed from schema
        stockHistory: unknown[];
        dailySnapshots: unknown[];
        weeklySnapshots: unknown[];
        monthlySnapshots: unknown[];
        indexHistory: unknown[];
        symbolMappings: unknown[];
        // Note: marketCapDefinitions removed
        sectorMappings: unknown[];
        appConfigs: unknown[];
        jobs: unknown[];
    };
}

async function runBackup() {
    try {
        // Test connection
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Connected to production database');
        console.log('');

        // Count rows in each table
        console.log('📊 Counting rows in each table...');
        
        const counts: Record<string, number> = {};
        
        counts.transactions = await prisma.transaction.count();
        counts.importBatches = await prisma.importBatch.count();
        // Note: Cashflow table was removed from schema - cashflow is now tracked as a field in DailyPortfolioSnapshot
        counts.stockHistory = await prisma.stockHistory.count();
        counts.dailySnapshots = await prisma.dailyPortfolioSnapshot.count();
        counts.weeklySnapshots = await prisma.weeklyPortfolioSnapshot.count();
        counts.monthlySnapshots = await prisma.monthlyPortfolioSnapshot.count();
        counts.indexHistory = await prisma.indexHistory.count();
        counts.symbolMappings = await prisma.symbolMapping.count();
        // counts.marketCapDefinitions removed
        counts.sectorMappings = await prisma.sectorMapping.count();
        counts.appConfigs = await prisma.appConfig.count();
        counts.jobs = await prisma.job.count();

        console.log('');
        console.log('   Table                    | Rows');
        console.log('   -------------------------|--------');
        for (const [table, count] of Object.entries(counts)) {
            console.log(`   ${table.padEnd(24)} | ${count}`);
        }
        console.log('');

        const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
        console.log(`   Total rows: ${totalRows}`);
        console.log('');

        if (totalRows === 0) {
            console.warn('⚠️  WARNING: Database appears to be empty!');
            console.warn('   Are you sure you are connected to the production database?');
            console.warn('');
        }

        // Export all data
        console.log('📦 Exporting data...');

        const backupData: BackupData = {
            metadata: {
                timestamp: new Date().toISOString(),
                tursoUrl: maskUrl(tursoUrl!), // Non-null assertion safe: validated at script start
                version: '1.0',
            },
            counts,
            data: {
                transactions: await prisma.transaction.findMany(),
                importBatches: await prisma.importBatch.findMany(),
                // Note: Cashflow table was removed from schema
                stockHistory: await prisma.stockHistory.findMany(),
                dailySnapshots: await prisma.dailyPortfolioSnapshot.findMany(),
                weeklySnapshots: await prisma.weeklyPortfolioSnapshot.findMany(),
                monthlySnapshots: await prisma.monthlyPortfolioSnapshot.findMany(),
                indexHistory: await prisma.indexHistory.findMany(),
                symbolMappings: await prisma.symbolMapping.findMany(),
                // Note: MarketCapDefinition table was removed
                sectorMappings: await prisma.sectorMapping.findMany(),
                appConfigs: await prisma.appConfig.findMany(),
                jobs: await prisma.job.findMany(),
            },
        };

        // Determine output path
        const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
        const finalPath = outputPath || path.join(process.cwd(), 'backups', `full-backup-${timestamp}.json`);

        // Ensure directory exists
        await fs.mkdir(path.dirname(finalPath), { recursive: true });

        // Write backup file
        await fs.writeFile(finalPath, JSON.stringify(backupData, null, 2));

        const stats = await fs.stat(finalPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log('');
        console.log('✅ Backup completed successfully!');
        console.log('');
        console.log(`   📁 File: ${finalPath}`);
        console.log(`   📊 Size: ${sizeMB} MB`);
        console.log(`   🕐 Time: ${backupData.metadata.timestamp}`);
        console.log('');
        console.log('To verify this backup, run:');
        console.log(`   npx tsx scripts/restore-backup.ts --verify-only ${finalPath}`);
        console.log('');

    } catch (error) {
        console.error('❌ Backup failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

runBackup();
