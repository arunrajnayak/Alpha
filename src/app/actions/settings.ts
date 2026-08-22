'use server';

import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { recalculatePortfolioHistory } from '@/lib/finance';
import { clearLockDateCache } from '@/lib/config';
import { ANALYTICS_TOKEN_CONFIG_KEY, clearAnalyticsTokenCache } from '@/lib/upstox/auth';

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

// --- Upstox Analytics Token ---

/**
 * Whether an Upstox analytics token has been configured via the Settings page
 * (stored in AppConfig). The raw token value is never returned to the client
 * for security reasons — only its configured/not-configured state.
 */
export async function isUpstoxAnalyticsTokenConfigured(): Promise<boolean> {
    const config = await prisma.appConfig.findUnique({
        where: { key: ANALYTICS_TOKEN_CONFIG_KEY }
    });
    return !!config?.value;
}

/**
 * Persist (or clear) the Upstox analytics token in AppConfig. Passing an empty
 * or nullish value removes the stored token, causing the app to fall back to the
 * `UPSTOX_ANALYTICS_TOKEN` environment variable (if set).
 */
export async function setUpstoxAnalyticsToken(token: string | null): Promise<{ success: boolean }> {
    const trimmed = token?.trim();
    if (trimmed) {
        await prisma.appConfig.upsert({
            where: { key: ANALYTICS_TOKEN_CONFIG_KEY },
            update: { value: trimmed },
            create: { key: ANALYTICS_TOKEN_CONFIG_KEY, value: trimmed }
        });
    } else {
        await prisma.appConfig.deleteMany({
            where: { key: ANALYTICS_TOKEN_CONFIG_KEY }
        });
    }

    // Invalidate the in-memory token cache so the new value is used immediately.
    clearAnalyticsTokenCache();

    revalidatePath('/settings');
    return { success: true };
}
