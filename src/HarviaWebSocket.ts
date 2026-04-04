import WebSocket from 'ws';
import { HarviaAPI, EndpointType } from './api/HarviaAPI';

interface GraphQLMessage {
  type: string;
  id?: string;
  payload?: any;
}

export class HarviaWebSocket {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private forcedReconnectTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutMs = 0;
  private attempt = 0;

  constructor(
    private readonly api: HarviaAPI,
    private readonly endpointKey: 'device' | 'data',
    private readonly userReceiver: boolean,
    private readonly log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
    private readonly onMessage: (payload: any) => void
  ) {}

  public connect(): void {
    this.cleanup();
    this.startConnection();
    this.startForcedReconnect();
  }

  private async startConnection(): Promise<void> {
    try {
      const receiver = await this.resolveReceiver();
      const url = await this.api.getWebSocketUrl(this.endpointKey);
      const host = this.api.getEndpoint(this.endpointKey as EndpointType).replace(
        /^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/,
        '$1.appsync-api.$2'
      );

      this.ws = new WebSocket(url, 'graphql-ws');

      this.ws.on('open', () => {
        this.attempt = 0;
        this.sendMessage({ type: 'connection_init', payload: {} });
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString(), receiver, host));

      this.ws.on('close', () => {
        this.log.warn('WebSocket closed, scheduling reconnect');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.log.error(`WebSocket error: ${error.message}`);
        this.scheduleReconnect();
      });
    } catch (error: any) {
      this.log.error(`Failed to start websocket: ${error?.message ?? error}`);
      this.scheduleReconnect();
    }
  }

  private async resolveReceiver(): Promise<string> {
    const user = await this.api.getUserData();
    return this.userReceiver ? user.email : user.organizationId;
  }

  private sendMessage(message: GraphQLMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(raw: string, receiver: string, host: string): void {
    let message: GraphQLMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'connection_ack':
        this.connectionTimeoutMs = Number(message.payload?.connectionTimeoutMs ?? 20000);
        this.resetHeartbeat(this.connectionTimeoutMs + 5000);
        this.sendStart(receiver, host);
        break;
      case 'ka':
        this.resetHeartbeat(this.connectionTimeoutMs + 5000);
        break;
      case 'data':
        this.onMessage(message.payload?.data);
        break;
      case 'error':
        this.log.error(`WebSocket error payload: ${JSON.stringify(message.payload)}`);
        break;
    }
  }

  private sendStart(receiver: string, host: string): void {
    const query = this.endpointKey === 'device'
      ? `subscription onStateUpdated($receiver: String!) {\n  onStateUpdated(receiver: $receiver) {\n    desired\n    reported\n    timestamp\n  }\n}`
      : `subscription onDataUpdates($receiver: String!) {\n  onDataUpdates(receiver: $receiver) {\n    item {\n      deviceId\n      timestamp\n      data\n    }\n  }\n}`;

    this.sendMessage({
      id: '1',
      type: 'start',
      payload: {
        data: JSON.stringify({ query, variables: { receiver } }),
        extensions: {
          authorization: {
            host,
            Authorization: this.api.getIdToken(),
          },
        },
      },
    });
  }

  private resetHeartbeat(timeoutMs: number): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    this.heartbeatTimer = setTimeout(() => {
      this.log.warn('WebSocket heartbeat timed out, reconnecting');
      this.reconnect();
    }, timeoutMs);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.attempt += 1;
    const delay = Math.min(2 ** this.attempt, 60) * 1000;
    this.log.info(`Reconnecting websocket in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnection();
    }, delay);
  }

  private reconnect(force = false): void {
    if (force && this.ws) {
      this.ws.terminate();
    }
    this.scheduleReconnect();
  }

  private startForcedReconnect(): void {
    if (this.forcedReconnectTimer) {
      clearTimeout(this.forcedReconnectTimer);
    }
    this.forcedReconnectTimer = setTimeout(() => {
      this.log.info('Performing forced websocket reconnect');
      this.reconnect(true);
      this.startForcedReconnect();
    }, 30 * 60 * 1000);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }
}
