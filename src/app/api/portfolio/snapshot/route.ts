
import { NextResponse } from 'next/server';
import { recalculatePortfolioHistory, captureWeeklySnapshot, captureMonthlySnapshot, captureHolidaySnapshot } from '@/lib/finance';
import { getMarketStatus } from '@/lib/market-holidays-cache';
import { addMinutes, isAfter, startOfDay } from 'date-fns';
import { prisma } from '@/lib/db';
import { verifyCronSecret } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const rawType = searchParams.get('type');
        const type = rawType === 'month' ? 'monthly' : rawType;
        const force = searchParams.get('force') === 'true';

        if (type === 'weekly') {
            await captureWeeklySnapshot();
            return NextResponse.json({ message: 'Weekly snapshot captured' });
        } else if (type === 'monthly') {
            await captureMonthlySnapshot();
            return NextResponse.json({ message: 'Monthly snapshot captured' });
        } else {
            // Default to daily logic
            if (force) {
                await recalculatePortfolioHistory();
                return NextResponse.json({ message: 'Daily history recalculated (Forced)' });
            }

            // SMART TRIGGER LOGIC
            const status = await getMarketStatus();
            
            // If market WAS open today (indicated by closeTime existing), check if we're past buffer
            if (status.closeTime) {
                const triggerTime = addMinutes(status.closeTime, 15);
                
                // Check if we are past close time + 15m
                if (isAfter(new Date(), triggerTime)) {
                    // IDEMPOTENCY CHECK: Skip if today's snapshot already exists
                    const todayStart = startOfDay(new Date());
                    const existingSnapshot = await prisma.dailyPortfolioSnapshot.findFirst({
                        where: { date: { gte: todayStart } },
                        select: { date: true }
                    });
                    if (existingSnapshot) {
                        return NextResponse.json({ 
                            message: 'Skipped: Snapshot already exists for today',
                            date: existingSnapshot.date.toISOString()
                        });
                    }
                    
                    await recalculatePortfolioHistory();
                    return NextResponse.json({ 
                        message: 'Daily history recalculated', 
                        marketStatus: 'Closed',
                        closeTime: status.closeTime.toISOString() 
                     });
                } else {
                    return NextResponse.json({ 
                        message: 'Skipped: Market is still open or within 15m buffer', 
                        marketStatus: status.isOpen ? 'Open' : 'Buffer',
                        triggerTime: triggerTime.toISOString() 
                     });
                }
            } else {
                // Market status API didn't return closeTime
                // FALLBACK: Check if stock prices exist for today - if so, trading DID happen
                const todayStart = startOfDay(new Date());
                const todayPriceExists = await prisma.stockHistory.findFirst({
                    where: { 
                        date: { gte: todayStart }
                    },
                    select: { id: true }
                });
                
                if (todayPriceExists) {
                    // Stock prices exist for today = trading happened
                    // Assume default 3:30 PM close time
                    console.log('[Snapshot] DB fallback: Found stock prices for today, treating as trading day');
                    const defaultCloseTime = new Date();
                    defaultCloseTime.setHours(10, 0, 0, 0); // 3:30 PM IST = 10:00 UTC
                    const triggerTime = addMinutes(defaultCloseTime, 15);
                    
                    if (isAfter(new Date(), triggerTime)) {
                        // Check idempotency
                        const existingSnapshot = await prisma.dailyPortfolioSnapshot.findFirst({
                            where: { date: { gte: todayStart } },
                            select: { date: true }
                        });
                        if (existingSnapshot) {
                            return NextResponse.json({ 
                                message: 'Skipped: Snapshot already exists for today (DB fallback)',
                                date: existingSnapshot.date.toISOString()
                            });
                        }
                        
                        await recalculatePortfolioHistory();
                        return NextResponse.json({ 
                            message: 'Daily history recalculated (DB fallback: special trading session)',
                            marketStatus: 'Closed',
                            note: 'API returned no timings but stock prices exist'
                        });
                    } else {
                        return NextResponse.json({ 
                            message: 'Skipped: Within 15m buffer (DB fallback)',
                            marketStatus: 'Buffer',
                            triggerTime: triggerTime.toISOString() 
                        });
                    }
                }
                
                // No stock prices for today = truly a holiday/weekend
                const reason = status.reason || 'Market Holiday/Weekend';
                
                await captureHolidaySnapshot();
                return NextResponse.json({ 
                    message: `Holiday snapshot captured`, 
                    reason: reason 
                });
            }
        }
    } catch (error: unknown) {
        console.error('Snapshot error:', error);
        const details = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: 'Failed to capture snapshot', details }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { type } = body;

        if (type === 'weekly') {
            await captureWeeklySnapshot();
            return NextResponse.json({ message: 'Weekly snapshot captured' });
        } else if (type === 'monthly') {
            await captureMonthlySnapshot();
            return NextResponse.json({ message: 'Monthly snapshot captured' });
        } else {
            // Default to daily recalculation (history backfill)
            await recalculatePortfolioHistory();
            return NextResponse.json({ message: 'Daily history recalculated' });
        }
    } catch (error: unknown) {
        console.error('Snapshot error:', error);
        const details = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: 'Failed to capture snapshot', details }, { status: 500 });
    }
}
