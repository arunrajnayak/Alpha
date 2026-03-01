/**
 * Market Data Streaming API Route (SSE)
 * 
 * Uses Custom UpstoxStreamerClient to stream real-time market data
 * to the client via Server-Sent Events.
 */

import { NextRequest } from 'next/server';
import { getStoredToken } from '@/lib/upstox-client';
import { getInstrumentKeys } from '@/lib/instrument-service';
import { computePortfolioState } from '@/lib/finance';
import { UpstoxStreamerClient } from '@/lib/upstox-streamer-client';
import { UpstoxFeedResponse, UpstoxFeedData } from '@/types/upstox-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Global State to manage singleton streamer
interface MarketState {
    instance: UpstoxStreamerClient | null;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    clients: Set<ReadableStreamDefaultController>;
    latestPrices: Map<string, { price: number; timestamp: number }>;
    lastError: string | null;
}

// Global singleton declaration to survive hot reloads in dev
const globalForMarket = global as unknown as { marketState: MarketState };

const state: MarketState = globalForMarket.marketState || {
    instance: null,
    status: 'disconnected',
    clients: new Set(),
    latestPrices: new Map(),
    lastError: null
};

if (process.env.NODE_ENV !== 'production') globalForMarket.marketState = state;

// Helper to notify all connected clients
function notifyClients(data: Record<string, unknown>) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);

    for (const client of state.clients) {
        try {
            client.enqueue(encoded);
        } catch {
            state.clients.delete(client);
        }
    }
}

// Ensure streamer is running
async function ensureStreamer(instrumentKeys: string[], accessToken: string) {
    if (state.instance) {
        // If already connected, maybe update subscription? 
        // For simplicity, we assume one set of keys for now.
        return;
    }

    if (state.status === 'connecting') return;

    try {
        state.status = 'connecting';
        console.log(`[MarketStream] Connecting with ${instrumentKeys.length} instruments...`);

        const streamer = new UpstoxStreamerClient({
            accessToken,
            instrumentKeys,
            mode: 'full'
        });

        // Event: Connected
        streamer.on('open', () => {
            state.status = 'connected';
            state.lastError = null;
            console.log('[MarketStream] Connection established');
            
            notifyClients({ 
                type: 'status', 
                status: 'connected',
                instrumentCount: instrumentKeys.length
            });
        });

        // Event: Disconnected
        streamer.on('close', () => {
            state.status = 'disconnected';
            console.log('[MarketStream] Connection closed');
            state.instance = null; // Allow recreation
            
            notifyClients({ type: 'status', status: 'disconnected' });
        });

        // Event: Error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamer.on('error', (err: any) => {
            state.status = 'error';
            state.lastError = err.message || 'Unknown stream error';
            console.error('[MarketStream] Stream Error:', err.message);
            
            notifyClients({ type: 'error', message: err.message });
        });

        // Event: Message (Market Data)
        streamer.on('message', (feedResponse: UpstoxFeedResponse) => {
            if (feedResponse.feeds) {
                const updates = [];

                for (const [key, feed] of Object.entries(feedResponse.feeds)) {
                    const f = feed as UpstoxFeedData;
                    
                    // Logic to extract Price (LTP) from Full Feed or LTPC
                    let price = 0;
                    let ts = Date.now();
                    
                    if (f.ff?.marketFF?.ltpc?.ltp) {
                        price = f.ff.marketFF.ltpc.ltp;
                        ts = parseInt(f.ff.marketFF.ltpc.ltt) || ts;
                    } else if (f.ltpc?.ltp) {
                        price = f.ltpc.ltp;
                        ts = parseInt(f.ltpc.ltt) || ts;
                    }
                    
                    if (price > 0) {
                        // We need to map Key -> Symbol. 
                        // Since we don't have the map here easily without `getInstrumentKeys` reverse lookup,
                        // and `getInstrumentKeys` returns just a Map<Symbol, Key>.
                        // We might need to store the reverse map or trust the client to map it?
                        // Actually, the client knows the symbol. But the feed keys are complex strings like "NSE_EQ|INE..."
                        
                        // FIX: We need to broadcast the KEY if we can't map to symbol efficiently, 
                        // or we reconstruct the map.
                        // Ideally we broadcast { symbol: 'RELIANCE', ltp: 2500 }.
                        // But `getInstrumentKeys` is async.
                        
                        if (price > 0) {
                            updates.push({
                                key,
                                ltp: price,
                                timestamp: ts
                            });
                            console.log(`[StreamDebug] Pushing update: ${key} -> ${price}`);
                        } else {
                            console.warn(`[StreamDebug] Ignoring zero/negative price for ${key}: ${price}`);
                        }

                        // state.latestPrices.set(key, { price, timestamp: ts });
                    }
                }
                
                if (updates.length > 0) {
                    notifyClients({ type: 'price_update', updates: updates });
                }
            }
        });

        await streamer.connect();
        state.instance = streamer;

    } catch (e: unknown) {
        state.status = 'error';
        state.lastError = e instanceof Error ? e.message : 'Unknown error';
        state.instance = null;
        console.error('[MarketStream] Setup Failure:', e);
    }
}

export async function GET(request: NextRequest) {
    // 1. Auth Check
    const accessToken = await getStoredToken();
    if (!accessToken) {
        return new Response(JSON.stringify({ error: 'No valid Upstox token' }), { status: 401 });
    }

    // 2. Determine Instruments (from Portfolio)
    // We do this every connection to ensure we track current portfolio
    const engine = await computePortfolioState(new Date());
    const holdings = Array.from(engine.holdings.values()).filter(h => h.qty > 0.01);
    const symbols = holdings.map(h => h.symbol);
    
    // Always include indices
    const indices = ['Nifty 50', 'Nifty Bank', 'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 250'];
    const allSymbols = Array.from(new Set([...symbols, ...indices])); // specific indices might need mapping

    const keyMap = await getInstrumentKeys(allSymbols);
    const keys = Array.from(keyMap.values());

    if (keys.length === 0) {
         // KeepAlive stream even if empty
    } else {
        // Initialize Streamer if needed
        // Note: passing keys here only works for valid singleton init. 
        // If instruments change significantly, we might need logic to update subscription.
        // For now, simpler is better.
        ensureStreamer(keys, accessToken).catch(e => console.error(e));
    }

    // 3. Setup SSE Stream
    const stream = new ReadableStream({
        start(controller) {
            state.clients.add(controller);

            const encoder = new TextEncoder();
            
            // Send initial connection status
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                type: 'connected', 
                status: state.status,
                instrumentCount: keys.length
            })}\n\n`));

            // Send Symbol-Key Map to help frontend map keys back to symbols
            // This is critical since we send updates by Key now
            const mapObj: Record<string, string> = {};
            for (const [sym, k] of keyMap.entries()) {
                mapObj[k] = sym;
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'map',
                map: mapObj
            })}\n\n`));

            // Keep-Alive
            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': heartbeat\n\n'));
                } catch {
                    clearInterval(keepAlive);
                    state.clients.delete(controller);
                }
            }, 15000); // 15s heartbeat

            // Clean up on close
            request.signal.addEventListener('abort', () => {
                clearInterval(keepAlive);
                state.clients.delete(controller);
                controller.close();
            });
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
