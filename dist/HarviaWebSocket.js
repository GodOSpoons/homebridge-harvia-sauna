"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarviaWebSocket = void 0;
const ws_1 = __importDefault(require("ws"));
class HarviaWebSocket {
    constructor(api, endpointKey, userReceiver, log, onMessage) {
        this.api = api;
        this.endpointKey = endpointKey;
        this.userReceiver = userReceiver;
        this.log = log;
        this.onMessage = onMessage;
        this.ws = null;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.forcedReconnectTimer = null;
        this.connectionTimeoutMs = 0;
        this.attempt = 0;
    }
    connect() {
        this.cleanup();
        this.startConnection();
        this.startForcedReconnect();
    }
    async startConnection() {
        try {
            const receiver = await this.resolveReceiver();
            const url = await this.api.getWebSocketUrl(this.endpointKey);
            const host = this.api.getEndpoint(this.endpointKey).replace(/^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/, '$1.appsync-api.$2');
            this.ws = new ws_1.default(url, 'graphql-ws');
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
        }
        catch (error) {
            this.log.error(`Failed to start websocket: ${error?.message ?? error}`);
            this.scheduleReconnect();
        }
    }
    async resolveReceiver() {
        const user = await this.api.getUserData();
        return this.userReceiver ? user.email : user.organizationId;
    }
    sendMessage(message) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        this.ws.send(JSON.stringify(message));
    }
    handleMessage(raw, receiver, host) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
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
    sendStart(receiver, host) {
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
    resetHeartbeat(timeoutMs) {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
        }
        this.heartbeatTimer = setTimeout(() => {
            this.log.warn('WebSocket heartbeat timed out, reconnecting');
            this.reconnect();
        }, timeoutMs);
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.attempt += 1;
        const delay = Math.min(2 ** this.attempt, 60) * 1000;
        this.log.info(`Reconnecting websocket in ${delay / 1000}s`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.startConnection();
        }, delay);
    }
    reconnect(force = false) {
        if (force && this.ws) {
            this.ws.terminate();
        }
        this.scheduleReconnect();
    }
    startForcedReconnect() {
        if (this.forcedReconnectTimer) {
            clearTimeout(this.forcedReconnectTimer);
        }
        this.forcedReconnectTimer = setTimeout(() => {
            this.log.info('Performing forced websocket reconnect');
            this.reconnect(true);
            this.startForcedReconnect();
        }, 30 * 60 * 1000);
    }
    cleanup() {
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
exports.HarviaWebSocket = HarviaWebSocket;
