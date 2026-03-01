/**
 * Kite Connect Client Helper
 * Reusable module for Zerodha Kite authentication and API calls.
 */

import puppeteer from 'puppeteer';
import { KiteConnect } from 'kiteconnect';
import { TOTP } from 'otpauth';

// Configuration from environment
const CONFIG = {
    userId: process.env.ZERODHA_USER_ID,
    password: process.env.ZERODHA_PASSWORD,
    totpSecret: process.env.ZERODHA_TOTP_SECRET,
    apiKey: process.env.ZERODHA_API_KEY,
    apiSecret: process.env.ZERODHA_API_SECRET,
    loginUrl: 'https://kite.zerodha.com'
};

export function validateKiteConfig(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!CONFIG.userId) missing.push('ZERODHA_USER_ID');
    if (!CONFIG.password) missing.push('ZERODHA_PASSWORD');
    if (!CONFIG.totpSecret) missing.push('ZERODHA_TOTP_SECRET');
    if (!CONFIG.apiKey) missing.push('ZERODHA_API_KEY');
    if (!CONFIG.apiSecret) missing.push('ZERODHA_API_SECRET');
    
    return { valid: missing.length === 0, missing };
}

/**
 * Get request token via headless browser login
 */
async function getRequestToken(): Promise<string> {
    console.log('[KiteClient] Launching headless browser for login...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    try {
        const page = await browser.newPage();
        
        // Construct the login URL with api_key for correct redirect
        const loginUrl = `https://kite.trade/connect/login?v=3&api_key=${CONFIG.apiKey}`;
        
        console.log('[KiteClient] Navigating to login page...');
        await page.goto(loginUrl, { waitUntil: 'networkidle0' });

        // 1. Enter User ID
        await page.waitForSelector('#userid');
        await page.type('#userid', CONFIG.userId!);
        await page.type('#password', CONFIG.password!);
        
        console.log('[KiteClient] Submitting credentials...');
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
        ]);

        // Check for error message immediately
        const errorEl = await page.$('.error-message, .su-message.error');
        if (errorEl) {
            const errorText = await page.evaluate((el: Element) => el.textContent, errorEl);
            console.error('[KiteClient] Login Failed with Error:', errorText);
            throw new Error(`Zerodha Login Failed: ${errorText?.trim()}`);
        }

        console.log('[KiteClient] Waiting for 2FA screen...');
        try {
            await page.waitForSelector('input[type="text"], input[type="number"], input[placeholder="App Code"]', { timeout: 10000 });
        } catch {
            console.error('[KiteClient] Failed to find 2FA input. Current URL:', page.url());
            const err = await page.$eval('body', (el: Element) => (el as HTMLElement).innerText); 
            if (err.includes('Invalid credentials') || err.includes('Login failed')) {
               throw new Error('Invalid credentials');
            }
            throw new Error('Timed out waiting for 2FA input. Check if User ID/Password are correct.');
        }

        // Generate TOTP
        console.log('[KiteClient] Generating TOTP...');
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
        
        // Wait for redirect or authorization page
        console.log('[KiteClient] Waiting for redirect...');
        
        try {
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) {
                 await submitBtn.click();
            }
        } catch { /* Ignore */ }

        await page.waitForNavigation({ waitUntil: 'networkidle0' });
        let url = page.url();
        console.log('[KiteClient] Current URL:', url);

        // Check if we are on the Authorize page (Consent Screen)
        if (url.includes('connect/authorize')) {
            console.log('[KiteClient] Authorization consent screen detected. Clicking Authorize...');
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
                console.log('[KiteClient] URL after authorization:', url);
            } catch (e) {
                console.error('[KiteClient] Failed to click Authorize:', e);
            }
        }
        
        const urlObj = new URL(url);
        const requestToken = urlObj.searchParams.get('request_token');
        
        if (!requestToken) {
            throw new Error(`Request token not found in URL: ${url}. Ensure valid Redirect URL is set in Kite Connect app settings?`);
        }
        
        return requestToken;

    } finally {
        await browser.close();
    }
}

/**
 * Get authenticated Kite Connect instance
 */
export async function getAuthenticatedKiteClient(): Promise<typeof KiteConnect.prototype> {
    const configCheck = validateKiteConfig();
    if (!configCheck.valid) {
        throw new Error(`Missing required Zerodha credentials: ${configCheck.missing.join(', ')}`);
    }

    // 1. Get Request Token
    const requestToken = await getRequestToken();
    console.log('[KiteClient] Request Token obtained.');

    // 2. Initialize Kite Connect
    const kc = new KiteConnect({
        api_key: CONFIG.apiKey!,
        debug: false
    });

    // 3. Generate Session
    console.log('[KiteClient] Generating session...');
    const response = await kc.generateSession(requestToken, CONFIG.apiSecret!);
    const accessToken = response.access_token;
    kc.setAccessToken(accessToken);
    console.log('[KiteClient] Session active.');

    return kc;
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
    console.log('[KiteClient] Fetching orders...');
    const orders = await kc.getOrders();
    
    // Filter for executed or partially executed orders
    // status: COMPLETE means fully filled. 
    // Best metric: filled_quantity > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executedOrders = orders.filter((o: any) => o.filled_quantity > 0);
    
    if (executedOrders.length === 0) {
        console.log('[KiteClient] No executed orders found for today.');
        return [];
    }

    console.log(`[KiteClient] Fetched ${executedOrders.length} executed orders.`);

    // Map to standardized format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return executedOrders.map((o: any) => ({
        orderId: o.order_id,
        symbol: o.tradingsymbol,
        transactionType: o.transaction_type as 'BUY' | 'SELL',
        quantity: o.filled_quantity,
        averagePrice: o.average_price,
        orderTimestamp: o.order_timestamp ? new Date(o.order_timestamp) : new Date()
    }));
}
