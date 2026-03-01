import { NextRequest, NextResponse } from 'next/server';
import { recalculatePortfolioHistory } from '@/lib/finance';
import { revalidateApp } from '@/app/actions';
import { verifyCronSecret } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
    const authError = verifyCronSecret(req);
    if (authError) return authError;

    let fromDate: Date | undefined;
    
    try {
        const body = await req.json();
        if (body.fromDate) {
            fromDate = new Date(body.fromDate);
        }
    } catch {
        // Ignore JSON parse error, allow empty body
    }

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Start background processing
    (async () => {
        try {
            await recalculatePortfolioHistory(fromDate, (message, progress) => {
                const data = JSON.stringify({ message, progress });
                writer.write(encoder.encode(`data: ${data}\n\n`));
            });
            
            await revalidateApp();
            
            // Completion message
            writer.write(encoder.encode(`data: ${JSON.stringify({ message: "Done", progress: 100, done: true })}\n\n`));
        } catch (error) {
            console.error("Recompute API Error:", error);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            writer.write(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
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
}
