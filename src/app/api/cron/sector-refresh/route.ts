import { NextResponse } from 'next/server';
import { refreshSectorMappings } from '@/app/actions/sectors';
import { verifyCronSecret } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for scraping

/**
 * Cron endpoint to refresh sector mappings from Zerodha
 * Scheduled monthly via cron scheduler
 * 
 * GET /api/cron/sector-refresh
 */
export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  console.log('[Sector Cron] Starting monthly sector refresh...');
  
  try {
    const result = await refreshSectorMappings();
    
    if (result.success) {
      console.log(`[Sector Cron] Success: ${result.count} stocks mapped`);
      return NextResponse.json({ 
        success: true, 
        count: result.count,
        message: `Refreshed ${result.count} sector mappings`
      });
    } else {
      console.error('[Sector Cron] Failed:', result.error);
      return NextResponse.json({ 
        success: false, 
        error: result.error 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[Sector Cron] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}
