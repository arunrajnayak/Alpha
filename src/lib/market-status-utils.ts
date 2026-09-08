import { istDayOfWeek, istTimeParts } from '@/lib/tz';

export const isMarketOpen = (): boolean => {
  const now = new Date();

  // Use Indian Standard Time (IST). Routed through `tz.ts` so the result is
  // correct regardless of the host's local timezone.
  const day = istDayOfWeek(now);
  const { hour, minute } = istTimeParts(now);
  const totalMinutes = hour * 60 + minute;

  // NSE market hours (sync fallback; authoritative status from Upstox Market Timings API)
  const startMinutes = 9 * 60 + 15;  // 9:15 AM
  const endMinutes = 15 * 60 + 40;   // 3:40 PM (includes Closing Auction Session)

  // Check if it's a weekday (Monday=1 to Friday=5)
  if (day >= 1 && day <= 5) {
    if (totalMinutes >= startMinutes && totalMinutes < endMinutes) {
      // Within trading hours on a weekday - check if it's a holiday
      // Note: We check holidays asynchronously, so this is a best-effort check
      // The actual holiday check happens in the background
      return true; // Assume open, holiday check will update UI asynchronously
    }
  }

  return false;
};

/**
 * Pre-Open session is 09:00 to 09:15 AM IST on weekdays
 */
export const isPreOpenSession = (date = new Date()): boolean => {
  const day = istDayOfWeek(date);
  const { hour, minute } = istTimeParts(date);
  const totalMinutes = hour * 60 + minute;

  if (day >= 1 && day <= 5) {
    return totalMinutes >= 9 * 60 && totalMinutes < 9 * 60 + 15;
  }
  return false;
};

/**
 * True if before 09:00 AM IST (before pre-open starts)
 */
export const isPreMarketClosed = (date = new Date()): boolean => {
  const { hour, minute } = istTimeParts(date);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes < 9 * 60;
};

/**
 * Active trading or pre-open discovery hours
 */
export const isMarketActive = (date = new Date()): boolean => {
  return isMarketOpen() || isPreOpenSession(date);
};

