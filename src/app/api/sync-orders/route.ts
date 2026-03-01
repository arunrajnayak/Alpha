import { NextRequest, NextResponse } from 'next/server';
import { ingestOrdersWithDeduplication, type KiteOrder } from '@/lib/import-service';
import { verifyCronSecret } from '@/lib/cron-auth';

export const maxDuration = 300; // 5 minutes timeout for Vercel

/**
 * API Route: /api/sync-orders
 * 
 * Syncs orders from Zerodha Kite.
 * 
 * This route accepts orders data directly in the request body.
 * The Kite authentication and order fetching should be done by the cron script
 * or a separate process, then POSTed here.
 * 
 * For on-demand sync from the UI, users should:
 * 1. Run the cron script manually, OR
 * 2. Use the cron scheduler endpoint (GET), OR
 * 3. POST orders data directly if obtained through other means
 * 
 * Query params:
 * - source: 'cron' | 'manual' (optional, for logging)
 */
export async function POST(req: NextRequest) {
    const authError = verifyCronSecret(req);
    if (authError) return authError;

    const source = req.nextUrl.searchParams.get('source') || 'manual';
    
    try {
        // Check if this is a direct POST with orders data
        const contentType = req.headers.get('content-type');
        
        if (contentType?.includes('application/json')) {
            // Direct POST with orders data
            const body = await req.json();
            const orders = body.orders as KiteOrder[];
            
            if (!orders || !Array.isArray(orders) || orders.length === 0) {
                return NextResponse.json(
                    { error: 'No orders provided. Send { orders: [...] }' },
                    { status: 400 }
                );
            }
            
            console.log(`[SyncOrders] Received ${orders.length} orders (source: ${source})`);
            
            const result = await ingestOrdersWithDeduplication(
                orders,
                `kite-sync-${source}`
            );

            return NextResponse.json({
                success: true,
                message: `Synced ${result.synced} orders, skipped ${result.skipped} duplicates.`,
                synced: result.synced,
                skipped: result.skipped,
                batchId: result.batchId
            });
        }
        
        // SSE response for streaming progress (triggered from frontend without body)
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();
        const encoder = new TextEncoder();

        const sendProgress = async (message: string, progress: number, done?: boolean, error?: string) => {
            const data = JSON.stringify({ message, progress, done, error });
            await writer.write(encoder.encode(`data: ${data}\n\n`));
        };

        // Background processing
        (async () => {
            try {
                // Check for GITHUB_PAT to trigger workflow
                const GITHUB_PAT = process.env.GITHUB_PAT;
                const REPO_OWNER = process.env.VERCEL_GIT_REPO_OWNER;
                const REPO_NAME = process.env.VERCEL_GIT_REPO_SLUG;
                
                if (GITHUB_PAT && REPO_OWNER && REPO_NAME) {
                     await sendProgress('Authentication: GITHUB_PAT found.', 30);
                     await sendProgress(`Triggering workflow on ${REPO_OWNER}/${REPO_NAME}...`, 50);
                     
                     const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/sync-orders.yml/dispatches`, {
                         method: 'POST',
                         headers: {
                             'Accept': 'application/vnd.github+json',
                             'Authorization': `Bearer ${GITHUB_PAT}`,
                             'X-GitHub-Api-Version': '2022-11-28'
                         },
                         body: JSON.stringify({
                             ref: 'main'
                         })
                     });
                     
                     if (response.ok) {
                         await sendProgress('Success! GitHub Action triggered.', 90);
                         await sendProgress('Orders will sync shortly.', 100, true);
                     } else {
                         const errorText = await response.text();
                         console.error('GitHub API Error:', errorText);
                         await sendProgress(`Failed to trigger: ${response.statusText}`, 90);
                         await sendProgress('See logs for details.', 100, true);
                     }
                } else {
                    await sendProgress('Environment: Serverless (No Browser Access).', 30);
                    await sendProgress('NOTE: Automated sync runs daily via GitHub Actions.', 60);
                    await sendProgress('To enable UI trigger: Add GITHUB_PAT to env vars.', 90);
                    await sendProgress('Currently: Run workflow manually in GitHub.', 100, true);
                }
            } catch (error) {
                console.error('Background processing error:', error);
                await sendProgress('Error during background processing.', 100, true, String(error));
            } finally {
                await writer.close();
            }
        })();

        return new NextResponse(stream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        console.error('[SyncOrders] Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

// GET handler - returns instructions for cron setup
export async function GET(req: NextRequest) {
    const source = req.nextUrl.searchParams.get('source');
    
    // If called with source=cron, this is from an external cron scheduler
    // But we can't run puppeteer on Vercel serverless, so we return instructions
    if (source === 'cron') {
        return NextResponse.json({
            success: false,
            error: 'Puppeteer-based Kite auth cannot run on serverless. Use the CLI script instead.',
            instructions: [
                'Run the cron script manually or via system cron:',
                'npx tsx src/scripts/zerodha-cron.ts',
                '',
                'Or schedule it with crontab:',
                '40 15 * * 1-5 cd /path/to/Alpha && npx tsx src/scripts/zerodha-cron.ts'
            ]
        }, { status: 501 });
    }
    
    return NextResponse.json({
        endpoint: '/api/sync-orders',
        description: 'Sync orders from Zerodha Kite',
        usage: {
            'POST with orders': 'POST /api/sync-orders with body { orders: [...] }',
            'Cron script': 'npx tsx src/scripts/zerodha-cron.ts'
        },
        note: 'Kite authentication requires Puppeteer which cannot run on serverless. Use the CLI script for automated syncing.'
    });
}
