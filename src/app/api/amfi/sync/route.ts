/**
 * API Route: /api/amfi/sync
 * 
 * Syncs AMFI market cap classification data from the official AMFI Excel file.
 * This should be called manually or via cron every 6 months when AMFI releases new data.
 * 
 * Query params:
 * - year: Optional year (e.g., 2024)
 * - halfYear: Optional half year (H1 or H2)
 * 
 * If no params provided, uses the current applicable period.
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
    fullAMFISync, 
    getCurrentAMFIPeriod, 
    hasAMFIData,
    getAvailableAMFIPeriods,
    AMFIPeriod 
} from '@/lib/amfi-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for download and processing

export async function GET() {
    try {
        // Check for existing data
        const availablePeriods = await getAvailableAMFIPeriods();
        const currentPeriod = getCurrentAMFIPeriod();
        const hasCurrentData = await hasAMFIData(currentPeriod);
        
        return NextResponse.json({
            currentPeriod: `${currentPeriod.year}_${currentPeriod.halfYear}`,
            hasCurrentData,
            availablePeriods,
            message: hasCurrentData 
                ? 'AMFI data is up to date. Use POST to force refresh.'
                : 'No AMFI data for current period. Use POST to sync.'
        });
    } catch (error) {
        console.error('[AMFI Sync] Error checking status:', error);
        return NextResponse.json(
            { error: 'Failed to check AMFI status', details: String(error) },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const yearParam = searchParams.get('year');
        const halfYearParam = searchParams.get('halfYear');
        
        let period: AMFIPeriod | undefined;
        
        if (yearParam && halfYearParam) {
            const year = parseInt(yearParam, 10);
            const halfYear = halfYearParam.toUpperCase() as 'H1' | 'H2';
            
            if (isNaN(year) || (halfYear !== 'H1' && halfYear !== 'H2')) {
                return NextResponse.json(
                    { error: 'Invalid parameters. year must be a number, halfYear must be H1 or H2' },
                    { status: 400 }
                );
            }
            
            period = { year, halfYear };
        }
        
        console.log(`[AMFI Sync] Starting sync for period: ${period ? `${period.year}_${period.halfYear}` : 'current'}`);
        
        const result = await fullAMFISync(period);
        
        return NextResponse.json({
            success: true,
            ...result,
            message: `Successfully synced ${result.total} stock classifications for period ${result.period}`
        });
    } catch (error) {
        console.error('[AMFI Sync] Error:', error);
        return NextResponse.json(
            { 
                error: 'Failed to sync AMFI data', 
                details: error instanceof Error ? error.message : String(error) 
            },
            { status: 500 }
        );
    }
}
