/**
 * Upstox Authentication Service
 *
 * Uses the Analytics Token — a long-lived (1-year) read-only token.
 * The token can be configured either:
 *   1. Via the Settings page, which stores it in the `AppConfig` table
 *      under the key `UPSTOX_ANALYTICS_TOKEN` (takes priority), or
 *   2. Via the `UPSTOX_ANALYTICS_TOKEN` environment variable (fallback).
 * Falls back to DB-stored OAuth tokens if neither is present (legacy support).
 *
 * NOTE: External consumers should import token functions from '@/lib/upstox-client'
 * which re-exports everything from this file. This module is the internal implementation.
 */

import { prisma } from '../db';
import { TokenStatus, TokenExpiredError, NoTokenError } from './types';

// ============================================================================
// Analytics Token (Long-lived; DB-configured with env var fallback)
// ============================================================================

/** AppConfig key under which the Settings page stores the analytics token. */
export const ANALYTICS_TOKEN_CONFIG_KEY = 'UPSTOX_ANALYTICS_TOKEN';

interface AnalyticsTokenCache {
  value: string | null;
  source: 'settings' | 'env' | null;
  cachedAt: number;
}

let analyticsTokenCache: AnalyticsTokenCache | null = null;
const ANALYTICS_TOKEN_CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Clear the analytics token cache. Call this after the token is changed via
 * the Settings page so the new value is picked up immediately.
 */
export function clearAnalyticsTokenCache(): void {
  analyticsTokenCache = null;
}

/**
 * Resolve the analytics token, preferring the value configured via the Settings
 * page (AppConfig) over the environment variable. Returns `null` when neither
 * is configured. Result is briefly cached to avoid a DB hit on every request.
 */
async function resolveAnalyticsToken(): Promise<AnalyticsTokenCache> {
  const now = Date.now();
  if (analyticsTokenCache && now - analyticsTokenCache.cachedAt < ANALYTICS_TOKEN_CACHE_TTL_MS) {
    return analyticsTokenCache;
  }

  let value: string | null = null;
  let source: 'settings' | 'env' | null = null;

  try {
    const cfg = await prisma.appConfig.findUnique({
      where: { key: ANALYTICS_TOKEN_CONFIG_KEY },
    });
    if (cfg?.value) {
      value = cfg.value;
      source = 'settings';
    }
  } catch {
    // DB unavailable — fall through to env var.
  }

  if (!value && process.env.UPSTOX_ANALYTICS_TOKEN) {
    value = process.env.UPSTOX_ANALYTICS_TOKEN;
    source = 'env';
  }

  analyticsTokenCache = { value, source, cachedAt: now };
  return analyticsTokenCache;
}

/**
 * Check if an Analytics Token is configured (via Settings or env var).
 */
export async function hasAnalyticsToken(): Promise<boolean> {
  const { value } = await resolveAnalyticsToken();
  return !!value;
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
  const { value: analyticsToken } = await resolveAnalyticsToken();
  if (analyticsToken) {
    return analyticsToken;
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
        console.log(`[Upstox Auth] New token detected (ID: ${token.id}), updating cache`);
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
    console.error('[Upstox Auth] Error fetching stored token:', error);
    return null;
  }
}

/**
 * Get access token - throws if not available
 */
export async function getAccessToken(): Promise<string> {
  const { value: analyticsToken } = await resolveAnalyticsToken();
  if (analyticsToken) {
    return analyticsToken;
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
  const { value: analyticsToken } = await resolveAnalyticsToken();
  if (analyticsToken) {
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
  const { value: analyticsToken, source } = await resolveAnalyticsToken();
  if (analyticsToken) {
    return {
      hasToken: true,
      isAnalyticsToken: true,
      expiresAt: null,
      hoursRemaining: null,
      isExpiringSoon: false,
      statusMessage: source === 'settings'
        ? 'Analytics Token active (configured in Settings, read-only)'
        : 'Analytics Token active (read-only, 1-year validity)',
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
export async function validateConfig(): Promise<{ valid: boolean; missing: string[] }> {
  const { value: analyticsToken } = await resolveAnalyticsToken();
  if (analyticsToken) {
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
