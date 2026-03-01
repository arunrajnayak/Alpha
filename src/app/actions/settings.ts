'use server';

import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { recalculatePortfolioHistory } from '@/lib/finance';
import { clearLockDateCache } from '@/lib/config';

export async function triggerSnapshotRecomputation(fromDateStr?: string) {
    const fromDate = fromDateStr ? new Date(fromDateStr) : undefined;
    await recalculatePortfolioHistory(fromDate);
    revalidatePath('/');
    revalidatePath('/snapshots');
    revalidatePath('/dashboard');
    return { success: true };
}



// --- App Config Actions ---

export async function getDataLockDate(): Promise<string | null> {
    const config = await prisma.appConfig.findUnique({
        where: { key: 'DATA_LOCK_DATE' }
    });
    return config?.value || null;
}

export async function setDataLockDate(dateStr: string | null): Promise<{ success: boolean }> {
    if (dateStr) {
        await prisma.appConfig.upsert({
            where: { key: 'DATA_LOCK_DATE' },
            update: { value: dateStr },
            create: { key: 'DATA_LOCK_DATE', value: dateStr }
        });
    } else {
        // Clear the lock
        await prisma.appConfig.deleteMany({
            where: { key: 'DATA_LOCK_DATE' }
        });
    }
    
    // Invalidate the cache in the config module so the new value is picked up immediately
    // by any subsequent recalculation logic running in the same process.
    clearLockDateCache();
    
    revalidatePath('/settings');
    return { success: true };
}
