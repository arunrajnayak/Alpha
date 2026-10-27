/**
 * Kite Connect Client Helper
 * Reusable module for Zerodha Kite authentication, token management, and API calls.
 */

import { KiteConnect } from 'kiteconnect';
import { TOTP } from 'otpauth';
import { prisma } from '@/lib/db';
import { istDateParts, istTimeParts } from '@/lib/tz';
import { logger } from '@/lib/logger';

const kiteLogger = logger.scope('Kite');

// Configuration from environment
const CONFIG = {
    userId: process.env.ZERODHA_USER_ID,
    password: process.env.ZERODHA_PASSWORD,
    totpSecret: process.env.ZERODHA_TOTP_SECRET,
    apiKey: process.env.ZERODHA_API_KEY,
    apiSecret: process.env.ZERODHA_API_SECRET,
    loginUrl: 'https://kite.zerodha.com'
};

export function validateKiteApiConfig(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!CONFIG.apiKey) missing.push('ZERODHA_API_KEY');
    if (!CONFIG.apiSecret) missing.push('ZERODHA_API_SECRET');
    return { valid: missing.length === 0, missing };
}

export function validatePuppeteerConfig(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!CONFIG.userId) missing.push('ZERODHA_USER_ID');
    if (!CONFIG.password) missing.push('ZERODHA_PASSWORD');
    if (!CONFIG.totpSecret) missing.push('ZERODHA_TOTP_SECRET');
    if (!CONFIG.apiKey) missing.push('ZERODHA_API_KEY');
    if (!CONFIG.apiSecret) missing.push('ZERODHA_API_SECRET');
    return { valid: missing.length === 0, missing };
}

export function validateKiteConfig(): { valid: boolean; missing: string[] } {
    return validatePuppeteerConfig();
}

/**
 * Calculate next Kite session expiry timestamp.
 * Kite access tokens expire daily at 06:00:00 AM IST.
 */
export function calculateKiteExpiry(now: Date = new Date()): Date {
    const istParts = istDateParts(now);
    const timeParts = istTimeParts(now);

    let year = istParts.year;
    let month = istParts.month;
    let day = istParts.day;

    if (timeParts.hour >= 6) {
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowParts = istDateParts(tomorrow);
        year = tomorrowParts.year;
        month = tomorrowParts.month;
        day = tomorrowParts.day;
    }

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return new Date(`${year}-${mm}-${dd}T06:00:00.000+05:30`);
}

/**
 * Return official Kite Connect login URL for OAuth flow.
 */
