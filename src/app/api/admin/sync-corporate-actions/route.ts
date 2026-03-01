/**
 * Admin endpoint to sync corporate actions from NSE for a custom date range
 * 
 * Usage: GET /api/admin/sync-corporate-actions?from=2024-08-11&to=2026-01-28
 */

import { NextRequest, NextResponse } from 'next/server';
import { processNSECorporateActions } from '@/lib/corporate-actions';
import { verifyCronSecret } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    
    // Parse dates
    const fromDate = fromParam ? new Date(fromParam) : undefined;
    const toDate = toParam ? new Date(toParam) : undefined;
    
    // Validate dates
    if (fromParam && isNaN(fromDate!.getTime())) {
        return NextResponse.json({ error: 'Invalid from date' }, { status: 400 });
    }
    if (toParam && isNaN(toDate!.getTime())) {
        return NextResponse.json({ error: 'Invalid to date' }, { status: 400 });
    }
    
    const startTime = Date.now();
    console.log(`[Admin] Syncing corporate actions from ${fromParam || 'default'} to ${toParam || 'default'}...`);
    
    try {
        const result = await processNSECorporateActions(fromDate, toDate);
        
        return NextResponse.json({
            ...result,
            durationMs: Date.now() - startTime
        }, { status: result.success ? 200 : 500 });
        
    } catch (error) {
        console.error('[Admin] Corporate actions sync failed:', error);
        return NextResponse.json({
            success: false,
            error: 'Sync failed',
            details: (error as Error).message,
            durationMs: Date.now() - startTime
        }, { status: 500 });
    }
}
