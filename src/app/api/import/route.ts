import { NextRequest, NextResponse } from 'next/server';
import { ingestZerodhaTradesWithProgress } from '@/lib/import-service';

export async function POST(req: NextRequest) {
    const formData = await req.formData();
    
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Start background processing
    (async () => {
        try {
            await ingestZerodhaTradesWithProgress(formData, (message, progress) => {
                const data = JSON.stringify({ message, progress });
                // SSE format: "data: ... \n\n"
                writer.write(encoder.encode(`data: ${data}\n\n`));
            });
            
            // Completion message
            writer.write(encoder.encode(`data: ${JSON.stringify({ message: "Done", progress: 100, done: true })}\n\n`));
        } catch (error) {
            console.error("Import API Error:", error);
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
