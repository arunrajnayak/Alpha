/**
 * Conditional Logger
 * 
 * Only logs in development environment to keep production logs clean.
 * Use instead of console.log throughout the codebase.
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.log('message');     // Basic log
 *   logger.info('message');    // Info level
 *   logger.warn('message');    // Warning level
 *   logger.error('message');   // Error level (always logs)
 *   logger.debug('message');   // Debug level (only in dev)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
    prefix?: string;
    enabledInProduction?: boolean;
}

const isDevelopment = process.env.NODE_ENV === 'development';
const isServer = typeof window === 'undefined';

// Environment-aware no-op function
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noop = (..._args: unknown[]): void => { /* no-op */ };

class Logger {
    private prefix: string;
    private enabledInProduction: boolean;

    constructor(options: LoggerOptions = {}) {
        this.prefix = options.prefix || '';
        this.enabledInProduction = options.enabledInProduction || false;
    }

    private shouldLog(level: LogLevel): boolean {
        // Always log errors
        if (level === 'error') return true;
        
        // In production, only log if explicitly enabled
        if (!isDevelopment && !this.enabledInProduction) return false;
        
        return true;
    }

    private formatMessage(level: LogLevel, message: string): string {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
        const prefix = this.prefix ? `[${this.prefix}]` : '';
        const env = isServer ? '[Server]' : '[Client]';
        return `${timestamp} ${env} ${prefix} [${level.toUpperCase()}] ${message}`;
    }

    log(...args: unknown[]): void {
        if (this.shouldLog('info')) {
            console.log(...args);
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info', message), ...args);
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message), ...args);
        }
    }

    error(message: string, ...args: unknown[]): void {
        // Always log errors
        console.error(this.formatMessage('error', message), ...args);
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.shouldLog('debug') && isDevelopment) {
            console.debug(this.formatMessage('debug', message), ...args);
        }
    }

    /**
     * Create a scoped logger with a prefix
     */
    scope(prefix: string): Logger {
        return new Logger({ 
            prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
            enabledInProduction: this.enabledInProduction 
        });
    }

    /**
     * Time a function and log its duration
     */
    async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
        if (!this.shouldLog('debug')) {
            return fn();
        }

        const start = performance.now();
        try {
            const result = await fn();
            const duration = (performance.now() - start).toFixed(2);
            this.debug(`${label} completed in ${duration}ms`);
            return result;
        } catch (error) {
            const duration = (performance.now() - start).toFixed(2);
            this.error(`${label} failed after ${duration}ms`, error);
            throw error;
        }
    }
}

// Default logger instance
export const logger = new Logger();

// Pre-configured loggers for common modules
export const financeLogger = new Logger({ prefix: 'Finance' });
export const upstoxLogger = new Logger({ prefix: 'Upstox' });
export const dbLogger = new Logger({ prefix: 'DB' });
export const apiLogger = new Logger({ prefix: 'API' });

// Export class for custom instances
export { Logger };