export function getKiteLoginUrl(): string | null {
    const apiKey = CONFIG.apiKey || process.env.ZERODHA_API_KEY;
    if (!apiKey) return null;
    return `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;
}

// In-memory token cache for high-frequency queries
interface TokenCache {
    token: string;
    tokenId: number;
    userId: string;
    userName: string | null;
    expiresAt: Date;
    cachedAt: number;
}

let tokenCache: TokenCache | null = null;
const TOKEN_CACHE_TTL_MS = 30 * 1000; // 30 seconds

export function clearKiteTokenCache(): void {
    tokenCache = null;
}

/**
 * Fetch stored, active Zerodha token from DB with in-memory caching.
 */
export async function getStoredZerodhaToken(): Promise<{
    accessToken: string;
    userId: string;
    userName: string | null;
    expiresAt: Date;
} | null> {
    const now = Date.now();
    if (
        tokenCache &&
        tokenCache.expiresAt.getTime() > now &&
        now - tokenCache.cachedAt < TOKEN_CACHE_TTL_MS
    ) {
        return {
            accessToken: tokenCache.token,
            userId: tokenCache.userId,
            userName: tokenCache.userName,
            expiresAt: tokenCache.expiresAt,
        };
    }

    try {
        const token = await prisma.zerodhaToken.findFirst({
            where: {
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (token) {
            tokenCache = {
                token: token.accessToken,
                tokenId: token.id,
                userId: token.userId,
                userName: token.userName,
                expiresAt: token.expiresAt,
                cachedAt: now,
            };
            return {
                accessToken: token.accessToken,
                userId: token.userId,
                userName: token.userName,
                expiresAt: token.expiresAt,
            };
        }

        tokenCache = null;
        return null;
    } catch (error) {
        kiteLogger.error('Error fetching stored Zerodha token:', error);
        return null;
    }
}

/**
 * Exchange request token received from OAuth callback for an access token.
 */
export async function exchangeKiteRequestToken(requestToken: string) {
    const configCheck = validateKiteApiConfig();
    if (!configCheck.valid) {
        throw new Error(`Missing required Zerodha configuration: ${configCheck.missing.join(', ')}`);
    }

    const kc = new KiteConnect({
        api_key: CONFIG.apiKey!,
        debug: false
    });

    kiteLogger.info('Exchanging request token for session...');
    const session = await kc.generateSession(requestToken, CONFIG.apiSecret!);
    const expiresAt = calculateKiteExpiry();

    const saved = await prisma.zerodhaToken.create({
        data: {
            accessToken: session.access_token,
            publicToken: session.public_token,
            userId: session.user_id,
            userName: session.user_name || session.user_shortname,
            userType: session.user_type,
            email: session.email,
            expiresAt
        }
    });

    clearKiteTokenCache();
    kiteLogger.info(`Zerodha session generated and stored for user ${session.user_id}, valid until ${expiresAt.toISOString()}`);
    return saved;
}

export interface ZerodhaTokenStatus {
    hasToken: boolean;
    userId: string | null;
    userName: string | null;
    expiresAt: Date | null;
    hoursRemaining: number | null;
    isExpiringSoon: boolean;
    statusMessage: string;
    loginUrl: string | null;
    configured: boolean;
}

/**
 * Get Zerodha token status for UI display.
 */
export async function getZerodhaTokenStatus(): Promise<ZerodhaTokenStatus> {
    const configCheck = validateKiteApiConfig();
    const loginUrl = configCheck.valid ? getKiteLoginUrl() : null;

    if (!configCheck.valid) {
        return {
            hasToken: false,
            userId: null,
            userName: null,
            expiresAt: null,
            hoursRemaining: null,
            isExpiringSoon: false,
            statusMessage: `Missing configuration: ${configCheck.missing.join(', ')} in .env.local`,
            loginUrl: null,
            configured: false
        };
    }

    const stored = await getStoredZerodhaToken();
    if (stored) {
        const hoursRemaining = (stored.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
        const isExpiringSoon = hoursRemaining < 2;
        let statusMessage = `Connected as ${stored.userName || stored.userId} (${hoursRemaining.toFixed(1)}h remaining)`;
        if (isExpiringSoon) {
            statusMessage = `Session expiring soon (${hoursRemaining.toFixed(1)}h remaining). Re-connect to refresh.`;
        }
        return {
            hasToken: true,
            userId: stored.userId,
            userName: stored.userName,
            expiresAt: stored.expiresAt,
            hoursRemaining,
            isExpiringSoon,
            statusMessage,
            loginUrl,
            configured: true
        };
    }

    return {
        hasToken: false,
        userId: null,
        userName: null,
        expiresAt: null,
        hoursRemaining: null,
        isExpiringSoon: false,
        statusMessage: 'Not connected. Connect your Zerodha account to sync orders.',
        loginUrl,
        configured: true
    };
}

/**
 * Disconnect Zerodha session.
 */
export async function disconnectZerodha(): Promise<{ success: boolean }> {
    clearKiteTokenCache();
    await prisma.zerodhaToken.deleteMany();
    return { success: true };
}

/**
 * Get request token via headless browser login (Puppeteer)
 */
async function getRequestToken(): Promise<string> {
    kiteLogger.info('Launching headless browser for login...');
    // Dynamically import puppeteer so it only loads in environments where installed/needed
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    try {
        const page = await browser.newPage();
        const loginUrl = `https://kite.trade/connect/login?v=3&api_key=${CONFIG.apiKey}`;
        
        kiteLogger.info('Navigating to login page...');
        await page.goto(loginUrl, { waitUntil: 'networkidle0' });

        // 1. Enter User ID
        await page.waitForSelector('#userid');
        await page.type('#userid', CONFIG.userId!);
        await page.type('#password', CONFIG.password!);
        
        kiteLogger.info('Submitting credentials...');
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
        ]);

        // Check for error message immediately
        const errorEl = await page.$('.error-message, .su-message.error');
        if (errorEl) {
            const errorText = await page.evaluate((el: Element) => el.textContent, errorEl);
            kiteLogger.error('Login Failed with Error:', errorText);
            throw new Error(`Zerodha Login Failed: ${errorText?.trim()}`);
        }

        kiteLogger.info('Waiting for 2FA screen...');
        try {
            await page.waitForSelector('input[type="text"], input[type="number"], input[placeholder="App Code"]', { timeout: 10000 });
        } catch {
            kiteLogger.error('Failed to find 2FA input. Current URL:', page.url());
            const err = await page.$eval('body', (el: Element) => (el as HTMLElement).innerText); 
            if (err.includes('Invalid credentials') || err.includes('Login failed')) {
               throw new Error('Invalid credentials');
            }
            throw new Error('Timed out waiting for 2FA input. Check if User ID/Password are correct.');
        }

        // Generate TOTP
        kiteLogger.info('Generating TOTP...');
        const totp = new TOTP({
            secret: CONFIG.totpSecret!,
            algorithm: 'SHA1',
            digits: 6,
            period: 30
        });
        const token = totp.generate();
        
        // Type TOTP
        const totpInputSelector = 'input[type="number"], input[type="text"]'; 
        await page.type(totpInputSelector, token);
        
        kiteLogger.info('Waiting for redirect...');
        try {
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                 await submitBtn.click();
            }
        } catch { /* Ignore */ }

        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        let url = page.url();
        kiteLogger.info('Current URL:', url);

        // Check if we are on the Authorize page (Consent Screen)
        if (url.includes('connect/authorize')) {
            kiteLogger.info('Authorization consent screen detected. Clicking Authorize...');
            try {
                const submitBtn = await page.$('button[type="submit"]'); 
                if (submitBtn) {
                     await submitBtn.click();
                } else {
                     await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const authBtn = buttons.find(b => b.textContent?.includes('Authorize'));
                        if (authBtn) authBtn.click();
                     });
                }
                
                await page.waitForNavigation({ timeout: 15000, waitUntil: 'networkidle0' });
                url = page.url();
                kiteLogger.info('URL after authorization:', url);
            } catch (e) {
                kiteLogger.error('Failed to click Authorize:', e);
            }
        }
        
        const urlObj = new URL(url);
        const requestToken = urlObj.searchParams.get('request_token');
        
        if (!requestToken) {
            throw new Error(`Request token not found in URL: ${url}. Ensure valid Redirect URL is set in Kite Connect app settings.`);
        }
        
        return requestToken;

    } finally {
        await browser.close();
    }
}

