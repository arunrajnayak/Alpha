import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clearTokenCache } from '@/lib/upstox-client';

/**
 * Upstox OAuth Callback
 * 
 * Receives the authorization code from Upstox after user login,
 * exchanges it for an access token, and stores it in the database.
 */

export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get('code');
    const error = request.nextUrl.searchParams.get('error');
    const errorDescription = request.nextUrl.searchParams.get('error_description');

    // Handle OAuth errors
    if (error) {
        console.error('[Upstox Callback] OAuth error:', error, errorDescription);
        return NextResponse.redirect(
            new URL(`/?auth_error=${encodeURIComponent(errorDescription || error)}`, request.url)
        );
    }

    if (!code) {
        console.error('[Upstox Callback] No authorization code received');
        return NextResponse.redirect(
            new URL('/?auth_error=No authorization code received', request.url)
        );
    }

    const apiKey = process.env.UPSTOX_API_KEY;
    const apiSecret = process.env.UPSTOX_API_SECRET;
    const redirectUri = process.env.UPSTOX_REDIRECT_URI;

    if (!apiKey || !apiSecret || !redirectUri) {
        console.error('[Upstox Callback] Missing environment variables');
        return NextResponse.redirect(
            new URL('/?auth_error=Server configuration error', request.url)
        );
    }

    try {
        console.log('[Upstox Callback] Exchanging code for token...');

        // Exchange authorization code for access token
        const tokenResponse = await fetch('https://api.upstox.com/v2/login/authorization/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: new URLSearchParams({
                code,
                client_id: apiKey,
                client_secret: apiSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('[Upstox Callback] Token exchange failed:', tokenData);
            return NextResponse.redirect(
                new URL(`/?auth_error=${encodeURIComponent(tokenData.message || 'Token exchange failed')}`, request.url)
            );
        }

        console.log('[Upstox Callback] Token received successfully');

        // Extract token data
        const accessToken = tokenData.access_token;
        const expiresIn = tokenData.expires_in || 86400; // Default 24 hours
        const userId = tokenData.user_id || 'unknown';

        // Calculate expiry time
        const now = new Date();
        const expiresAt = new Date(now.getTime() + expiresIn * 1000);

        // Store token in database
        const token = await prisma.upstoxToken.create({
            data: {
                accessToken,
                expiresAt,
                issuedAt: now,
                userId,
            },
        });

        console.log(`[Upstox Callback] Token stored (ID: ${token.id}), expires: ${expiresAt.toISOString()}`);

        // Clear token cache so new token is used immediately
        clearTokenCache();

        // Clean up old tokens (keep only latest 5)
        const oldTokens = await prisma.upstoxToken.findMany({
            orderBy: { createdAt: 'desc' },
            skip: 5,
        });

        if (oldTokens.length > 0) {
            await prisma.upstoxToken.deleteMany({
                where: { id: { in: oldTokens.map(t => t.id) } },
            });
            console.log(`[Upstox Callback] Cleaned up ${oldTokens.length} old tokens`);
        }

        // Redirect to home with success message
        return NextResponse.redirect(
            new URL('/?auth_success=true', request.url)
        );

    } catch (err) {
        console.error('[Upstox Callback] Error:', err);
        return NextResponse.redirect(
            new URL(`/?auth_error=${encodeURIComponent('Failed to process authentication')}`, request.url)
        );
    }
}
