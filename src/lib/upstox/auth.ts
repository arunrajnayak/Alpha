/**
 * Upstox Authentication Service
 *
 * Uses the Analytics Token — a long-lived (1-year) read-only token set via env var.
 * Falls back to DB-stored OAuth tokens if present (legacy support).
 *
 * NOTE: External consumers should import token functions from '@/lib/upstox-client'
 * which re-exports everything from this file. This module is the internal implementation.
 */

import { prisma } from '../db';
import { TokenStatus, TokenExpiredError, NoTokenError } from './types';
import { logger } from '@/lib/logger';

const authLogger = logger.scope('UpstoxAuth');

// ============================================================================
// Analytics Token (Long-lived, env var based)
// ============================================================================

/**
 * Check if Analytics Token is configured
 */
export function hasAnalyticsToken(): boolean {
  return !!process.env.UPSTOX_ANALYTICS_TOKEN;
}

// ============================================================================
// Legacy OAuth Token Cache (Short-lived, DB based)
// ============================================================================

interface TokenCache {
  token: string;
  tokenId: number;
  expiresAt: Date;
  cachedAt: number;
}

let tokenCache: TokenCache | null = null;
const TOKEN_CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Clear the token cache (call when a new token is stored)
 */
export function clearTokenCache(): void {
  tokenCache = null;
}

/**
 * Get the current valid access token
 * Prefers Analytics Token (env var) over legacy DB token
 */
export async function getStoredToken(): Promise<string | null> {
  if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    return process.env.UPSTOX_ANALYTICS_TOKEN;
  }

  const now = Date.now();

  if (
    tokenCache &&
    tokenCache.expiresAt > new Date() &&
    now - tokenCache.cachedAt < TOKEN_CACHE_TTL_MS
  ) {
    return tokenCache.token;
  }

  try {
    const token = await prisma.upstoxToken.findFirst({
      where: {
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (token) {
      if (tokenCache && token.id !== tokenCache.tokenId) {
        authLogger.info(`New token detected (ID: ${token.id}), updating cache`);
      }

      tokenCache = {
        token: token.accessToken,
        tokenId: token.id,
        expiresAt: token.expiresAt,
        cachedAt: now,
      };
      return token.accessToken;
    }

    tokenCache = null;
    return null;
  } catch (error) {
    authLogger.error('Error fetching stored token:', error);
    return null;
  }
}

/**
 * Get access token - throws if not available
 */
export async function getAccessToken(): Promise<string> {
  if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    return process.env.UPSTOX_ANALYTICS_TOKEN;
  }

  const token = await getStoredToken();

  if (!token) {
    try {
      const expiredToken = await prisma.upstoxToken.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (expiredToken) {
        throw new TokenExpiredError(expiredToken.expiresAt);
      }
    } catch (dbError) {
      if (dbError instanceof TokenExpiredError) {
        throw dbError;
      }
    }

    throw new NoTokenError();
  }

  return token;
}

/**
 * Check if we have a valid token
 */
export async function hasValidToken(): Promise<boolean> {
  if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    return true;
  }
  const token = await getStoredToken();
  return token !== null;
}

/**
 * Get token status for UI display
 */
export async function getTokenStatus(): Promise<TokenStatus> {
  // Analytics token — long-lived, no expiry concerns
  if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    return {
      hasToken: true,
      isAnalyticsToken: true,
      expiresAt: null,
      hoursRemaining: null,
      isExpiringSoon: false,
      statusMessage: 'Analytics Token active (read-only, 1-year validity)',
    };
  }

  try {
    const token = await prisma.upstoxToken.findFirst({
      where: {
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (token) {
      const hoursRemaining = (token.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const isExpiringSoon = hoursRemaining < 2;

      let statusMessage = `Token valid for ${hoursRemaining.toFixed(1)} hours`;
      if (isExpiringSoon) {
        statusMessage = `Token expiring soon (${hoursRemaining.toFixed(1)} hours remaining).`;
      }

      return {
        hasToken: true,
        isAnalyticsToken: false,
        expiresAt: token.expiresAt,
        hoursRemaining,
        isExpiringSoon,
        statusMessage,
      };
    }

    return {
      hasToken: false,
      isAnalyticsToken: false,
      expiresAt: null,
      hoursRemaining: null,
      isExpiringSoon: false,
      statusMessage: 'No token found. Set UPSTOX_ANALYTICS_TOKEN in your environment variables.',
    };
  } catch {
    return {
      hasToken: false,
      isAnalyticsToken: false,
      expiresAt: null,
      hoursRemaining: null,
      isExpiringSoon: false,
      statusMessage: 'Error checking token status',
    };
  }
}

/**
 * Validate Upstox configuration
 */
export function validateConfig(): { valid: boolean; missing: string[] } {
  if (process.env.UPSTOX_ANALYTICS_TOKEN) {
    return { valid: true, missing: [] };
  }
  return { valid: false, missing: ['UPSTOX_ANALYTICS_TOKEN'] };
}

/**
 * Get the WebSocket authorization URL for direct client connection
 */
export async function getWebSocketAuthUrl(): Promise<string> {
  const accessToken = await getAccessToken();

  const response = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get WebSocket auth URL: ${response.status} - ${errorText}`);
  }

  const json = await response.json();

  if (json.status === 'success' && json.data?.authorized_redirect_uri) {
    return json.data.authorized_redirect_uri;
  }

  throw new Error('Invalid response from WebSocket authorization endpoint');
}
