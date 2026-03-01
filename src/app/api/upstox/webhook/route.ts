import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clearTokenCache } from '@/lib/upstox-client';
import { verifyCronSecret } from '@/lib/cron-auth';

/**
 * Upstox Token Webhook
 * 
 * This endpoint receives access tokens from Upstox after you approve
 * the token request via the mobile notification.
 * 
 * Upstox sends a POST request with the following payload:
 * {
 *   "client_id": "your-api-key",
 *   "user_id": "your-ucc",
 *   "access_token": "the-token",
 *   "token_type": "Bearer",
 *   "expires_at": "1731448800000",
 *   "issued_at": "1731412800000",
 *   "message_type": "access_token"
 * }
 */

interface UpstoxWebhookPayload {
    client_id: string;
    user_id: string;
    access_token: string;
    token_type: string;
    expires_at: string;
    issued_at: string;
    message_type: string;
}

export async function POST(request: NextRequest) {
    // Authenticate the webhook request
    const authError = verifyCronSecret(request);
    if (authError) return authError;

    try {
        const payload: UpstoxWebhookPayload = await request.json();

        console.log('[Upstox Webhook] Received token notification');

        // Validate payload
        if (payload.message_type !== 'access_token') {
            console.log('[Upstox Webhook] Ignoring non-token message');
            return NextResponse.json({ status: 'ignored', reason: 'not an access_token message' });
        }

        if (!payload.access_token) {
            console.error('[Upstox Webhook] Missing access_token in payload');
            return NextResponse.json({ error: 'Missing access_token' }, { status: 400 });
        }

        // Validate client_id matches our app
        const expectedClientId = process.env.UPSTOX_API_KEY;
        if (expectedClientId && payload.client_id !== expectedClientId) {
            console.error('[Upstox Webhook] Client ID mismatch');
            return NextResponse.json({ error: 'Invalid client_id' }, { status: 403 });
        }

        // Replay protection: skip if this exact token already exists
        const existingToken = await prisma.upstoxToken.findFirst({
            where: { accessToken: payload.access_token },
            select: { id: true },
        });
        if (existingToken) {
            console.log('[Upstox Webhook] Duplicate token — already stored');
            return NextResponse.json({ status: 'duplicate', message: 'Token already exists' });
        }

        // Parse timestamps (Upstox sends them as milliseconds string)
        const expiresAt = new Date(parseInt(payload.expires_at, 10));
        const issuedAt = new Date(parseInt(payload.issued_at, 10));

        // Store the token in database
        const token = await prisma.upstoxToken.create({
            data: {
                accessToken: payload.access_token,
                expiresAt,
                issuedAt,
                userId: payload.user_id,
            },
        });

        console.log(`[Upstox Webhook] Token stored successfully (ID: ${token.id})`);
        
        // Clear the in-memory token cache so the new token is used immediately
        clearTokenCache();

        // Clean up old tokens (keep only the latest 5)
        const oldTokens = await prisma.upstoxToken.findMany({
            orderBy: { createdAt: 'desc' },
            skip: 5,
        });

        if (oldTokens.length > 0) {
            await prisma.upstoxToken.deleteMany({
                where: {
                    id: { in: oldTokens.map(t => t.id) },
                },
            });
            console.log(`[Upstox Webhook] Cleaned up ${oldTokens.length} old tokens`);
        }

        return NextResponse.json({
            status: 'success',
            message: 'Token stored successfully',
            expiresAt: expiresAt.toISOString(),
        });

    } catch (error) {
        console.error('[Upstox Webhook] Error processing webhook:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Health check endpoint
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        endpoint: 'Upstox Token Webhook',
        description: 'POST access tokens from Upstox semi-automated auth flow',
    });
}
