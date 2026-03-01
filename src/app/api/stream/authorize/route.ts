/**
 * WebSocket Authorization API
 * 
 * Returns the authorized WebSocket URL for direct client connection to Upstox,
 * along with instrument mappings for the current portfolio.
 * 
 * The frontend uses this URL to connect directly to Upstox WebSocket,
 * bypassing the need for a server-side proxy (which doesn't work well with serverless).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getWebSocketAuthUrl, getInstrumentKeys } from '@/lib/upstox';
import { INDEX_KEYS } from '@/lib/upstox/client';

export const dynamic = 'force-dynamic';

interface AuthorizeResponse {
  authorizedUrl: string;
  instrumentKeys: string[];
  symbolMap: Record<string, string>; // instrumentKey -> symbol
  indices: string[];
}

export async function GET(): Promise<NextResponse<AuthorizeResponse | { error: string }>> {
  try {
    // Get WebSocket authorization URL from Upstox
    const authorizedUrl = await getWebSocketAuthUrl();

    // Get current portfolio holdings to determine which instruments to subscribe
    const holdings = await prisma.transaction.groupBy({
      by: ['symbol'],
      _sum: { quantity: true },
      having: {
        quantity: { _sum: { gt: 0 } },
      },
    });

    const holdingSymbols = holdings.map((h) => h.symbol);

    // Get instrument keys for holdings
    const keyMap = await getInstrumentKeys(holdingSymbols);

    // Build the response
    const instrumentKeys: string[] = [];
    const symbolMap: Record<string, string> = {};

    for (const [symbol, key] of keyMap.entries()) {
      instrumentKeys.push(key);
      symbolMap[key] = symbol;
    }

    // Add index keys for benchmark comparison
    const indexKeys = [
      INDEX_KEYS['Nifty 50'],
      INDEX_KEYS['Nifty Midcap 100'],
      INDEX_KEYS['Nifty Smallcap 250'],
      INDEX_KEYS['Nifty Microcap 250'],
      INDEX_KEYS['Nifty 500 Momentum 50'],
    ].filter(Boolean) as string[];

    for (const key of indexKeys) {
      if (!instrumentKeys.includes(key)) {
        instrumentKeys.push(key);
      }
    }

    return NextResponse.json({
      authorizedUrl,
      instrumentKeys,
      symbolMap,
      indices: indexKeys,
    });
  } catch (error) {
    console.error('[Stream Authorize] Error:', error);

    const message = error instanceof Error ? error.message : 'Failed to authorize WebSocket';

    // Return appropriate status code based on error type
    const status = message.includes('token') || message.includes('401') ? 401 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
