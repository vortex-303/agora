import { sign, toBase64, fromBase64 } from '@agora/core';
import type { SignedObject, SubscriptionFilter, Identity } from '@agora/core';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export type EventHandler = (subscriptionId: string, object: SignedObject) => void;
export type EoseHandler = (subscriptionId: string) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private identity: Identity;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pendingNonce: string | null = null;

  private onEvent: EventHandler = () => {};
  private onEose: EoseHandler = () => {};
  private onStatus: StatusHandler = () => {};
  private pendingSubscriptions: Array<{ id: string; filters: SubscriptionFilter[] }> = [];

  constructor(url: string, identity: Identity) {
    this.url = url;
    this.identity = identity;
  }

  setHandlers(handlers: { onEvent?: EventHandler; onEose?: EoseHandler; onStatus?: StatusHandler }): void {
    if (handlers.onEvent) this.onEvent = handlers.onEvent;
    if (handlers.onEose) this.onEose = handlers.onEose;
    if (handlers.onStatus) this.onStatus = handlers.onStatus;
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

    this.onStatus('connecting');
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.send({ action: 'hello', publicKey: this.identity.publicKeyBase64 });
      this.onStatus('authenticating');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        console.error('[Relay] Invalid message');
      }
    };

    this.ws.onclose = () => {
      this.onStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.onStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private handleMessage(msg: any): void {
    switch (msg.action) {
      case 'challenge': {
        this.pendingNonce = msg.nonce;
        const nonceBytes = fromBase64(msg.nonce);
        const sig = sign(nonceBytes, this.identity.privateKey);
        this.send({ action: 'auth', signature: toBase64(sig), nonce: msg.nonce });
        break;
      }
      case 'auth_ok':
        this.onStatus('connected');
        // Re-subscribe
        for (const sub of this.pendingSubscriptions) {
          this.send({ action: 'subscribe', ...sub });
        }
        break;
      case 'auth_fail':
        console.error('[Relay] Auth failed:', msg.reason);
        this.disconnect();
        break;
      case 'event':
        this.onEvent(msg.subscriptionId, msg.object);
        break;
      case 'eose':
        this.onEose(msg.subscriptionId);
        break;
      case 'error':
        console.error('[Relay] Error:', msg.message);
        break;
    }
  }

  subscribe(id: string, filters: SubscriptionFilter[]): void {
    // Track for reconnect
    const existing = this.pendingSubscriptions.findIndex((s) => s.id === id);
    if (existing !== -1) this.pendingSubscriptions[existing] = { id, filters };
    else this.pendingSubscriptions.push({ id, filters });

    this.send({ action: 'subscribe', id, filters });
  }

  publish(object: SignedObject): void {
    this.send({ action: 'publish', object });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
