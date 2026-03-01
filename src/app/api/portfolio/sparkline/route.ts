import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

/**
 * API endpoint to fetch sparkline data for a single symbol.
 * Used by LazySparkline component for on-demand loading.
 */
export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get('symbol');

    if (!symbol) {
        return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    }

    try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const history = await prisma.stockHistory.findMany({
            where: {
                symbol: symbol,
                date: { gte: oneYearAgo }
            },
            orderBy: { date: 'asc' },
            select: { date: true, close: true }
        });

        // Sample to ~52 data points (weekly) for performance
        const step = Math.max(1, Math.floor(history.length / 52));
        const sampled = history
            .filter((_, i) => i % step === 0 || i === history.length - 1)
            .map(h => ({
                date: format(h.date, 'yyyy-MM-dd'),
                close: h.close
            }));

        return NextResponse.json({ 
            data: sampled,
            symbol 
        }, {
            headers: {
                // Cache for 1 hour on CDN, 5 minutes on client
                'Cache-Control': 'public, s-maxage=3600, max-age=300'
            }
        });
    } catch (error) {
        console.error('[Sparkline API] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }
}
