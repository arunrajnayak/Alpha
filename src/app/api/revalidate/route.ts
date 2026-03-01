import { NextResponse } from 'next/server';
import { revalidateApp } from '@/app/actions';
import { verifyCronSecret } from '@/lib/cron-auth';

/**
 * POST /api/revalidate
 * 
 * Triggers server-side cache revalidation for all pages and cache tags.
 * Called by the Zerodha cron script after syncing orders, so that
 * all pages (Portfolio, Exits, Dashboard, etc.) reflect new data.
 */
export async function POST(request: Request) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    try {
        await revalidateApp();
        console.log('[Revalidate] Successfully revalidated all pages and cache tags');
        return NextResponse.json({ revalidated: true, timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('[Revalidate] Error:', error);
        return NextResponse.json(
            { error: 'Revalidation failed', details: String(error) },
            { status: 500 }
        );
    }
}
