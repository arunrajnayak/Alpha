import { NextRequest, NextResponse } from 'next/server';
import { getLiveDashboardData, saveIntradayPnL } from '@/app/actions/live';
import { isMarketOpenAsync } from '@/lib/marketHours';
import { verifyCronSecret } from '@/lib/cron-auth';
import { apiLogger } from '@/lib/logger';

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
            apiLogger.info('Market is closed, skipping');
            return NextResponse.json({
                status: 'skipped',
                reason: 'Market is closed'
            });
        }

        // Fetch current portfolio data
        apiLogger.info('Fetching live dashboard data...');
        const dashboardData = await getLiveDashboardData();
        
        // Extract benchmark index % changes (same logic as LiveDataContext)
        const nifty50Percent = dashboardData.indices.find(i => i.name === 'Nifty 50')?.percentChange ?? null;
        const n500m50Percent = dashboardData.indices.find(i => i.name === 'Nifty 500')?.percentChange ?? null;

        // Save P/L + index benchmarks to database
        await saveIntradayPnL(dashboardData.dayGain, dashboardData.dayGainPercent, nifty50Percent, n500m50Percent);
        
        apiLogger.info(`Recorded P/L: ₹${dashboardData.dayGain.toFixed(2)} (${dashboardData.dayGainPercent.toFixed(2)}%) | Nifty50: ${nifty50Percent?.toFixed(2)}% | N500M50: ${n500m50Percent?.toFixed(2)}%`);

        return NextResponse.json({
            status: 'success',
            dayGain: dashboardData.dayGain,
            dayGainPercent: dashboardData.dayGainPercent,
            nifty50Percent,
            n500m50Percent,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        apiLogger.error('Error:', error);
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
