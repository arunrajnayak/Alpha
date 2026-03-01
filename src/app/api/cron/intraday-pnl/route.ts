import { NextRequest, NextResponse } from 'next/server';
import { getLiveDashboardData, saveIntradayPnL } from '@/app/actions/live';
import { isMarketOpenAsync } from '@/lib/marketHours';
import { verifyCronSecret } from '@/lib/cron-auth';

/**
 * Intraday P/L Recording Cron Job
 * 
 * Records portfolio P/L every minute during market hours.
 * Data is used to display the intraday P/L chart on the dashboard.
 * 
 * Schedule: * 4-10 * * 1-5 (Every minute, 9:30 AM - 4:00 PM IST, Mon-Fri)
 */

export async function GET(request: NextRequest) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    try {
        // Check if market is open
        const isMarketOpen = await isMarketOpenAsync();
        
        if (!isMarketOpen) {
            console.log('[IntradayPnL Cron] Market is closed, skipping');
            return NextResponse.json({
                status: 'skipped',
                reason: 'Market is closed'
            });
        }

        // Fetch current portfolio data
        console.log('[IntradayPnL Cron] Fetching live dashboard data...');
        const dashboardData = await getLiveDashboardData();
        
        // Save P/L to database
        await saveIntradayPnL(dashboardData.dayGain, dashboardData.dayGainPercent);
        
        console.log(`[IntradayPnL Cron] Recorded P/L: ₹${dashboardData.dayGain.toFixed(2)} (${dashboardData.dayGainPercent.toFixed(2)}%)`);

        return NextResponse.json({
            status: 'success',
            dayGain: dashboardData.dayGain,
            dayGainPercent: dashboardData.dayGainPercent,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[IntradayPnL Cron] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: (error as Error).message },
            { status: 500 }
        );
    }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
    return GET(request);
}
