/**
 * Centralized configuration for the application.
 * Reads from database (AppConfig table) with fallback to environment variables.
 */

import { prisma } from './db';

// Cache for the lock date to avoid repeated DB calls during a single request
let cachedLockDate: Date | null | undefined = undefined;

/**
 * Get the DATA_LOCK_DATE from the database or environment.
 * All data before this date is protected from recalculation modifications.
 */
export async function getDataLockDate(): Promise<Date | null> {
    if (cachedLockDate !== undefined) {
        return cachedLockDate;
    }
    
    try {
        const config = await prisma.appConfig.findUnique({
            where: { key: 'DATA_LOCK_DATE' }
        });
        
        if (config?.value) {
            cachedLockDate = new Date(config.value + 'T00:00:00.000Z');
            console.log(`[Config] Data Lock Active (DB): Protecting data before ${cachedLockDate.toISOString().split('T')[0]}`);
            return cachedLockDate;
        }
    } catch {
        // DB not available, fall back to env
    }
    
    // Fallback to environment variable
    if (process.env.DATA_LOCK_DATE) {
        cachedLockDate = new Date(process.env.DATA_LOCK_DATE + 'T00:00:00.000Z');
        console.log(`[Config] Data Lock Active (ENV): Protecting data before ${cachedLockDate.toISOString().split('T')[0]}`);
        return cachedLockDate;
    }
    
    cachedLockDate = null;
    return null;
}

/**
 * Clear the cached lock date (call after updates).
 */
export function clearLockDateCache() {
    cachedLockDate = undefined;
}

// Legacy sync export for backward compatibility (reads env only)
export const DATA_LOCK_DATE: Date | null = process.env.DATA_LOCK_DATE
    ? new Date(process.env.DATA_LOCK_DATE + 'T00:00:00.000Z')
    : null;

// App Configuration
export const APP_CONFIG = {
    USER_NAME: process.env.APP_USER_NAME || 'User',
} as const;
