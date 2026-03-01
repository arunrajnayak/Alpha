import { prisma } from './db';
import fs from 'fs/promises';
import path from 'path';
import { format } from 'date-fns';

import os from 'os';

const BACKUP_DIR = path.join(os.tmpdir(), 'backups');

export async function createBackup(label: string = 'auto') {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `backup_${timestamp}_${label}.json`;
    const filepath = path.join(BACKUP_DIR, filename);

    console.log(`Creating backup: ${filename}...`);

    // Fetch all critical data
    const transactions = await prisma.transaction.findMany();
    const importBatches = await prisma.importBatch.findMany();
    // CorporateAction table is deprecated - SPLIT/BONUS now in Transaction table

    const backupData = {
      timestamp: new Date().toISOString(),
      label,
      stats: {
        transactions: transactions.length,
        importBatches: importBatches.length,
      },
      data: {
        transactions,
        importBatches,
      },
    };

    await fs.writeFile(filepath, JSON.stringify(backupData, null, 2));
    console.log(`Backup created successfully at ${filepath}`);
    return { success: true, filepath, count: backupData.stats };
  } catch (error) {
    console.error('Backup failed:', error);
    // Don't throw, just log. We don't want to crash the app if backup fails, 
    // unless strict mode is required (which in this case, safeguards imply we SHOULD probably care).
    // Let's return failure status.
    return { success: false, error };
  }
}
