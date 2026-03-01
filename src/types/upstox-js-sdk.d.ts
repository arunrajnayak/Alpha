/**
 * Type declarations for upstox-js-sdk
 * 
 * The official Upstox JavaScript SDK doesn't include TypeScript types.
 * This file provides minimal type declarations for the features we use.
 */

declare module 'upstox-js-sdk' {
    export interface ApiClientInstance {
        authentications: {
            OAUTH2: {
                accessToken: string;
            };
        };
    }

    export const ApiClient: {
        instance: ApiClientInstance;
    };

    type StreamMode = 'ltpc' | 'full' | 'option_greeks' | 'full_d30';
    type StreamEvent = 'open' | 'close' | 'message' | 'error' | 'reconnecting' | 'autoReconnectStopped';

    export class MarketDataStreamerV3 {
        constructor(instrumentKeys?: string[], mode?: StreamMode);

        connect(): void;
        disconnect(): void;
        subscribe(instrumentKeys: string[], mode: StreamMode): void;
        unsubscribe(instrumentKeys: string[]): void;
        changeMode(instrumentKeys: string[], mode: StreamMode): void;
        autoReconnect(enable: boolean, intervalSeconds?: number, retryCount?: number): void;

        on(event: 'open', callback: () => void): void;
        on(event: 'close', callback: () => void): void;
        on(event: 'message', callback: (data: Buffer) => void): void;
        on(event: 'error', callback: (error: Error) => void): void;
        on(event: 'reconnecting', callback: () => void): void;
        on(event: 'autoReconnectStopped', callback: (message: string) => void): void;
        on(event: StreamEvent, callback: (...args: unknown[]) => void): void;
    }

    export class PortfolioDataStreamer {
        constructor(
            orderUpdate?: boolean,
            positionUpdate?: boolean,
            holdingUpdate?: boolean,
            gttUpdate?: boolean
        );

        connect(): void;
        disconnect(): void;
        autoReconnect(enable: boolean, intervalSeconds?: number, retryCount?: number): void;

        on(event: StreamEvent, callback: (...args: unknown[]) => void): void;
    }
}
