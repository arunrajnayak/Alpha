/**
 * Client-safe configuration for the application.
 * This file can be imported from client components.
 * Does NOT contain any server-only imports.
 */

// App Configuration - client-safe values only
export const APP_CONFIG = {
    USER_NAME: process.env.NEXT_PUBLIC_APP_USER_NAME || 'User',
} as const;
