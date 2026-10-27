import { NextRequest, NextResponse } from 'next/server';
import { exchangeKiteRequestToken } from '@/lib/kite-client';
import { logger } from '@/lib/logger';

const kiteAuthLogger = logger.scope('KiteAuthCallback');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const requestToken = searchParams.get('request_token');
    const status = searchParams.get('status');
    const action = searchParams.get('action');

    const redirectUrl = new URL('/settings', req.nextUrl.origin);

    if (status === 'cancelled' || action === 'cancelled') {
        redirectUrl.searchParams.set('zerodha_error', 'Zerodha login was cancelled.');
        return NextResponse.redirect(redirectUrl);
    }

    if (!requestToken) {
        const errorMsg = searchParams.get('message') || 'No request token received from Zerodha.';
        kiteAuthLogger.error('Kite callback error:', errorMsg);
        redirectUrl.searchParams.set('zerodha_error', errorMsg);
        return NextResponse.redirect(redirectUrl);
    }

    try {
        const token = await exchangeKiteRequestToken(requestToken);
        kiteAuthLogger.info(`Successfully authenticated Zerodha user: ${token.userId}`);
        redirectUrl.searchParams.set('zerodha_connected', 'true');
        redirectUrl.searchParams.set('zerodha_user', token.userName || token.userId);
        return NextResponse.redirect(redirectUrl);
    } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Failed to authenticate with Zerodha';
        kiteAuthLogger.error('Failed to exchange Kite request token:', errMessage);
        redirectUrl.searchParams.set('zerodha_error', errMessage);
        return NextResponse.redirect(redirectUrl);
    }
}
