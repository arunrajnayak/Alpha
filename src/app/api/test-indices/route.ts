import { NextResponse } from 'next/server';
import { getIndexQuotes, getLiveQuoteV3, INDEX_KEYS } from '@/lib/upstox-client';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const indexKeys = Object.values(INDEX_KEYS).slice(0, 5);
        
        console.log('[TestIndices] Requesting keys:', indexKeys);
        
        // Test raw LTP V3 response
        const rawQuotes = await getLiveQuoteV3(indexKeys);
        console.log('[TestIndices] Raw LTP V3 response keys:', Array.from(rawQuotes.keys()));
        
        // Test the getIndexQuotes function
        const indices = await getIndexQuotes();
        console.log('[TestIndices] getIndexQuotes returned:', indices.length, 'indices');
        
        return NextResponse.json({
            requested: indexKeys,
            rawQuotesCount: rawQuotes.size,
            rawQuoteKeys: Array.from(rawQuotes.keys()),
            rawQuotes: Object.fromEntries(rawQuotes),
            indices,
        });
    } catch (error) {
        console.error('[TestIndices] Error:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
