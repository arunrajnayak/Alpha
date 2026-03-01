import { NextResponse } from 'next/server';

/**
 * Verify that a cron/admin API request has the correct secret.
 * 
 * If CRON_SECRET is set in the environment, this function checks for it in:
 *   1. Query param: ?secret=...
 *   2. Header: Authorization: Bearer ...
 * 
 * If CRON_SECRET is NOT set, all requests are allowed (dev convenience).
 * 
 * @returns null if authorized, or a 401 NextResponse to return immediately
 */
export function verifyCronSecret(request: Request): NextResponse | null {
    const cronSecret = process.env.CRON_SECRET;

    // If no CRON_SECRET is configured, allow all requests (dev mode)
    if (!cronSecret) {
        return null;
    }

    // Check query param
    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret');
    if (querySecret === cronSecret) {
        return null;
    }

    // Check Authorization header
    const authHeader = request.headers.get('authorization');
    if (authHeader === `Bearer ${cronSecret}`) {
        return null;
    }

    console.warn(`[CronAuth] Unauthorized request to ${url.pathname}`);
    return NextResponse.json(
        { error: 'Unauthorized. Provide ?secret= or Authorization: Bearer header.' },
        { status: 401 }
    );
}
