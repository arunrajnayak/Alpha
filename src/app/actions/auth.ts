'use server';

import { getTokenStatus } from '@/lib/upstox/auth';
import type { TokenStatus } from '@/lib/upstox/types';

/**
 * Get current Upstox token status
 */
export async function getUpstoxTokenStatus(): Promise<TokenStatus> {
  return getTokenStatus();
}

/**
 * Trigger phone notification for Upstox authentication
 * This calls the cron endpoint which sends a push notification to the user's phone
 */
export async function triggerPhoneAuth(): Promise<{ success: boolean; message: string }> {
  try {
    // Get the base URL from environment or use relative URL
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Trigger the cron endpoint with manual=true flag
    const headers: Record<string, string> = {};
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      headers['Authorization'] = `Bearer ${cronSecret}`;
    }

    const response = await fetch(`${baseUrl}/api/cron/request-upstox-token?manual=true`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Auth] Phone auth trigger failed:', response.status, errorText);
      return {
        success: false,
        message: `Failed to trigger authentication: ${response.status}`,
      };
    }

    const result = await response.json();
    
    return {
      success: true,
      message: result.message || 'Authentication notification sent to your phone',
    };
  } catch (error) {
    console.error('[Auth] Error triggering phone auth:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger authentication',
    };
  }
}

/**
 * Get the browser login URL for Upstox OAuth
 */
export async function getLoginUrl(): Promise<string> {
  return '/api/upstox/login';
}
