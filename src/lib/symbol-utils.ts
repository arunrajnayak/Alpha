/**
 * Symbol Utility Functions
 * 
 * Provides consistent symbol normalization across the application.
 * Removes legacy suffixes like .NS (Yahoo Finance) and .BO (BSE).
 */

/**
 * Clean a symbol by removing exchange suffixes
 * @param symbol - Raw symbol (e.g., "RELIANCE.NS", "TCS.BO", "INFY")
 * @returns Clean symbol (e.g., "RELIANCE", "TCS", "INFY")
 */
export function cleanSymbol(symbol: string): string {
  return symbol
    .replace(/\.NS$/i, '')
    .replace(/\.BO$/i, '')
    .toUpperCase()
    .trim();
}

/**
 * Format symbol for display (removes suffixes, keeps original case style)
 * @param symbol - Raw symbol
 * @returns Display-friendly symbol
 */
export function displaySymbol(symbol: string): string {
  return symbol
    .replace(/\.NS$/i, '')
    .replace(/\.BO$/i, '')
    .trim();
}

/**
 * Normalize symbol for database/API lookups
 * @param symbol - Raw symbol
 * @returns Normalized uppercase symbol without suffixes
 */
export function normalizeSymbol(symbol: string): string {
  return cleanSymbol(symbol);
}

/**
 * Check if a symbol has a legacy suffix
 * @param symbol - Symbol to check
 * @returns true if symbol has .NS or .BO suffix
 */
export function hasLegacySuffix(symbol: string): boolean {
  return /\.(NS|BO)$/i.test(symbol);
}
