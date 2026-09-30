
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import path from 'path';
import { EventEmitter } from 'events';
import { UpstoxFeedResponse } from '@/types/upstox-feed';
import { upstoxLogger } from '@/lib/logger';

// Configuration
const UPSTOX_PROD_AUTH_URL = "https://api.upstox.com/v3/feed/market-data-feed/authorize";

export interface StreamerConfig {
    accessToken: string;
    instrumentKeys: string[];
    mode: 'ltpc' | 'full';
}

export class UpstoxStreamerClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private protobufRoot: protobuf.Root | null = null;
    private config: StreamerConfig;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isManuallyClosed: boolean = false;

    constructor(config: StreamerConfig) {
        super();
        this.config = config;
    }

    /**
     * Initialize connection sequence:
     * 1. Load Protobuf
     * 2. Authorize
     * 3. Connect WebSocket
     */
    public async connect() {
        this.isManuallyClosed = false;
        try {
            await this.initProtobuf();
            
            const authorizedUrl = await this.authorize();
            upstoxLogger.info('Authorized URL obtained. Connecting WS...');
            
            await this.connectWebSocket(authorizedUrl);
        } catch (error) {
            upstoxLogger.error('Connection failed:', error);
            this.emit('error', error);
            this.handleReconnect();
        }
    }

    public disconnect() {
        this.isManuallyClosed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    private async initProtobuf() {
        if (this.protobufRoot) return;

        // Ensure robust path resolution for Next.js/Serverless
        const protoPath = path.resolve(process.cwd(), 'src', 'lib', 'proto', 'MarketDataFeedV3.proto');
        
        try {
            this.protobufRoot = await protobuf.load(protoPath);
            upstoxLogger.info('Protobuf loaded from:', protoPath);
        } catch (error) {
            upstoxLogger.error('Failed to load Protobuf:', error);
            throw error;
        }
    }

    private async authorize(): Promise<string> {
        const response = await fetch(UPSTOX_PROD_AUTH_URL, {
            headers: {
                'Authorization': `Bearer ${this.config.accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Authorization failed: ${response.status} ${response.statusText}`);
        }

        const json = await response.json();
        const uri = json.data?.authorized_redirect_uri || json.data?.authorizedRedirectUri;
        if (!uri) {
            throw new Error('No authorized redirect URI returned by Upstox feed authorization');
        }
        return uri;
    }

    private connectWebSocket(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url, {
                followRedirects: true
            });

            this.ws.on('open', () => {
                upstoxLogger.info('WebSocket Connected');
                this.emit('open');
                this.subscribe();
                resolve();
            });

            this.ws.on('close', (code, reason) => {
                upstoxLogger.info(`WebSocket Closed: ${code} ${reason}`);
                this.emit('close');
                if (!this.isManuallyClosed) {
                    this.handleReconnect();
                }
            });

            this.ws.on('error', (err) => {
                upstoxLogger.error('WebSocket Error:', err);
                this.emit('error', err);
                reject(err);
            });

            this.ws.on('message', (data: Buffer) => {
                try {
                    const decoded = this.decodeProtobuf(data);
                    if (decoded) {
                        this.emit('message', decoded);
                    }
                } catch (err) {
                    upstoxLogger.error('Message decoding failed:', err);
                }
            });
        });
    }

    private subscribe() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        upstoxLogger.info(`Subscribing to ${this.config.instrumentKeys.length} instruments`);

        const request = {
            guid: "dashboard-live-" + Date.now(),
            method: "sub",
            data: {
                mode: this.config.mode,
                instrumentKeys: this.config.instrumentKeys
            }
        };

        this.ws.send(Buffer.from(JSON.stringify(request)));
    }

    private decodeProtobuf(buffer: Buffer): UpstoxFeedResponse | null {
        if (!this.protobufRoot) return null;

        const FeedResponse = this.protobufRoot.lookupType(
            "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse"
        );
        
        return FeedResponse.decode(buffer) as unknown as UpstoxFeedResponse;
    }

    private handleReconnect() {
        if (this.isManuallyClosed) return;
        
        upstoxLogger.info('Scheduling reconnect in 3s...');
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        
        this.reconnectTimer = setTimeout(() => {
            upstoxLogger.info('Reconnecting...');
            this.connect();
        }, 3000);
    }
}
