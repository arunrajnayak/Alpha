import { NextRequest, NextResponse } from 'next/server';

/**
 * Upstox OAuth Login Redirect
 * 
 * Redirects user to Upstox login page for manual token generation.
 * After login, Upstox redirects back to our callback URL with an auth code.
 */

export async function GET(request: NextRequest) {
    const apiKey = process.env.UPSTOX_API_KEY;
    const redirectUri = process.env.UPSTOX_REDIRECT_URI;

    if (!apiKey) {
        return NextResponse.json(
            { error: 'UPSTOX_API_KEY not configured' },
            { status: 500 }
        );
    }

    if (!redirectUri) {
        return NextResponse.json(
            { error: 'UPSTOX_REDIRECT_URI not configured. Add it to your .env file.' },
            { status: 500 }
        );
    }

    // Build Upstox OAuth URL
    const authUrl = new URL('https://api.upstox.com/v2/login/authorization/dialog');
    authUrl.searchParams.set('client_id', apiKey);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');

    // Optional: Add state parameter for CSRF protection
    const state = request.nextUrl.searchParams.get('state') || crypto.randomUUID();
    authUrl.searchParams.set('state', state);

    console.log('[Upstox Login] Redirecting to:', authUrl.toString());

    return NextResponse.redirect(authUrl.toString());
}
