/**
 * Formatting Utilities
 * 
 * Consolidated formatting functions for currency, numbers, and dates.
 * Uses Indian locale conventions throughout.
 */

// ============================================================================
// Currency & Number Formatting
// ============================================================================

/**
 * Formats a number as a currency string using the Indian numbering system.
 * Defaults to INR currency.
 * @param value The number to format.
 * @param minimumFractionDigits The minimum number of fraction digits to use. Defaults to 0.
 * @param maximumFractionDigits The maximum number of fraction digits to use. Defaults to 0.
 * @returns The formatted currency string.
 */
export function formatCurrency(value: number, minimumFractionDigits = 0, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/**
 * Formats a number using the Indian numbering system.
 * @param value The number to format.
 * @param minimumFractionDigits The minimum number of fraction digits to use. Defaults to 0.
 * @param maximumFractionDigits The maximum number of fraction digits to use. Defaults to 2.
 * @returns The formatted number string.
 */
export function formatNumber(value: number, minimumFractionDigits = 0, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format date as DD-MM-YYYY (common in Indian contexts and NSE API)
 * @param date Date object to format
 * @returns Formatted date string
 */
export function formatDateDMY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Format date as YYYY-MM-DD (ISO format, common in APIs)
 * @param date Date object to format
 * @returns Formatted date string
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format date for display (e.g., "25 Jan 2026")
 * @param date Date object to format
 * @returns Formatted date string
 */
export function formatDateDisplay(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Format date with time for IST timezone (e.g., "25 Jan 2026, 3:30 PM")
 * @param date Date object to format
 * @returns Formatted date-time string in IST
 */
export function formatDateTimeIST(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

/**
 * Get current time in IST
 * @returns Date object representing current time in IST context
 */
export function getISTTime(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

/**
 * Parse a date string that could be in DD-MM-YYYY or YYYY-MM-DD format
 * Returns a Date object set to UTC midnight
 * @param dateStr Date string to parse
 * @returns Date object at UTC midnight, or invalid date if parse fails
 */
export function parseFlexibleDate(dateStr: string): Date {
  // Try DD-MM-YYYY or YYYY-MM-DD with dash separator
  const dashParts = dateStr.split('-');
  if (dashParts.length === 3) {
    if (dashParts[0].length === 4) {
      // YYYY-MM-DD
      return new Date(Date.UTC(parseInt(dashParts[0]), parseInt(dashParts[1]) - 1, parseInt(dashParts[2])));
    } else {
      // DD-MM-YYYY
      return new Date(Date.UTC(parseInt(dashParts[2]), parseInt(dashParts[1]) - 1, parseInt(dashParts[0])));
    }
  }

  // Try DD/MM/YYYY or YYYY/MM/DD with slash separator
  const slashParts = dateStr.split('/');
  if (slashParts.length === 3) {
    if (slashParts[0].length === 4) {
      // YYYY/MM/DD
      return new Date(Date.UTC(parseInt(slashParts[0]), parseInt(slashParts[1]) - 1, parseInt(slashParts[2])));
    } else if (slashParts[2].length === 4) {
      // DD/MM/YYYY
      return new Date(Date.UTC(parseInt(slashParts[2]), parseInt(slashParts[1]) - 1, parseInt(slashParts[0])));
    }
  }

  // Fallback to native Date parsing
  return new Date(dateStr);
}