/**
 * Get authenticated Kite Connect instance.
 * Checks for existing valid DB session first; falls back to headless login if configured.
 */
export async function getAuthenticatedKiteClient(): Promise<typeof KiteConnect.prototype> {
    const apiConfig = validateKiteApiConfig();
    if (!apiConfig.valid) {
        throw new Error(`Missing required Zerodha credentials: ${apiConfig.missing.join(', ')}`);
    }

    // 1. Check for valid database token
    const stored = await getStoredZerodhaToken();
    if (stored) {
        const kc = new KiteConnect({
            api_key: CONFIG.apiKey!,
            debug: false
        });
        kc.setAccessToken(stored.accessToken);
        return kc;
    }

    // 2. Fall back to Puppeteer if full credentials exist
    const puppeteerConfig = validatePuppeteerConfig();
    if (puppeteerConfig.valid) {
        kiteLogger.info('No active Zerodha DB token found; initiating headless browser login...');
        const requestToken = await getRequestToken();
        const kc = new KiteConnect({
            api_key: CONFIG.apiKey!,
            debug: false
        });
        const response = await kc.generateSession(requestToken, CONFIG.apiSecret!);
        const accessToken = response.access_token;
        kc.setAccessToken(accessToken);

        const expiresAt = calculateKiteExpiry();
        await prisma.zerodhaToken.create({
            data: {
                accessToken,
                publicToken: response.public_token,
                userId: response.user_id,
                userName: response.user_name || response.user_shortname,
                userType: response.user_type,
                email: response.email,
                expiresAt
            }
        });
        clearKiteTokenCache();
        kiteLogger.info('Headless login succeeded; session stored in DB.');
        return kc;
    }

    // 3. No token and no headless credentials
    throw new Error('No active Zerodha session found. Please connect your Zerodha account in Settings.');
}

export interface ExecutedOrder {
    orderId: string;
    symbol: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    averagePrice: number;
    orderTimestamp: Date;
}

/**
 * Fetch today's executed orders from Kite
 */
export async function fetchExecutedOrders(kc: typeof KiteConnect.prototype): Promise<ExecutedOrder[]> {
    kiteLogger.info('Fetching orders...');
    const orders = await kc.getOrders();
    
    // Filter for executed or partially executed orders
    const executedOrders = orders.filter((o: any) => o.filled_quantity > 0);
    
    if (executedOrders.length === 0) {
        kiteLogger.info('No executed orders found for today.');
        return [];
    }

    kiteLogger.info(`Fetched ${executedOrders.length} executed orders.`);

    return executedOrders.map((o: any) => ({
        orderId: o.order_id,
        symbol: o.tradingsymbol,
        transactionType: o.transaction_type as 'BUY' | 'SELL',
        quantity: o.filled_quantity,
        averagePrice: o.average_price,
        orderTimestamp: o.order_timestamp ? new Date(o.order_timestamp) : new Date()
    }));
}
