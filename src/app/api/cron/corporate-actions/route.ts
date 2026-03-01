/**
 * Corporate Actions Sync Cron Job
 * 
 * Runs daily at 5 AM IST (23:30 UTC) to sync corporate actions from NSE.
 * 
 * This cron will:
 * 1. Fetch corporate actions from NSE API for the last 30 days + next 30 days
 * 2. Filter for portfolio symbols only
 * 3. Parse and identify SPLIT and BONUS actions
 * 4. Record new actions to the database
 * 5. Trigger portfolio recalculation if any actions were added
 */

import { NextRequest, NextResponse } from 'next/server';
import { processNSECorporateActions } from '@/lib/corporate-actions';
import { verifyCronSecret } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    const startTime = Date.now();
    console.log('[Corporate Actions Cron] Starting daily sync...');
    
    try {
        const result = await processNSECorporateActions();
        
        console.log(`[Corporate Actions Cron] Completed: ${result.message}`);
        
        return NextResponse.json({
            ...result,
            durationMs: Date.now() - startTime
        }, { status: result.success ? 200 : 500 });
        
    } catch (error) {
        console.error('[Corporate Actions Cron] Error:', error);
        return NextResponse.json({
            success: false,
            error: 'Corporate actions sync failed',
            details: (error as Error).message,
            durationMs: Date.now() - startTime
        }, { status: 500 });
    }
}
