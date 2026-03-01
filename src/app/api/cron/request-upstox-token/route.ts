import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyCronSecret } from '@/lib/cron-auth';

/**
 * Upstox Token Request Cron Job
 * 
 * This endpoint is triggered by an external cron scheduler daily before market open.
 * It calls the Upstox Access Token Request API which sends a push
 * notification to your phone. You approve it, and the token is
 * delivered to the webhook endpoint.
 * 
 * Schedule: 0 3 * * 1-5 (8:30 AM IST, Mon-Fri)
 */

export async function GET(request: NextRequest) {
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    const apiKey = process.env.UPSTOX_API_KEY;
    const apiSecret = process.env.UPSTOX_API_SECRET;

    if (!apiKey || !apiSecret) {
        console.error('[Upstox Cron] Missing UPSTOX_API_KEY or UPSTOX_API_SECRET');
        return NextResponse.json(
            { error: 'Missing Upstox credentials' },
            { status: 500 }
        );
    }

    try {
        // Check if we already have a valid token
        const existingToken = await prisma.upstoxToken.findFirst({
            where: {
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (existingToken) {
            const hoursUntilExpiry = (existingToken.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
            
            // If token is valid for more than 2 hours, skip the request
            if (hoursUntilExpiry > 2) {
                console.log(`[Upstox Cron] Valid token exists, expires in ${hoursUntilExpiry.toFixed(1)} hours`);
                return NextResponse.json({
                    status: 'skipped',
                    reason: 'Valid token exists',
                    expiresAt: existingToken.expiresAt.toISOString(),
                    hoursUntilExpiry: hoursUntilExpiry.toFixed(1),
                });
            }
        }

        console.log('[Upstox Cron] Requesting new access token...');

        // Call Upstox Access Token Request API
        // This sends a notification to the user's phone
        const response = await fetch(
            `https://api.upstox.com/v3/login/auth/token/request/${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_secret: apiSecret,
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error('[Upstox Cron] Token request failed:', data);
            return NextResponse.json(
                {
                    error: 'Token request failed',
                    details: data,
                },
                { status: response.status }
            );
        }

        console.log('[Upstox Cron] Token request sent successfully');
        console.log(`  - Notifier URL: ${data.data?.notifier_url}`);
        console.log(`  - Authorization Expiry: ${data.data?.authorization_expiry}`);

        return NextResponse.json({
            status: 'success',
            message: 'Token request sent. Please approve on your phone.',
            notifierUrl: data.data?.notifier_url,
            authorizationExpiry: data.data?.authorization_expiry,
        });

    } catch (error) {
        console.error('[Upstox Cron] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
    return GET(request);
}
