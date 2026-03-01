/**
 * AMFI Sync Cron Job
 * 
 * Runs weekly (every Sunday at 6 AM IST / 00:30 UTC) to sync market cap classifications.
 * 
 * AMFI releases data twice a year:
 * - H1 data (Jan-Jun) released around July
 * - H2 data (Jul-Dec) released around January
 * 
 * This cron will:
 * 1. Check if we have data for the expected current period
 * 2. If not, attempt to download and sync the latest available data
 * 3. Log the result for monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
    fullAMFISync, 
    getCurrentAMFIPeriod, 
    hasAMFIData,
    getAvailableAMFIPeriods,
    AMFIPeriod 
} from '@/lib/amfi-service';
import { verifyCronSecret } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// List of periods to try in order (most recent first)
function getPeriodsToTry(): AMFIPeriod[] {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    const periods: AMFIPeriod[] = [];
    
    // Start from current expected period and go backwards
    if (month < 6) {
        // Jan-Jun: Try H2 of previous year, then H1 of previous year
        periods.push({ year: year - 1, halfYear: 'H2' });
        periods.push({ year: year - 1, halfYear: 'H1' });
    } else {
        // Jul-Dec: Try H1 of current year, then H2 of previous year
        periods.push({ year, halfYear: 'H1' });
        periods.push({ year: year - 1, halfYear: 'H2' });
    }
    
    return periods;
}

export async function GET(request: NextRequest) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    const startTime = Date.now();
    console.log('[AMFI Cron] Starting weekly sync check...');
    
    try {
        // Check what periods we already have
        const availablePeriods = await getAvailableAMFIPeriods();
        const currentPeriod = getCurrentAMFIPeriod();
        const hasCurrentData = await hasAMFIData(currentPeriod);
        
        console.log(`[AMFI Cron] Current expected period: ${currentPeriod.year}_${currentPeriod.halfYear}`);
        console.log(`[AMFI Cron] Has current data: ${hasCurrentData}`);
        console.log(`[AMFI Cron] Available periods: ${availablePeriods.join(', ') || 'none'}`);
        
        // If we already have current period data, skip sync
        if (hasCurrentData) {
            console.log('[AMFI Cron] Data is up to date, skipping sync');
            return NextResponse.json({
                success: true,
                action: 'skipped',
                reason: 'Data already up to date',
                currentPeriod: `${currentPeriod.year}_${currentPeriod.halfYear}`,
                availablePeriods,
                durationMs: Date.now() - startTime
            });
        }
        
        // Try to sync from latest available period
        const periodsToTry = getPeriodsToTry();
        let syncResult = null;
        let lastError = null;
        
        for (const period of periodsToTry) {
            const periodStr = `${period.year}_${period.halfYear}`;
            
            // Skip if we already have this period
            if (availablePeriods.includes(periodStr)) {
                console.log(`[AMFI Cron] Already have period ${periodStr}, skipping`);
                continue;
            }
            
            console.log(`[AMFI Cron] Attempting to sync period: ${periodStr}`);
            
            try {
                syncResult = await fullAMFISync(period);
                console.log(`[AMFI Cron] Successfully synced ${syncResult.total} classifications for ${periodStr}`);
                break; // Success, stop trying
            } catch (error) {
                lastError = error;
                console.warn(`[AMFI Cron] Failed to sync ${periodStr}: ${(error as Error).message}`);
                // Continue to try next period
            }
        }
        
        if (syncResult) {
            return NextResponse.json({
                success: true,
                action: 'synced',
                ...syncResult,
                durationMs: Date.now() - startTime
            });
        } else {
            // No sync happened (either all failed or all periods already exist)
            return NextResponse.json({
                success: true,
                action: 'no_new_data',
                reason: lastError ? `Failed to find new AMFI data: ${(lastError as Error).message}` : 'All available periods already synced',
                availablePeriods: await getAvailableAMFIPeriods(),
                durationMs: Date.now() - startTime
            });
        }
    } catch (error) {
        console.error('[AMFI Cron] Error:', error);
        return NextResponse.json({
            success: false,
            error: 'AMFI sync failed',
            details: (error as Error).message,
            durationMs: Date.now() - startTime
        }, { status: 500 });
    }
}
