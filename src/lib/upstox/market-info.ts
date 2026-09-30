/**
 * Upstox Market Information Service
 * 
 * Handles market holidays and timings with caching.
 */

import { getAccessToken } from './auth';
import { MarketHoliday, MarketTiming, UpstoxError, UpstoxExchangeStatus } from './types';
import { istDayOfWeek, istTimeParts, todayISTYmd } from '@/lib/tz';
import { logger } from '@/lib/logger';

const marketInfoLogger = logger.scope('MarketInfo');
const BASE_URL = 'https://api.upstox.com/v2';

// ============================================================================
// Holiday Cache (24-hour TTL, keyed by year)
// ============================================================================

interface HolidayCache {
  holidays: Set<string>; // Set of YYYY-MM-DD strings
  fetchedAt: number;
}

const holidayCache = new Map<number, HolidayCache>();
const HOLIDAY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clear the holiday cache
 */
export function clearHolidayCache(): void {
  holidayCache.clear();
}

// ============================================================================
// Market Holidays API
// ============================================================================

/**
 * Get market holidays for the current year or check a specific date
 * @param date Optional date in YYYY-MM-DD format to check specific date
 */
export async function getMarketHolidays(date?: string): Promise<MarketHoliday[]> {
  const accessToken = await getAccessToken();

  const url = date
    ? `${BASE_URL}/market/holidays/${date}`
    : `${BASE_URL}/market/holidays`;

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new UpstoxError(
      `Market holidays fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();

  if (json.status === 'success' && json.data) {
    return Array.isArray(json.data) ? json.data : [json.data];
  }

  return [];
}

/**
 * Get all NSE trading holidays for a year (cached, 24-hour TTL).
 * Returns a Set of date strings in YYYY-MM-DD format.
 *
 * @note The Upstox holidays API returns **only the current calendar year**'s holidays.
 * When `year` differs from the current year (e.g. checking dates in late Dec or early Jan),
 * this function will return an empty set — which causes `isTradingHoliday` to fail-open
 * (treating the date as a trading day). This is acceptable for the current use-case but
 * callers near year boundaries should handle the empty set explicitly if correctness matters.
 */
export async function getTradingHolidays(year: number): Promise<Set<string>> {
  const now = Date.now();
  const cached = holidayCache.get(year);

  if (cached && now - cached.fetchedAt < HOLIDAY_CACHE_TTL) {
    return cached.holidays;
  }

  marketInfoLogger.info(`Fetching holidays for year ${year}...`);

  try {
    const allHolidays = await getMarketHolidays();
    const holidays = new Set<string>();

    for (const holiday of allHolidays) {
      // Only include trading holidays where NSE is closed
      if (holiday.holiday_type === 'TRADING_HOLIDAY') {
        const nseIsClosed =
          holiday.closed_exchanges?.includes('NSE') ||
          holiday.closed_exchanges?.includes('NFO');

        // If closed_exchanges includes NSE, or open_exchanges doesn't include NSE
        if (nseIsClosed) {
          holidays.add(holiday.date);
        } else if (holiday.open_exchanges) {
          const nseIsOpen = holiday.open_exchanges.some(
            (ex) => ex.exchange === 'NSE' || ex.exchange === 'NFO'
          );
          if (!nseIsOpen) {
            holidays.add(holiday.date);
          }
        }
      }
    }

    // Filter to only include holidays for the requested year
    const yearHolidays = new Set<string>();
    for (const date of holidays) {
      if (date.startsWith(String(year))) {
        yearHolidays.add(date);
      }
    }

    holidayCache.set(year, { holidays: yearHolidays, fetchedAt: now });
    marketInfoLogger.info(`Cached ${yearHolidays.size} holidays for ${year}`);

    return yearHolidays;
  } catch (error) {
    marketInfoLogger.error(`Failed to fetch holidays for ${year}:`, error);
    // Return empty set on error - fail open
    return new Set();
  }
}

/**
 * Get all Special Trading Days (e.g. Budget Day on Sunday) for a year
 * Returns a Set of date strings in YYYY-MM-DD format
 */
export async function getSpecialTradingDays(year: number): Promise<Set<string>> {
  try {
    const allHolidays = await getMarketHolidays();
    const specialDays = new Set<string>();

    for (const holiday of allHolidays) {
      if (holiday.open_exchanges) {
         const nseIsOpen = holiday.open_exchanges.some(
            (ex) => ex.exchange === 'NSE' || ex.exchange === 'NFO'
         );
         
         if (nseIsOpen) {
            // It is listed in holidays/events API, but NSE is OPEN.
            // Check if it is a weekend? OR just trust it is a trading day.
            // Typically special sessions are on weekends.
            specialDays.add(holiday.date);
         }
      }
    }

    // Filter by year
    const yearSpecialDays = new Set<string>();
    for (const date of specialDays) {
      if (date.startsWith(String(year))) {
        yearSpecialDays.add(date);
      }
    }
    return yearSpecialDays;
  } catch (error) {
    marketInfoLogger.warn(`Failed to fetch special trading days for ${year}:`, error);
    return new Set();
  }
}

/**
 * Check if a specific date is a trading holiday
 * @param date Date object or YYYY-MM-DD string
 */
export async function isTradingHoliday(date: Date | string): Promise<boolean> {
  const dateStr = typeof date === 'string' ? date : formatDate(date);
  const year = parseInt(dateStr.substring(0, 4), 10);

  // Check if weekend first (no API call needed). Anchor weekday lookup to IST
  // so a `new Date()` argument resolves to the right Indian trading day even
  // when the server runs in UTC.
  const dayOfWeek =
    typeof date === 'string'
      ? istDayOfWeek(new Date(`${date}T12:00:00+05:30`))
      : istDayOfWeek(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return true; // Weekend
  }

  // Check holidays
  const holidays = await getTradingHolidays(year);
  return holidays.has(dateStr);
}

/**
 * Check if a date is a trading day (not weekend, not holiday)
 */
export async function isTradingDay(date: Date | string): Promise<boolean> {
  return !(await isTradingHoliday(date));
}

// ============================================================================
// Market Timings API
// ============================================================================

/**
 * Get market timings for a specific date
 * @param date YYYY-MM-DD format
 */
export async function getMarketTimings(date: string): Promise<MarketTiming[]> {
  const accessToken = await getAccessToken();

  const url = `${BASE_URL}/market/timings/${date}`;

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new UpstoxError(
      `Market timings fetch failed: ${response.status} - ${errorText}`,
      response.status
    );
  }

  const json = await response.json();

  if (json.status === 'success' && json.data) {
    return json.data;
  }

  return [];
}

/**
 * Check if market is currently open
 * Uses market timings API to determine if we're within trading hours
 */
export async function isMarketOpen(): Promise<boolean> {
  const now = new Date();
  const dateStr = formatDate(now);

  // Check if it's a trading day first
  if (await isTradingHoliday(now)) {
    return false;
  }

  const minutesInIST = (): number => {
    const { hour, minute } = istTimeParts(now);
    return hour * 60 + minute;
  };
  const NSE_OPEN_MINUTES = 9 * 60 + 15;
  const NSE_CLOSE_MINUTES = 15 * 60 + 40; // 3:40 PM IST (includes Closing Auction Session)

  try {
    const timings = await getMarketTimings(dateStr);
    const nseTimings = timings.find((t) => t.exchange === 'NSE');

    if (!nseTimings) {
      // If no timings found, use default NSE hours (9:15 AM - 3:40 PM IST)
      const currentMinutes = minutesInIST();
      return currentMinutes >= NSE_OPEN_MINUTES && currentMinutes <= NSE_CLOSE_MINUTES;
    }

    const nowMs = now.getTime();
    return nowMs >= nseTimings.start_time && nowMs <= nseTimings.end_time;
  } catch (error) {
    marketInfoLogger.error('Failed to check market status:', error);
    const currentMinutes = minutesInIST();
    return currentMinutes >= NSE_OPEN_MINUTES && currentMinutes <= NSE_CLOSE_MINUTES;
  }
}

/**
 * Get real-time exchange status (including CAS_ELIGIBLE_STATUS) from Upstox
 * @param exchange Segment identifier (e.g. 'NSE_EQ', 'NSE_FO')
 */
export async function getExchangeStatus(exchange: string = 'NSE_EQ'): Promise<UpstoxExchangeStatus | null> {
  try {
    const accessToken = await getAccessToken();
    const url = `${BASE_URL}/market/status/${exchange}`;

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();

    if (json.status === 'success' && json.data) {
      return json.data as UpstoxExchangeStatus;
    }

    return null;
  } catch (error) {
    marketInfoLogger.warn(`Failed to fetch exchange status for ${exchange}:`, error);
    return null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

// IST trading-day YYYY-MM-DD. Use IST so the result matches the Indian market
// calendar even when the server runs in UTC.
function formatDate(date: Date): string {
  return todayISTYmd(date);
}

/**
 * Get the next trading day from a given date
 */
export async function getNextTradingDay(fromDate: Date): Promise<Date> {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + 1);

  // Limit iterations to prevent infinite loop
  for (let i = 0; i < 10; i++) {
    if (await isTradingDay(date)) {
      return date;
    }
    date.setDate(date.getDate() + 1);
  }

  // If no trading day found in 10 days, return the last checked date
  return date;
}

/**
 * Get the previous trading day from a given date
 */
export async function getPreviousTradingDay(fromDate: Date): Promise<Date> {
  const date = new Date(fromDate);
  date.setDate(date.getDate() - 1);

  // Limit iterations to prevent infinite loop
  for (let i = 0; i < 10; i++) {
    if (await isTradingDay(date)) {
      return date;
    }
    date.setDate(date.getDate() - 1);
  }

  // If no trading day found in 10 days, return the last checked date
  return date;
}
