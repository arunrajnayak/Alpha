/**
 * Date utilities for the momentum screener pipeline.
 */

/**
 * Format a Date to YYYY-MM-DD string.
 *
 * Uses UTC calendar parts because the rest of the screener pipeline (and the
 * `todayIST()` helper below) deliberately constructs Date objects whose UTC
 * date matches the IST trading day. Using local-TZ getters here would shift
 * the date by one whenever the server runs in IST (e.g. local dev).
 */
export function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD string to Date (UTC) */
export function fromDateStr(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

/** Get today's date in IST as YYYY-MM-DD */
export function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return toDateStr(ist);
}

/** Returns true if NSE market or Closing Auction Session (CAS) is active (9:15 AM – 4:00 PM IST) on weekdays */
export function isMarketHours(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  if (isWeekend(ist)) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 16 * 60; // 9:15 AM to 4:00 PM IST (includes Closing Auction Session)
}

/**
 * The effective trading day for pipeline scoring (sync, weekend-aware only).
 * Before market close on a weekday (includes pre-market and market hours), returns the previous weekday (last complete close).
 * After market close on a weekday, returns today.
 * On weekends, rolls back to the last weekday (Friday).
 *
 * NOTE: Does not check exchange holidays or special weekend sessions (async).
 * Use resolveLastTradingDay() in the pipeline for holiday- and special-session-aware resolution.
 */
export function effectiveTradingDay(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // Before market close on a weekday (includes pre-market and market hours), roll back to previous weekday
  if (!isWeekend(ist) && mins < 16 * 60) {
    return toDateStr(previousTradingDay(ist));
  }
  // On weekends, roll back to the last weekday
  if (isWeekend(ist)) {
    const d = new Date(ist);
    while (isWeekend(d)) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return toDateStr(d);
  }
  return toDateStr(ist);
}

/** Check if a date falls on a weekend */
export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Get the previous trading day (skips weekends, no holiday calendar) */
export function previousTradingDay(d: Date): Date {
  const prev = new Date(d);
  do {
    prev.setUTCDate(prev.getUTCDate() - 1);
  } while (isWeekend(prev));
  return prev;
}

/**
 * Async holiday- and special-trading-session-aware resolution of the last actual trading day.
 * Accounts for:
 * 1. Special weekend trading sessions (e.g. Muhurat trading or Budget Day).
 * 2. Pre-market, active market hours, and post-market session completion.
 * 3. Mid-week exchange trading holidays.
 */
export async function resolveLastTradingDay(): Promise<string> {
  // Lazy imports to avoid circular dependencies
  const { isMarketHoliday } = await import('@/lib/upstox-client');
  const { getSpecialTradingDays } = await import('@/lib/upstox/market-info');

  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const currentYear = ist.getUTCFullYear();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  let specialDays = new Set<string>();
  try {
    specialDays = await getSpecialTradingDays(currentYear);
  } catch {
    // Upstox API unavailable — ignore and proceed with holiday checks
  }

  const candidateDate = new Date(ist);
  const todayStr = toDateStr(candidateDate);

  // If today is a special trading day, check if special session has completed (e.g. after 20:00)
  // Otherwise on normal weekdays it must be after 16:00 (CAS complete).
  const isSpecialToday = specialDays.has(todayStr);
  const isMarketClosedToday = isSpecialToday ? mins >= 20 * 60 : (!isWeekend(candidateDate) && mins >= 16 * 60);

  if (!isMarketClosedToday) {
    // Today has not finished trading yet, start looking from yesterday
    candidateDate.setUTCDate(candidateDate.getUTCDate() - 1);
  }

  // Walk backwards up to 7 days to find the last valid trading day
  for (let i = 0; i < 7; i++) {
    const dStr = toDateStr(candidateDate);
    if (specialDays.has(dStr)) {
      return dStr;
    }
    if (!isWeekend(candidateDate)) {
      try {
        const isHoliday = await isMarketHoliday(dStr);
        if (!isHoliday) return dStr;
      } catch {
        return dStr;
      }
    }
    candidateDate.setUTCDate(candidateDate.getUTCDate() - 1);
  }

  return toDateStr(candidateDate);
}

/** Get date N calendar days ago as YYYY-MM-DD (anchored to IST when no `from` is given) */
export function daysAgo(n: number, from?: string): string {
  const d = fromDateStr(from ?? todayIST());
  d.setUTCDate(d.getUTCDate() - n);
  return toDateStr(d);
}

/**
 * Format date for NSE bhavcopy URL: DDMMYY (2-digit year)
 * Example: 2026-03-30 → "300326"
 */
export function toBhavcopyDateFormat(dateStr: string): string {
  const d = fromDateStr(dateStr);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

/**
 * Format date for NSE mcap CSV filename: DDMMYYYY (4-digit year)
 * Example: 2026-03-30 → "30032026"
 */
export function toMcapDateFormat(dateStr: string): string {
  const d = fromDateStr(dateStr);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
}
