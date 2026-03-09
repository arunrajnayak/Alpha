/**
 * Upstox Authentication Service
 * 
 * Handles token management with in-memory caching.
 * Tokens are stored in the database and cached for 30 seconds to reduce DB queries.
 * 
 * NOTE: External consumers should import token functions from '@/lib/upstox-client'
 * which re-exports everything from this file. This module is the internal implementation.
 */

import { prisma } from '../db';
import { TokenStatus, TokenExpiredError, NoTokenError } from './types';

// ============================================================================
// Token Cache
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
 * Get the current valid access token from the database
 * Uses in-memory cache to reduce database queries
 */
export async function getStoredToken(): Promise<string | null> {
  const now = Date.now();

  // Check cache first - but with a short TTL
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
      // Check if this is a newer token than what we have cached
      if (tokenCache && token.id !== tokenCache.tokenId) {
        console.log(`[Upstox Auth] New token detected (ID: ${token.id}), updating cache`);
      }

      // Update cache
      tokenCache = {
        token: token.accessToken,
        tokenId: token.id,
        expiresAt: token.expiresAt,
        cachedAt: now,
      };
      return token.accessToken;
    }

    // Clear cache if no valid token found
    tokenCache = null;
    return null;
  } catch (error) {
    console.error('[Upstox Auth] Error fetching stored token:', error);
    return null;
  }
}

/**
 * Get access token - throws if not available
 * Includes helpful error messages for common issues
 */
export async function getAccessToken(): Promise<string> {
  const token = await getStoredToken();

  if (!token) {
    // Check if there's an expired token to provide better error message
    try {
      const expiredToken = await prisma.upstoxToken.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (expiredToken) {
        throw new TokenExpiredError(expiredToken.expiresAt);
      }
    } catch (dbError) {
      // If it's already our custom error, rethrow
      if (dbError instanceof TokenExpiredError) {
        throw dbError;
      }
      // Ignore other DB errors, fall through to generic message
    }

    throw new NoTokenError();
  }

  return token;
}

/**
 * Check if we have a valid token
 */
export async function hasValidToken(): Promise<boolean> {
  const token = await getStoredToken();
  return token !== null;
}

/**
 * Get token status for UI display
 * Includes warning when token is close to expiry
 */
export async function getTokenStatus(): Promise<TokenStatus> {
  try {
    const token = await prisma.upstoxToken.findFirst({
      where: {
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (token) {
      const hoursRemaining = (token.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const isExpiringSoon = hoursRemaining < 2; // Less than 2 hours

      let statusMessage = `Token valid for ${hoursRemaining.toFixed(1)} hours`;
      if (isExpiringSoon) {
        statusMessage = `Token expiring soon (${hoursRemaining.toFixed(1)} hours remaining). Please refresh.`;
      }

      return {
        hasToken: true,
        expiresAt: token.expiresAt,
        hoursRemaining,
        isExpiringSoon,
        statusMessage,
      };
    }

    // Check for expired token
    const expiredToken = await prisma.upstoxToken.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (expiredToken) {
      const minutesAgo = (Date.now() - expiredToken.expiresAt.getTime()) / (1000 * 60);
      const timeAgoStr = minutesAgo < 60 
        ? `${Math.round(minutesAgo)} minutes ago`
        : `${(minutesAgo / 60).toFixed(1)} hours ago`;
      return {
        hasToken: false,
        expiresAt: expiredToken.expiresAt,
        hoursRemaining: null,
        isExpiringSoon: false,
        statusMessage: `Token expired ${timeAgoStr}. Please login again.`,
      };
    }

    return {
      hasToken: false,
      expiresAt: null,
      hoursRemaining: null,
      isExpiringSoon: false,
      statusMessage: 'No token found. Please login at /api/upstox/login',
    };
  } catch {
    return {
      hasToken: false,
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
  const missing: string[] = [];
  if (!process.env.UPSTOX_API_KEY) missing.push('UPSTOX_API_KEY');
  if (!process.env.UPSTOX_API_SECRET) missing.push('UPSTOX_API_SECRET');
  return { valid: missing.length === 0, missing };
}

/**
 * Get the WebSocket authorization URL for direct client connection
 * This allows the frontend to connect directly to Upstox WebSocket
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
