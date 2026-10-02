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
} from '@/lib/amfi';
import { syncTotalMarketConstituents } from '@/lib/index-constituents';
import { recalculatePortfolioHistory } from '@/lib/finance';
import { verifyCronSecret } from '@/lib/cron-auth';
import { apiLogger } from '@/lib/logger';
import { istDateParts } from '@/lib/tz';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// List of periods to try in order (most recent first). Anchored to the IST
// calendar so the H1/H2 boundary aligns with India.
function getPeriodsToTry(): AMFIPeriod[] {
    const { year, month } = istDateParts();

    const periods: AMFIPeriod[] = [];

    // Start from current expected period and go backwards
    if (month <= 6) {
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
    apiLogger.info('Starting weekly sync check...');
    
    try {
        // --- 1. AMFI Sync Check ---
        const availablePeriods = await getAvailableAMFIPeriods();
        const currentPeriod = getCurrentAMFIPeriod();
        const hasCurrentData = await hasAMFIData(currentPeriod);
        
        apiLogger.info(`Current expected AMFI period: ${currentPeriod.year}_${currentPeriod.halfYear}`);
        apiLogger.info(`Has current AMFI data: ${hasCurrentData}`);
        apiLogger.info(`Available AMFI periods: ${availablePeriods.join(', ') || 'none'}`);
        
        let amfiResult: any = { action: 'skipped', reason: 'Data already up to date' };

        if (!hasCurrentData) {
            const periodsToTry = getPeriodsToTry();
            let syncResult = null;
            let lastError = null;

            for (const period of periodsToTry) {
                const periodStr = `${period.year}_${period.halfYear}`;
                if (availablePeriods.includes(periodStr)) continue;

                apiLogger.info(`Attempting to sync AMFI period: ${periodStr}`);
                try {
                    syncResult = await fullAMFISync(period);
                    apiLogger.info(`Successfully synced ${syncResult.total} classifications for ${periodStr}`);
                    break;
                } catch (error) {
                    lastError = error;
                    apiLogger.warn(`Failed to sync AMFI period ${periodStr}: ${(error as Error).message}`);
                }
            }

            if (syncResult) {
                amfiResult = { action: 'synced', ...syncResult };
            } else {
                amfiResult = {
                    action: 'no_new_data',
                    reason: lastError ? `Failed to find new AMFI data: ${(lastError as Error).message}` : 'All available periods already synced',
                };
            }
        }

        // --- 2. Nifty Total Market Index Sync Check ---
        apiLogger.info('Checking Nifty Total Market constituents sync...');
        const totalMarketResult = await syncTotalMarketConstituents();
        apiLogger.info(`Total Market sync status: ${totalMarketResult.status} — ${totalMarketResult.message}`);

        // If either AMFI or Total Market rebalanced, trigger a full recalculation
        let recomputed = false;
        if (totalMarketResult.status === 'rebalanced' || amfiResult.action === 'synced') {
            apiLogger.info('Rebalance or new classification detected. Triggering portfolio recalculation...');
            try {
                await recalculatePortfolioHistory();
                recomputed = true;
            } catch (recalcErr) {
                apiLogger.error('Automatic recalculation failed:', recalcErr);
            }
        }

        return NextResponse.json({
            success: true,
            amfi: {
                ...amfiResult,
                currentPeriod: `${currentPeriod.year}_${currentPeriod.halfYear}`,
                availablePeriods,
            },
            totalMarket: totalMarketResult,
            recomputed,
            durationMs: Date.now() - startTime,
        });
    } catch (error) {
        apiLogger.error('Weekly sync check failed:', error);
        return NextResponse.json({
            success: false,
            error: 'Weekly sync check failed',
            details: (error as Error).message,
            durationMs: Date.now() - startTime
        }, { status: 500 });
    }
}
